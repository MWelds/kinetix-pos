import { getSqlite } from '../database/connection'
import { settingsService } from '../services/settings.service'
import type { SyncState, SyncRecord, SyncPayload, PullResponse, PushResponse } from './sync.types'
import {
  SYNC_TABLES, SYNC_APPLY_ORDER, HAS_UPDATED_AT, MACHINE_SPECIFIC_SETTINGS, LWW_EXCLUDE_COLS,
  type SyncTable,
} from './sync.constants'

// âââ State ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
let state: SyncState = {
  status: 'disabled',
  lastSyncAt: null,
  error: null,
  pendingChanges: 0
}

let intervalHandle: ReturnType<typeof setInterval> | null = null
let onStateChange: ((s: SyncState) => void) | null = null

/** Register a callback that fires whenever sync state changes (used to push to renderer). */
export function onSyncStateChange(cb: (s: SyncState) => void): void {
  onStateChange = cb
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  onStateChange?.(state)
}

export function getSyncState(): SyncState {
  return state
}

// âââ Lifecycle ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/** Called on app startup â reads settings and starts the interval if sync is enabled. */
export function initSync(): void {
  // Server machines ARE the sync target â they never run the sync client
  const nodeMode = settingsService.get('nodeMode')
  if (nodeMode === 'server') {
    setState({ status: 'disabled' })
    return
  }

  // v2 sync takes over when enabled â don't run both simultaneously
  const syncVersion = settingsService.get('syncVersion' as never)
  if (syncVersion === 'v2') {
    setState({ status: 'disabled' })
    return
  }

  const enabled = settingsService.get('syncEnabled') === 'true'
  if (!enabled) {
    setState({ status: 'disabled' })
    return
  }

  const intervalSec = parseInt(settingsService.get('syncIntervalSeconds') || '30', 10)
  startSyncLoop(intervalSec)
}

/** Start (or restart) the background sync loop. */
export function startSyncLoop(intervalSeconds = 30): void {
  stopSyncLoop()
  setState({ status: 'idle' })
  runSync().catch(() => { /* error already captured in state */ })
  intervalHandle = setInterval(() => {
    runSync().catch(() => { /* error already captured in state */ })
  }, intervalSeconds * 1000)
}

/** Stop the background sync loop. */
export function stopSyncLoop(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  setState({ status: 'disabled' })
}

/**
 * Force a full resync by clearing lastSyncAt so the next pull fetches ALL
 * records from the server â products, inventory, staff, settings (logo,
 * address, currency, etc.) â regardless of when they were last modified.
 * Use when a terminal is missing data or settings from the server.
 */
export async function forceFullSync(): Promise<void> {
  // Clear the watermark so the next push sends everything local and the
  // next pull requests everything from the server since the beginning of time.
  settingsService.set('lastSyncAt', '1970-01-01T00:00:00.000Z')
  return runSync()
}

// âââ Core sync logic ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function runSync(): Promise<void> {
  const serverUrl = settingsService.get('syncUrl')?.trim()
  const apiKey    = settingsService.get('syncApiKey')?.trim()
  const terminalId = settingsService.get('terminalId') || 'unknown'

  if (!serverUrl) {
    setState({ status: 'error', error: 'Sync server URL is not configured' })
    return
  }

  setState({ status: 'syncing', error: null })

  // Capture the start time BEFORE pushing so that any records written to the
  // local DB during the push/pull window (updated_at between start and finish)
  // are NOT skipped on the next cycle.  Saving 'now' captured after push would
  // advance the watermark past those in-flight writes, causing them to be missed.
  const syncStartedAt = new Date().toISOString()

  try {
    await pushChanges(serverUrl, apiKey, terminalId)
    const serverTime = await pullChanges(serverUrl, apiKey, terminalId)

    setState({ status: 'synced', lastSyncAt: syncStartedAt, error: null, pendingChanges: 0 })
    settingsService.set('lastSyncAt', syncStartedAt)
    if (serverTime) settingsService.set('lastPullServerTime', serverTime)
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err)
    // Node.js fetch wraps the real network error in err.cause. Expose it so
    // users can tell the difference between a timeout, connection refused, etc.
    const cause = (err as { cause?: unknown })?.cause
    if (cause instanceof Error && cause.message) {
      msg += ` (${cause.message})`
    } else if (typeof cause === 'string' && cause) {
      msg += ` (${cause})`
    }
    setState({ status: 'error', error: msg })
  }
}

