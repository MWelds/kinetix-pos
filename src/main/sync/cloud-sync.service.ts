/**
 * Cloud Sync Service — Hub → Cloud
 *
 * Runs only on the designated server node (nodeMode === 'server').
 * Periodically pushes all synced tables to the Kinetix Cloud backend,
 * then pulls any changes that arrived from other locations.
 *
 * Push strategy: timestamp watermark scan (reads all rows updated since
 * the last successful push). Simpler than sequence-based sync and avoids
 * the sync_log gap when records were applied from terminals via LAN sync.
 *
 * Pull strategy: pass `since` (ISO timestamp) to cloud; cloud returns all
 * records it received from ANY push after that timestamp.  Useful for
 * multi-location setups where two stores share product catalog or customers.
 */

import { getSqlite } from '../database/connection'
import { settingsService } from '../services/settings.service'
import { SYNC_TABLES, MACHINE_SPECIFIC_SETTINGS, type SyncTable } from './sync.constants'

// ─── Types ────────────────────────────────────────────────────────────────────

type SyncRecord = Record<string, unknown>

export interface CloudSyncState {
  status: 'disabled' | 'idle' | 'syncing' | 'synced' | 'error'
  lastSyncAt: string | null
  error: string | null
  pendingTables: number
}

// ─── Module state ─────────────────────────────────────────────────────────────

let state: CloudSyncState = {
  status: 'disabled',
  lastSyncAt: null,
  error: null,
  pendingTables: 0,
}

let intervalHandle: ReturnType<typeof setInterval> | null = null
let isRunning = false
let consecutiveErrors = 0
const MAX_BACKOFF_MS = 10 * 60 * 1000   // 10 min cap

const stateSubscribers = new Set<(s: CloudSyncState) => void>()

/** Subscribe to cloud sync state changes. Returns an unsubscribe function. */
export function onCloudSyncStateChange(cb: (s: CloudSyncState) => void): () => void {
  stateSubscribers.add(cb)
  return () => stateSubscribers.delete(cb)
}

export function getCloudSyncState(): CloudSyncState { return { ...state } }

function setState(patch: Partial<CloudSyncState>): void {
  state = { ...state, ...patch }
  const snapshot = { ...state }
  for (const cb of stateSubscribers) {
    try { cb(snapshot) } catch { /* never crash the sync loop */ }
  }
}

// ─── Cursor helpers ───────────────────────────────────────────────────────────

/** ISO timestamp of last row successfully pushed to cloud. */
function getPushWatermark(): string {
  return settingsService.get('cloudPushWatermark') || '1970-01-01T00:00:00.000Z'
}

function setPushWatermark(ts: string): void {
  settingsService.set('cloudPushWatermark', ts)
}

/** ISO timestamp used for pull — fetch cloud records synced after this. */
function getPullWatermark(): string {
  return settingsService.get('cloudPullWatermark') || '1970-01-01T00:00:00.000Z'
}

