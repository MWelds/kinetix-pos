/**
 * Sync v2 — Sequence-number-based push/pull (terminal side).
 *
 * Replaces the wall-clock watermark approach used in sync.service.ts (v1) with
 * an append-only sync_log table that captures every write as an AUTOINCREMENT
 * sequence number.  This eliminates two classes of v1 bugs:
 *
 *   1. Clock-skew bugs — terminal clock wrong → wrong LWW winner / missed records
 *   2. Watermark race — records written between push & pull skipped until next cycle
 *
 * Protocol:
 *
 *   PUSH  terminal reads sync_log WHERE seq > v2TerminalPushSeq AND site_id = terminalId,
 *         fetches current row state from source tables, POSTs to /sync/v2/push.
 *         Server returns { ok, ackedSeq }.  Terminal advances v2TerminalPushSeq = ackedSeq.
 *
 *   PULL  terminal POSTs to /sync/v2/pull with { since: v2ServerPullSeq }.
 *         Server returns records changed by OTHER terminals since that seq.
 *         Terminal applies them and advances v2ServerPullSeq.
 *
 * V1 routes remain active.  Switch per-terminal via the `syncVersion` setting.
 */

import { getSqlite } from '../database/connection'
import { settingsService } from '../services/settings.service'
import type { SyncState, SyncRecord } from './sync.types'
import {
  SYNC_TABLES, SYNC_APPLY_ORDER, HAS_UPDATED_AT, MACHINE_SPECIFIC_SETTINGS, LWW_EXCLUDE_COLS,
  type SyncTable,
} from './sync.constants'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncLogRow {
  seq: number
  site_id: string
  table_name: string
  row_id: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  written_at: string
}

/** Shape of the /sync/v2/push request body. */
export interface V2PushPayload {
  terminalId: string
  /** Highest seq from this terminal's sync_log included in this batch. */
  maxSeq: number
  records: {
    [table: string]: {
      /** Current row snapshots for INSERT / UPDATE log entries. */
      upserts: SyncRecord[]
      /** Row IDs for hard DELETE log entries (rare — most deletes are soft). */
      deletes: string[]
    }
  }
}

/** Shape of the /sync/v2/push response. */
export interface V2PushResponse {
  ok: boolean
  /** Echo of the terminal's maxSeq — terminal advances its cursor to this value. */
  ackedSeq: number
  rowsApplied: number
  serverTime: string
}

/** Shape of the /sync/v2/pull request body. */
export interface V2PullRequest {
  terminalId: string
  /** Terminal requests records from the server's sync_log with seq > this value. */
  since: number
}

/** Shape of the /sync/v2/pull response. */
export interface V2PullResponse {
  ok: boolean
  records: {
    [table: string]: {
      upserts: SyncRecord[]
      deletes: string[]
    }
  }
  /** Highest server sync_log seq included in this response. Terminal advances cursor to this. */
  maxServerSeq: number
  serverTime: string
}

// ─── State ────────────────────────────────────────────────────────────────────

let state: SyncState = {
  status: 'disabled',
  lastSyncAt: null,
  error: null,
  pendingChanges: 0,
}

let intervalHandle: ReturnType<typeof setInterval> | null = null

/** Multiple subscribers can listen for state changes (IPC push, status bar, etc.). */
const stateSubscribers = new Set<(s: SyncState) => void>()

/** Register a callback that fires whenever v2 sync state changes. Returns an unsubscribe fn. */
export function onSyncV2StateChange(cb: (s: SyncState) => void): () => void {
  stateSubscribers.add(cb)
  return () => stateSubscribers.delete(cb)
}

export function getSyncV2State(): SyncState { return { ...state } }

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  const snapshot = { ...state }
  for (const cb of stateSubscribers) {
    try { cb(snapshot) } catch { /* never let a subscriber crash the sync loop */ }
  }
}

// ─── Concurrency guard + backoff ──────────────────────────────────────────────