// âââ Self-healing column patch ââââââââââââââââââââââââââââââââââââââââââââââââ
function ensureSyncColumns(): void {
  let db: ReturnType<typeof getSqlite>
  try {
    db = getSqlite()
  } catch (err) {
    console.error('[sync] ensureSyncColumns: could not get DB handle:', err)
    return
  }

  const fixes: Array<{ table: string; ddl: string }> = [
    {
      table: 'product_components',
      ddl: `ALTER TABLE product_components ADD COLUMN created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    },
    {
      table: 'gift_cards',
      ddl: `ALTER TABLE gift_cards ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    }
  ]
  for (const { table, ddl } of fixes) {
    try {
      db.exec(ddl)
      console.log(`[sync] ensureSyncColumns: added missing column to ${table}`)
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (!msg.toLowerCase().includes('duplicate column')) {
        console.warn(`[sync] ensureSyncColumns: unexpected error patching ${table}:`, msg)
      }
    }
  }
}

// âââ Push âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function pushChanges(serverUrl: string, apiKey: string, terminalId: string): Promise<void> {
  ensureSyncColumns()

  const lastSync = settingsService.get('lastSyncAt' as never) || '1970-01-01T00:00:00.000Z'
  const db = getSqlite()
  const records: SyncPayload = {}

  for (const table of SYNC_TABLES) {
    const col = HAS_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'
    const sql = `SELECT * FROM ${table} WHERE ${col} > ? ORDER BY ${col} ASC`
    try {
      const rows = db.prepare(sql).all(lastSync) as SyncRecord[]
      // Never push machine-specific settings keys â they must stay local
      const filteredRows = table === 'settings'
        ? rows.filter((r) => !MACHINE_SPECIFIC_SETTINGS.has(r['key'] as string))
        : rows
      if (filteredRows.length > 0) records[table] = filteredRows
    } catch (err) {
      console.warn(`[sync] skipping table "${table}" â query failed:`, (err as Error).message)
    }
  }

  const totalRows = Object.values(records).reduce((n, r) => n + r.length, 0)
  if (totalRows === 0) return

  setState({ pendingChanges: totalRows })

  const res = await fetchWithTimeout(`${serverUrl}/sync/push`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ terminalId, records })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Push failed (${res.status}): ${text}`)
  }

  const json = await res.json() as PushResponse & { skippedTables?: { table: string; error: string }[] }
  if (!json.ok) {
    const detail = Array.isArray(json.skippedTables) && json.skippedTables.length > 0
      ? json.skippedTables.map((t) => `${t.table}: ${t.error}`).join('; ')
      : 'no detail returned'
    throw new Error(`Server rejected push (${detail})`)
  }
}

// âââ Pull âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function pullChanges(serverUrl: string, apiKey: string, terminalId: string): Promise<string | null> {
  const since = settingsService.get('lastPullServerTime' as never)
    || settingsService.get('lastSyncAt' as never)
    || '1970-01-01T00:00:00.000Z'

  const res = await fetchWithTimeout(`${serverUrl}/sync/pull`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ terminalId, since })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Pull failed (${res.status}): ${text}`)
  }

  const json = await res.json() as PullResponse
  applyPulledRecords(json.records)

  // Apply the full settings snapshot returned by the server.  This covers
  // store-level settings (name, logo, address, currency, tax, etc.) that were
  // configured on the server before this terminal was set up â they predate
  // lastSyncAt so they would never appear in the delta records above.
  // applyBaselineSettings uses the same timestamp-based conflict resolution as
  // normal settings sync, so a locally-newer value is never overwritten.
  if (Array.isArray(json.baselineSettings) && json.baselineSettings.length > 0) {
    applyBaselineSettings(json.baselineSettings)
  }
  return typeof json.serverTime === 'string' ? json.serverTime : null
}

