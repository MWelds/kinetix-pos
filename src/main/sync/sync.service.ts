import { getSqlite } from '../database/connection'
import { settingsService } from '../services/settings.service'
import type { SyncState, SyncRecord, SyncPayload, PullResponse, PushResponse } from './sync.types'

// ─── Tables that participate in sync ──────────────────────────────────────────
const SYNC_TABLES = [
  'categories', 'products', 'product_variants', 'product_components',
  'inventory', 'inventory_adjustments',
  'customers', 'discount_rules', 'gift_cards',
  'orders', 'order_items', 'payments',
  'staff', 'vendors', 'vendor_payouts', 'settings'
] as const

type SyncTable = (typeof SYNC_TABLES)[number]

/** Tables tracked by updated_at (bidirectional upsert). */
const HAS_UPDATED_AT = new Set<SyncTable>([
  'categories', 'products', 'product_variants', 'customers',
  'discount_rules', 'gift_cards', 'orders', 'order_items',
  'staff', 'vendors', 'settings', 'inventory'
])

// ─── State ────────────────────────────────────────────────────────────────────
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

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/** Called on app startup — reads settings and starts the interval if sync is enabled. */
export function initSync(): void {
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

// ─── Core sync logic ──────────────────────────────────────────────────────────

export async function runSync(): Promise<void> {
  const serverUrl = settingsService.get('syncUrl')?.trim()
  const apiKey    = settingsService.get('syncApiKey')?.trim()
  const terminalId = settingsService.get('terminalId') || 'unknown'

  if (!serverUrl) {
    setState({ status: 'error', error: 'Sync server URL is not configured' })
    return
  }

  setState({ status: 'syncing', error: null })

  try {
    await pushChanges(serverUrl, apiKey, terminalId)
    await pullChanges(serverUrl, apiKey, terminalId)

    const now = new Date().toISOString()
    setState({ status: 'synced', lastSyncAt: now, error: null, pendingChanges: 0 })
    settingsService.set('lastSyncAt', now)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setState({ status: 'error', error: msg })
  }
}

// ─── Self-healing column patch ────────────────────────────────────────────────
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

// ─── Push ─────────────────────────────────────────────────────────────────────

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
      if (rows.length > 0) records[table] = rows
    } catch (err) {
      console.warn(`[sync] skipping table "${table}" — query failed:`, (err as Error).message)
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

  const json = await res.json() as PushResponse
  if (!json.ok) throw new Error('Server rejected push')
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pullChanges(serverUrl: string, apiKey: string, terminalId: string): Promise<void> {
  const since = settingsService.get('lastSyncAt' as never) || '1970-01-01T00:00:00.000Z'

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
}

function applyPulledRecords(records: SyncPayload): void {
  const db = getSqlite()

  const applyTable = db.transaction((table: string, rows: SyncRecord[]) => {
    if (rows.length === 0) return
    const isSettings = table === 'settings'

    for (const row of rows) {
      if (isSettings) {
        const existing = db.prepare('SELECT updated_at FROM settings WHERE key = ?').get(row['key']) as { updated_at: string } | undefined
        if (!existing || (row['updated_at'] as string) >= existing.updated_at) {
          db.prepare(`
            INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `).run(row['key'], row['value'], row['updated_at'])
        }
        continue
      }

      const cols = Object.keys(row)
      const placeholders = cols.map(() => '?').join(', ')
      const updateCol = HAS_UPDATED_AT.has(table as SyncTable) ? 'updated_at' : 'created_at'

      const setClauses = cols
        .filter((c) => c !== 'id')
        .map((c) => `${c} = CASE WHEN excluded.${updateCol} >= COALESCE(${table}.${updateCol}, '') THEN excluded.${c} ELSE ${table}.${c} END`)
        .join(', ')

      try {
        db.prepare(`
          INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET ${setClauses}
        `).run(cols.map((c) => row[c]))
      } catch {
        // Row may reference a foreign key not yet pulled — skip and retry next cycle
      }
    }
  })

  for (const [table, rows] of Object.entries(records)) {
    // Reject any table name not in the known-good allowlist to prevent SQL injection
    // from a compromised or malicious sync server.
    if (!SYNC_TABLES.includes(table as SyncTable)) {
      console.warn(`[sync] applyPulledRecords: ignoring unknown table "${table}"`)
      continue
    }
    if (Array.isArray(rows) && rows.length > 0) {
      applyTable(table, rows)
    }
  }

  // ── Delta inventory recompute ──────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  return headers
}

/** fetch() with a 10-second timeout so offline checks don't hang indefinitely. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Quick connectivity check — resolves true if the server responds to /sync/status. */
export async function testConnection(serverUrl: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchWithTimeout(`${serverUrl}/sync/status`, {
      headers: buildHeaders(apiKey)
    })
    if (res.ok) {
      const json = await res.json() as { ok: boolean; serverTime: string }
      return { ok: true, message: `Connected — server time ${json.serverTime}` }
    }
    return { ok: false, message: `Server responded with ${res.status}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