let isRunning = false
let consecutiveErrors = 0
const MAX_BACKOFF_MS = 5 * 60 * 1000   // cap at 5 min
let backoffHandle: ReturnType<typeof setTimeout> | null = null

function backoffMs(): number {
  // 0 errors → 0, 1 error → 5s, 2 → 20s, 3 → 80s … capped at 5 min
  if (consecutiveErrors === 0) return 0
  return Math.min(5000 * Math.pow(4, consecutiveErrors - 1), MAX_BACKOFF_MS)
}

// ─── Cursor helpers ───────────────────────────────────────────────────────────

/** Highest seq from this terminal's sync_log that the server has confirmed receiving. */
function getTerminalPushSeq(): number {
  return parseInt(settingsService.get('v2TerminalPushSeq') || '0', 10)
}

function setTerminalPushSeq(seq: number): void {
  settingsService.set('v2TerminalPushSeq', String(seq))
}

/** Highest seq from the SERVER's sync_log that this terminal has applied. */
function getServerPullSeq(): number {
  return parseInt(settingsService.get('v2ServerPullSeq') || '0', 10)
}

function setServerPullSeq(seq: number): void {
  settingsService.set('v2ServerPullSeq', String(seq))
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/** Init v2 sync on startup.  No-op if syncVersion !== 'v2' or nodeMode === 'server'. */
export function initSyncV2(): void {
  const nodeMode = settingsService.get('nodeMode')
  if (nodeMode === 'server') { setState({ status: 'disabled' }); return }

  const syncVersion = settingsService.get('syncVersion')
  if (syncVersion !== 'v2') { setState({ status: 'disabled' }); return }

  const enabled = settingsService.get('syncEnabled') === 'true'
  if (!enabled) { setState({ status: 'disabled' }); return }

  const terminalId = settingsService.get('terminalId')
  if (!terminalId) {
    console.warn('[sync-v2] terminalId not set — sync deferred until setup is complete')
    setState({ status: 'disabled' })
    return
  }

  const intervalSec = parseInt(settingsService.get('syncIntervalSeconds') || '30', 10)
  startSyncV2Loop(intervalSec)
}

export function startSyncV2Loop(intervalSeconds = 30): void {
  stopSyncV2Loop()
  consecutiveErrors = 0
  setState({ status: 'idle' })
  scheduleNext(0, intervalSeconds)
}

export function stopSyncV2Loop(): void {
  if (intervalHandle !== null) { clearInterval(intervalHandle); intervalHandle = null }
  if (backoffHandle !== null) { clearTimeout(backoffHandle); backoffHandle = null }
  isRunning = false
  setState({ status: 'disabled' })
}

/**
 * Schedules the next sync cycle.
 * @param delayMs - milliseconds before first run (0 = immediate)
 * @param intervalSeconds - recurring interval after the first run
 */
function scheduleNext(delayMs: number, intervalSeconds: number): void {
  if (backoffHandle !== null) { clearTimeout(backoffHandle); backoffHandle = null }
  backoffHandle = setTimeout(() => {
    backoffHandle = null
    runSyncV2().catch(() => { /* error captured in state */ })
    // Recurring interval (independent of backoff)
    if (intervalHandle === null) {
      intervalHandle = setInterval(
        () => {
          if (!isRunning) runSyncV2().catch(() => { /* captured */ })
        },
        intervalSeconds * 1000
      )
    }
  }, delayMs)
}

/** Force a full v2 resync by resetting both cursors to 0. */
export async function forceFullSyncV2(): Promise<void> {
  setTerminalPushSeq(0)
  setServerPullSeq(0)
  consecutiveErrors = 0
  return runSyncV2()
}

// ─── Core sync ────────────────────────────────────────────────────────────────

export async function runSyncV2(): Promise<void> {
  // Concurrency guard — never run two cycles simultaneously
  if (isRunning) return
  isRunning = true

  const serverUrl  = settingsService.get('syncUrl')?.trim()
  const apiKey     = settingsService.get('syncApiKey')?.trim()
  const terminalId = settingsService.get('terminalId')

  if (!serverUrl) {
    setState({ status: 'error', error: 'Sync server URL is not configured' })
    isRunning = false
    return
  }

  if (!terminalId) {
    setState({ status: 'error', error: 'Terminal ID not set — complete setup first' })
    isRunning = false
    return
  }

  setState({ status: 'syncing', error: null })

  try {
    await pushChangesV2(serverUrl, apiKey ?? '', terminalId)
    await pullChangesV2(serverUrl, apiKey ?? '', terminalId)

    consecutiveErrors = 0
    const now = new Date().toISOString()
    setState({ status: 'synced', lastSyncAt: now, error: null, pendingChanges: 0 })
  } catch (err) {
    consecutiveErrors++
    let msg = err instanceof Error ? err.message : String(err)
    const cause = (err as { cause?: unknown })?.cause
    if (cause instanceof Error && cause.message) msg += ` (${cause.message})`
    setState({ status: 'error', error: msg })

    // Schedule a backoff retry in addition to the regular interval
    const delay = backoffMs()
    if (delay > 0 && intervalHandle !== null) {
      const intervalSec = parseInt(settingsService.get('syncIntervalSeconds') || '30', 10)
      console.warn(`[sync-v2] error #${consecutiveErrors} — retrying in ${Math.round(delay / 1000)}s`)
      scheduleNext(delay, intervalSec)
    }
  } finally {
    isRunning = false
  }
}

// ─── Push ─────────────────────────────────────────────────────────────────────

/**
 * Reads this terminal's sync_log since the last acked seq, fetches current row
 * state for each changed row, and POSTs a batch to the server.
 */
async function pushChangesV2(serverUrl: string, apiKey: string, terminalId: string): Promise<void> {
  const db = getSqlite()
  const lastPushedSeq = getTerminalPushSeq()

  // Collect all log entries this terminal has written since the last ack.
  // Limit batch size to avoid huge payloads; remainder syncs next cycle.
  const logEntries = db.prepare(`
    SELECT seq, site_id, table_name, row_id, operation
    FROM sync_log
    WHERE seq > ? AND site_id = ?
    ORDER BY seq ASC
    LIMIT 500
  `).all(lastPushedSeq, terminalId) as SyncLogRow[]

  if (logEntries.length === 0) return

  const maxSeq = logEntries[logEntries.length - 1].seq
  setState({ pendingChanges: logEntries.length })

  // Group entries by table, deduplicating row_id within each group so we only
  // fetch a row once even if it was written multiple times in this batch.
  const byTable = new Map<string, { upsertIds: Set<string>; deleteIds: Set<string> }>()
  for (const entry of logEntries) {
    if (!byTable.has(entry.table_name)) {
      byTable.set(entry.table_name, { upsertIds: new Set(), deleteIds: new Set() })
    }
    const group = byTable.get(entry.table_name)!
    if (entry.operation === 'DELETE') {
      group.deleteIds.add(entry.row_id)
      group.upsertIds.delete(entry.row_id) // DELETE wins over pending INSERT/UPDATE
    } else {
      if (!group.deleteIds.has(entry.row_id)) {
        group.upsertIds.add(entry.row_id)
      }
    }
  }

  // Build the push payload
  const records: V2PushPayload['records'] = {}

  for (const [table, { upsertIds, deleteIds }] of byTable) {
    if (!SYNC_TABLES.includes(table as SyncTable)) continue

    const tableRecords: { upserts: SyncRecord[]; deletes: string[] } = {
      upserts: [],
      deletes: [...deleteIds],
    }

    if (upsertIds.size > 0) {
      const ids = [...upsertIds]
      const placeholders = ids.map(() => '?').join(', ')
      const pkCol = table === 'settings' ? 'key' : 'id'
      try {
        const rows = db.prepare(
          `SELECT * FROM ${table} WHERE ${pkCol} IN (${placeholders})`
        ).all(ids) as SyncRecord[]

        // Strip machine-specific settings before pushing
        const filtered = table === 'settings'
          ? rows.filter((r) => !MACHINE_SPECIFIC_SETTINGS.has(r['key'] as string))
          : rows

        tableRecords.upserts = filtered
      } catch (err) {
        console.warn(`[sync-v2] push: could not fetch rows from ${table}:`, (err as Error).message)
      }
    }

    if (tableRecords.upserts.length > 0 || tableRecords.deletes.length > 0) {
      records[table] = tableRecords
    }
  }

  // POST to server even if records is empty — the server still needs to ack maxSeq
  const payload: V2PushPayload = { terminalId, maxSeq, records }

  const res = await fetchWithTimeout(`${serverUrl}/sync/v2/push`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`V2 push failed (${res.status}): ${text}`)
  }

  const json = await res.json() as V2PushResponse
  if (!json.ok) throw new Error('Server rejected v2 push')

  // Advance our terminal cursor to what the server confirmed
  setTerminalPushSeq(json.ackedSeq)
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

/**
 * Pulls records from other terminals (via the server's sync_log) since the
 * terminal's last known server seq, then applies them to the local SQLite DB.
 */
async function pullChangesV2(serverUrl: string, apiKey: string, terminalId: string): Promise<void> {
  const since = getServerPullSeq()

  const req: V2PullRequest = { terminalId, since }

  const res = await fetchWithTimeout(`${serverUrl}/sync/v2/pull`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`V2 pull failed (${res.status}): ${text}`)
  }

  const json = await res.json() as V2PullResponse
  if (!json.ok) throw new Error('Server returned error on v2 pull')

  applyPulledRecordsV2(json.records)

  if (json.maxServerSeq > since) {
    setServerPullSeq(json.maxServerSeq)
  }
}