function applyPulledRecords(records: SyncPayload): void {
  const db = getSqlite()

  const applyTable = db.transaction((table: string, rows: SyncRecord[]) => {
    if (rows.length === 0) return
    const isSettings = table === 'settings'

    if (isSettings) {
      for (const row of rows) {
        // Never overwrite machine-specific settings with values from another machine
        if (MACHINE_SPECIFIC_SETTINGS.has(row['key'] as string)) continue
        const existing = db.prepare('SELECT updated_at FROM settings WHERE key = ?').get(row['key']) as { updated_at: string } | undefined
        if (!existing || (row['updated_at'] as string) >= existing.updated_at) {
          db.prepare(`
            INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(row['key'], row['value'], row['updated_at'])
        }
      }
      return
    }

    // Resolve which columns actually exist in this machine's schema (once per table,
    // not per row). Resilient to version mismatches where the server sends a column
    // this machine hasn't migrated to yet.
    const tableColsRaw = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    const tableColSet = new Set(tableColsRaw.map((r) => r.name))
    const updateCol = HAS_UPDATED_AT.has(table as SyncTable) ? 'updated_at' : 'created_at'
    // Columns that must never be overwritten by LWW â e.g. inventory.quantity
    // is always recomputed from adjustments and must not be set by a pulled row.
    const lwwExclude = LWW_EXCLUDE_COLS[table as SyncTable] ?? new Set<string>()

    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => tableColSet.has(c))
      if (cols.length === 0) continue

      const placeholders = cols.map(() => '?').join(', ')
      const setClauses = cols
        .filter((c) => c !== 'id' && !lwwExclude.has(c))
        .map((c) => `${c} = CASE WHEN excluded.${updateCol} >= COALESCE(${table}.${updateCol}, '') THEN excluded.${c} ELSE ${table}.${c} END`)
        .join(', ')

      try {
        db.prepare(`
          INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET ${setClauses}
        `).run(cols.map((c) => row[c]))
      } catch {
        // Row may reference a foreign key not yet pulled â skip and retry next cycle
      }
    }
  })

  // Apply in dependency order so foreign-key parents (staff, shifts, customers,
  // products …) land before the orders/order_items/payments that reference them.
  // Manifest order applied orders first, so they hit a FK violation and were
  // dropped — see SYNC_APPLY_ORDER. Unknown tables in the payload are ignored.
  for (const table of SYNC_APPLY_ORDER) {
    const rows = records[table]
    if (Array.isArray(rows) && rows.length > 0) {
      applyTable(table, rows)
    }
  }

  // ââ Delta inventory recompute ââââââââââââââââââââââââââââââââââââââââââââââ
  // If adjustment records were pulled, recompute inventory.quantity from the
  // full adjustment history so both terminals converge to the correct value
  // rather than fighting over the absolute quantity via last-write-wins.
  const pulledAdjustments = records['inventory_adjustments']
  if (Array.isArray(pulledAdjustments) && pulledAdjustments.length > 0) {
    const affectedProductIds = [...new Set(pulledAdjustments.map((r) => r['product_id'] as string).filter(Boolean))]
    recomputeInventoryFromAdjustments(db, affectedProductIds)
  }
}

/**
 * Apply the full settings snapshot sent by the server on every pull response.
 * This ensures store-level settings (name, logo, address, currency, tax, etc.)
 * reach terminals that were set up after those settings were last written on
 * the server â their updated_at predates the terminal's lastSyncAt, so they
 * would never appear in the normal delta pull.
 *
 * Conflict resolution: if the local value has a NEWER updated_at than the
 * server value, the local value wins (e.g. a manager changed the tax rate at
 * the terminal today â that should not be silently reverted by the server).
 */
function applyBaselineSettings(rows: SyncRecord[]): void {
  const db = getSqlite()
  const apply = db.transaction((settingRows: SyncRecord[]) => {
    for (const row of settingRows) {
      if (MACHINE_SPECIFIC_SETTINGS.has(row['key'] as string)) continue
      const existing = db.prepare('SELECT updated_at FROM settings WHERE key = ?')
        .get(row['key']) as { updated_at: string } | undefined
      // Only apply if the server value is newer than (or same age as) what we have.
      // Use >= so that a setting with no local copy is always written.
      if (!existing || (row['updated_at'] as string) >= existing.updated_at) {
        db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(row['key'], row['value'], row['updated_at'])
      }
    }
  })
  apply(rows)
}

/**
 * Recompute inventory.quantity for the given products by summing all
 * inventory_adjustments. This is the source of truth for multi-terminal setups.
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
    const computed = Math.max(0, result.total)
    db.prepare(
      `UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?`
    ).run(computed, now, productId)
  }
}

// âââ Helpers ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  return headers
}

/**
 * fetch() with a 60-second timeout.
 * The first sync push can be a large payload (all records since epoch) so we
 * give it generous time rather than aborting a legitimate long-running request.
 * The status check test uses its own short-lived timeout via testConnection.
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Quick connectivity check â resolves true if the server responds to /sync/status. */
export async function testConnection(serverUrl: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchWithTimeout(`${serverUrl}/sync/status`, {
      headers: buildHeaders(apiKey)
    })
    if (res.ok) {
      const json = await res.json() as { ok: boolean; serverTime: string }
      return { ok: true, message: `Connected â server time ${json.serverTime}` }
    }
    return { ok: false, message: `Server responded with ${res.status}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