function setPullWatermark(ts: string): void {
  settingsService.set('cloudPullWatermark', ts)
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Initialise cloud sync on startup.
 * No-op unless nodeMode === 'server' and cloudSyncEnabled === 'true'.
 */
export function initCloudSync(): void {
  const nodeMode = settingsService.get('nodeMode')
  if (nodeMode !== 'server') return

  if (settingsService.get('cloudSyncEnabled') !== 'true') {
    setState({ status: 'disabled' })
    return
  }

  if (!settingsService.get('cloudSyncUrl') || !settingsService.get('storeId') || !settingsService.get('cloudApiKey')) {
    console.warn('[cloud-sync] Missing cloudSyncUrl / storeId / cloudApiKey — sync deferred until configured')
    setState({ status: 'disabled' })
    return
  }

  const intervalSec = parseInt(settingsService.get('cloudSyncIntervalSeconds') || '300', 10)
  startCloudSyncLoop(intervalSec)
}

export function startCloudSyncLoop(intervalSeconds = 300): void {
  stopCloudSyncLoop()
  consecutiveErrors = 0
  setState({ status: 'idle' })

  // Run immediately then on interval
  setTimeout(() => {
    runCloudSync().catch(() => { /* captured in state */ })
  }, 5_000) // 5 s delay to let the app finish starting up

  intervalHandle = setInterval(() => {
    if (!isRunning) runCloudSync().catch(() => { /* captured */ })
  }, intervalSeconds * 1000)
}

export function stopCloudSyncLoop(): void {
  if (intervalHandle !== null) { clearInterval(intervalHandle); intervalHandle = null }
  isRunning = false
  setState({ status: 'disabled' })
}

/** Force a full cloud resync from the beginning of time. */
export async function forceFullCloudSync(): Promise<void> {
  setPushWatermark('1970-01-01T00:00:00.000Z')
  setPullWatermark('1970-01-01T00:00:00.000Z')
  consecutiveErrors = 0
  return runCloudSync()
}

// ─── Core sync ────────────────────────────────────────────────────────────────

export async function runCloudSync(): Promise<void> {
  if (isRunning) return
  isRunning = true

  const cloudUrl  = settingsService.get('cloudSyncUrl')?.trim()
  const storeId   = settingsService.get('storeId')?.trim()
  const apiKey    = settingsService.get('cloudApiKey')?.trim()

  if (!cloudUrl || !storeId || !apiKey) {
    setState({ status: 'error', error: 'Cloud sync not configured — visit Settings → Cloud Sync' })
    isRunning = false
    return
  }

  setState({ status: 'syncing', error: null })

  try {
    await pushToCloud(cloudUrl, storeId, apiKey)
    await pullFromCloud(cloudUrl, storeId, apiKey)

    consecutiveErrors = 0
    setState({ status: 'synced', lastSyncAt: new Date().toISOString(), error: null, pendingTables: 0 })
  } catch (err) {
    consecutiveErrors++
    const msg = err instanceof Error ? err.message : String(err)
    setState({ status: 'error', error: msg })
    console.error(`[cloud-sync] error #${consecutiveErrors}:`, msg)

    // Exponential backoff retry on top of the regular interval
    if (intervalHandle !== null) {
      const delay = Math.min(5000 * Math.pow(4, consecutiveErrors - 1), MAX_BACKOFF_MS)
      console.warn(`[cloud-sync] retrying in ${Math.round(delay / 1000)}s`)
      setTimeout(() => {
        if (!isRunning) runCloudSync().catch(() => { /* captured */ })
      }, delay)
    }
  } finally {
    isRunning = false
  }
}

// ─── Push ─────────────────────────────────────────────────────────────────────

async function pushToCloud(cloudUrl: string, storeId: string, apiKey: string): Promise<void> {
  const db = getSqlite()
  const watermark = getPushWatermark()
  const now = new Date().toISOString()

  const records: Record<string, { upserts: SyncRecord[]; deletes: string[] }> = {}
  let totalRows = 0

  for (const table of SYNC_TABLES) {
    // Use updated_at if the table has it, otherwise fall back to created_at
    const colCheckRow = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    const cols = new Set(colCheckRow.map((r) => r.name))
    const timeCol = cols.has('updated_at') ? 'updated_at' : 'created_at'

    let rows: SyncRecord[]
    try {
      rows = db.prepare(
        `SELECT * FROM ${table} WHERE ${timeCol} > ? ORDER BY ${timeCol} ASC LIMIT 500`
      ).all(watermark) as SyncRecord[]
    } catch (err) {
      console.warn(`[cloud-sync] push: could not read ${table}:`, (err as Error).message)
      continue
    }

    if (rows.length === 0) continue

    // Strip machine-specific settings
    const filtered = table === 'settings'
      ? rows.filter((r) => !MACHINE_SPECIFIC_SETTINGS.has(r['key'] as string))
      : rows

    if (filtered.length === 0) continue

    records[table] = { upserts: filtered, deletes: [] }
    totalRows += filtered.length
  }

  setState({ pendingTables: Object.keys(records).length })

  if (totalRows === 0) {
    console.log('[cloud-sync] push: nothing new since', watermark)
    setPushWatermark(now)
    return
  }

  const terminalId = settingsService.get('terminalId') || `hub-${storeId.slice(0, 8)}`

  const res = await fetchWithTimeout(`${cloudUrl}/sync/push`, {
    method: 'POST',
    headers: buildHeaders(storeId, apiKey),
    body: JSON.stringify({ terminalId, records, pushedAt: now }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud push failed (${res.status}): ${text}`)
  }

  const json = await res.json() as { ok: boolean; rowsApplied?: number }
  if (!json.ok) throw new Error('Cloud rejected push')

  console.log(`[cloud-sync] pushed ${totalRows} rows across ${Object.keys(records).length} tables`)
  setPushWatermark(now)
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pullFromCloud(cloudUrl: string, storeId: string, apiKey: string): Promise<void> {
  const since = getPullWatermark()
  const terminalId = settingsService.get('terminalId') || `hub-${storeId.slice(0, 8)}`

  const res = await fetchWithTimeout(`${cloudUrl}/sync/pull`, {
    method: 'POST',
    headers: buildHeaders(storeId, apiKey),
    body: JSON.stringify({ terminalId, since }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud pull failed (${res.status}): ${text}`)
  }

  const json = await res.json() as {
    ok: boolean
    records: Record<string, { upserts: SyncRecord[]; deletes: string[] }>
    asOf: string
  }

  if (!json.ok) throw new Error('Cloud returned error on pull')

  applyPulledRecords(json.records)

  if (json.asOf && json.asOf > since) {
    setPullWatermark(json.asOf)
  }
}

// ─── Apply pulled records ─────────────────────────────────────────────────────

function applyPulledRecords(
  records: Record<string, { upserts: SyncRecord[]; deletes: string[] }>
): void {
  const db = getSqlite()

  for (const [table, { upserts, deletes }] of Object.entries(records)) {
    if (!SYNC_TABLES.includes(table as SyncTable)) {
      console.warn(`[cloud-sync] pull: ignoring unknown table "${table}"`)
      continue
    }

    // ── Upserts ────────────────────────────────────────────────────────────
    if (upserts.length > 0) {
      const schemaColsRaw = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      const schemaCols = new Set(schemaColsRaw.map((r) => r.name))
      const sample = upserts[0]
      const cols = Object.keys(sample).filter((c) => schemaCols.has(c))
      if (cols.length === 0) continue

      const timeCol = schemaCols.has('updated_at') ? 'updated_at' : 'created_at'
      const pkCol = table === 'settings' ? 'key' : 'id'
      const placeholders = cols.map(() => '?').join(', ')
      const setClauses = cols
        .filter((c) => c !== pkCol)
        .map((c) => `${c} = CASE WHEN excluded.${timeCol} >= COALESCE(${table}.${timeCol}, '') THEN excluded.${c} ELSE ${table}.${c} END`)
        .join(', ')

      const stmt = db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
         ON CONFLICT(${pkCol}) DO UPDATE SET ${setClauses}`
      )

      const applyAll = db.transaction((rows: SyncRecord[]) => {
        for (const row of rows) {
          if (table === 'settings' && MACHINE_SPECIFIC_SETTINGS.has(row['key'] as string)) continue
          try {
            stmt.run(cols.map((c) => row[c]))
          } catch (err) {
            const msg = (err as Error).message ?? ''
            if (!msg.includes('UNIQUE constraint failed') || msg.includes(`${table}.${pkCol}`)) throw err
            console.warn(`[cloud-sync] pull: skipping ${table} row (secondary unique conflict): ${msg}`)
          }
        }
      })
      applyAll(upserts)
    }

    // ── Deletes ────────────────────────────────────────────────────────────
    if (deletes.length > 0) {
      const pkCol = table === 'settings' ? 'key' : 'id'
      const del = db.prepare(`DELETE FROM ${table} WHERE ${pkCol} = ?`)
      const delAll = db.transaction((ids: string[]) => {
        for (const id of ids) del.run(id)
      })
      delAll(deletes)
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHeaders(storeId: string, apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Store-Id': storeId,
    'Authorization': `Bearer ${apiKey}`,
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}