// ─── Apply pulled records ─────────────────────────────────────────────────────

function applyPulledRecordsV2(records: V2PullResponse['records']): void {
  const db = getSqlite()

  // Apply in dependency order so foreign-key parents (staff, shifts, customers,
  // products …) are inserted before the rows that reference them (orders,
  // order_items, payments). Applying in raw manifest order dropped orders on FK
  // violations — see SYNC_APPLY_ORDER. Deletes run in reverse (children first).
  const upsertPass = SYNC_APPLY_ORDER.filter((t) => records[t]?.upserts?.length)
  const deletePass = [...SYNC_APPLY_ORDER].reverse().filter((t) => records[t]?.deletes?.length)

  for (const table of upsertPass) {
    const upserts = records[table]!.upserts
    // ── Upserts ──────────────────────────────────────────────────────────────
    if (upserts.length > 0) {
      const applyUpserts = db.transaction((rows: SyncRecord[]) => {
        if (rows.length === 0) return

        if (table === 'settings') {
          for (const row of rows) {
            if (MACHINE_SPECIFIC_SETTINGS.has(row['key'] as string)) continue
            const existing = db.prepare(
              'SELECT updated_at FROM settings WHERE key = ?'
            ).get(row['key']) as { updated_at: string } | undefined
            if (!existing || (row['updated_at'] as string) >= (existing.updated_at ?? '')) {
              db.prepare(`
                INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
              `).run(row['key'], row['value'], row['updated_at'])
            }
          }
          return
        }

        // Resolve actual columns in this machine's schema (handles version mismatches)
        const schemaColsRaw = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        const schemaCols = new Set(schemaColsRaw.map((r) => r.name))
        const updateCol = HAS_UPDATED_AT.has(table as SyncTable) ? 'updated_at' : 'created_at'
        const lwwExclude = LWW_EXCLUDE_COLS[table as SyncTable] ?? new Set<string>()

        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => schemaCols.has(c))
          if (cols.length === 0) continue

          const placeholders = cols.map(() => '?').join(', ')
          const setClauses = cols
            .filter((c) => c !== 'id' && !lwwExclude.has(c))
            .map((c) =>
              `${c} = CASE WHEN excluded.${updateCol} >= COALESCE(${table}.${updateCol}, '') THEN excluded.${c} ELSE ${table}.${c} END`
            )
            .join(', ')

          if (!setClauses) continue // only `id` in the row — nothing to update

          try {
            db.prepare(`
              INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
              ON CONFLICT(id) DO UPDATE SET ${setClauses}
            `).run(cols.map((c) => row[c]))
          } catch {
            // Foreign key not yet pulled — will retry next cycle
          }
        }
      })

      try { applyUpserts(upserts) }
      catch (err) { console.error(`[sync-v2] upsert failed for ${table}:`, (err as Error).message) }
    }
  }

  // ── Hard deletes (reverse dependency order — children before parents) ───────
  // These are rare (most deletes are soft via deleted_at), but we honour them.
  for (const table of deletePass) {
    const deletes = records[table]!.deletes
    if (deletes.length > 0) {
      const pkCol = table === 'settings' ? 'key' : 'id'
      const applyDeletes = db.transaction((ids: string[]) => {
        const placeholders = ids.map(() => '?').join(', ')
        db.prepare(`DELETE FROM ${table} WHERE ${pkCol} IN (${placeholders})`).run(...ids)
      })
      try { applyDeletes(deletes) }
      catch (err) { console.error(`[sync-v2] delete failed for ${table}:`, (err as Error).message) }
    }
  }

  // ── Delta inventory recompute ─────────────────────────────────────────────
  // Pulling new inventory_adjustments → recompute quantity from full history
  const pulledAdj = records['inventory_adjustments']
  if (pulledAdj?.upserts && pulledAdj.upserts.length > 0) {
    const affectedIds = [...new Set(
      pulledAdj.upserts.map((r) => r['product_id'] as string).filter(Boolean)
    )]
    recomputeInventoryFromAdjustments(db, affectedIds)
  }
}

/**
 * Recompute inventory.quantity for the given products by summing all
 * inventory_adjustments. This is the source of truth in multi-terminal setups.
 */
function recomputeInventoryFromAdjustments(
  db: ReturnType<typeof getSqlite>,
  productIds: string[]
): void {
  if (productIds.length === 0) return
  const now = new Date().toISOString()
  for (const productId of productIds) {
    const result = db.prepare(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_adjustments WHERE product_id = ?`
    ).get(productId) as { total: number } | undefined
    if (result == null) continue
    db.prepare(
      `UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?`
    ).run(Math.max(0, result.total), now, productId)
  }
}

// ─── Pending count ────────────────────────────────────────────────────────────

/** Number of sync_log entries not yet pushed to the server. */
export function getPendingV2Count(): number {
  try {
    const db = getSqlite()
    const terminalId = settingsService.get('terminalId') || 'unknown'
    const lastPushedSeq = getTerminalPushSeq()
    const row = db.prepare(
      `SELECT COUNT(*) as n FROM sync_log WHERE seq > ? AND site_id = ?`
    ).get(lastPushedSeq, terminalId) as { n: number }
    return row.n
  } catch {
    return 0
  }
}

// ─── Connectivity test ────────────────────────────────────────────────────────

/** Quick check that the server's v2 endpoint is reachable. */
export async function testConnectionV2(
  serverUrl: string, apiKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchWithTimeout(`${serverUrl}/sync/v2/status`, {
      headers: buildHeaders(apiKey),
    })
    if (res.ok) {
      const json = await res.json() as { ok: boolean; serverTime: string; protocol: string }
      return { ok: true, message: `Connected (v2) — server time ${json.serverTime}` }
    }
    return { ok: false, message: `Server responded with ${res.status}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`
  return h
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
