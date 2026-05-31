/**
 * File-based sync service (terminal side).
 *
 * Instead of HTTP, this service reads/writes JSON files on a Windows network
 * share (UNC path or mapped drive).  When the share is unreachable the
 * terminal continues to work offline; sync resumes automatically the next time
 * the share is accessible.
 *
 * Share folder layout (managed by file-sync-server.ts on the server machine):
 *
 *   {syncRoot}/
 *     push/                     ← terminals write their pending changes here
 *       {terminalId}-{ts}.json
 *     pull/                     ← server writes its changes here for terminals to read
 *       server-{ts}.json
 *     .kinetix-sync             ← marker file (allows LAN share discovery)
 */

import fs from 'fs'
import path from 'path'
import { getSqlite } from '../database/connection'
import { settingsService } from '../services/settings.service'
import type { SyncState, SyncRecord, SyncPayload } from './sync.types'

// ─── Tables ───────────────────────────────────────────────────────────────────

const SYNC_TABLES = [
  'categories', 'products', 'product_variants', 'product_components',
  'inventory', 'inventory_adjustments',
  'customers', 'discount_rules', 'gift_cards',
  'orders', 'order_items', 'payments',
  'staff', 'vendors', 'vendor_payouts', 'settings'
] as const

type SyncTable = (typeof SYNC_TABLES)[number]

const HAS_UPDATED_AT = new Set<SyncTable>([
  'categories', 'products', 'product_variants', 'customers',
  'discount_rules', 'gift_cards', 'orders', 'order_items',
  'staff', 'vendors', 'settings', 'inventory'
])

/** Settings that are machine-specific and must never cross machine boundaries. */
const MACHINE_SPECIFIC_SETTINGS = new Set([
  'nodeMode', 'setupComplete', 'terminalId',
  'syncEnabled', 'syncUrl', 'syncApiKey', 'syncIntervalSeconds', 'lastSyncAt',
  'embeddedServerPort', 'embeddedServerApiKey', 'dashboardAdminPin',
  'syncMode', 'syncSharePath', 'fileSyncLastPullAt'
])

// ─── State ────────────────────────────────────────────────────────────────────

let state: SyncState = { status: 'disabled', lastSyncAt: null, error: null, pendingChanges: 0 }
let intervalHandle: ReturnType<typeof setInterval> | null = null
let onStateChange: ((s: SyncState) => void) | null = null

export function onFileSyncStateChange(cb: (s: SyncState) => void): void {
  onStateChange = cb
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  onStateChange?.(state)
}

export function getFileSyncState(): SyncState { return state }

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Called on app startup for terminal machines running file-based sync.
 * Reads settings and starts the background sync interval.
 */
export function initFileSync(): void {
  const nodeMode = settingsService.get('nodeMode')
  if (nodeMode === 'server') { setState({ status: 'disabled' }); return }

  const syncMode = settingsService.get('syncMode')
  if (syncMode !== 'file') { setState({ status: 'disabled' }); return }

  const sharePath = settingsService.get('syncSharePath')?.trim()
  if (!sharePath) { setState({ status: 'disabled' }); return }

  const intervalSec = parseInt(settingsService.get('syncIntervalSeconds') || '30', 10)
  startFileSyncLoop(sharePath, intervalSec)
}

/** Start (or restart) the background file-sync loop. */
export function startFileSyncLoop(sharePath: string, intervalSeconds = 30): void {
  stopFileSyncLoop()
  setState({ status: 'idle', error: null })
  runFileSync(sharePath).catch(() => { /* errors captured in state */ })
  intervalHandle = setInterval(
    () => runFileSync(sharePath).catch(() => { /* errors captured in state */ }),
    intervalSeconds * 1000
  )
}

/** Stop the background file-sync loop. */
export function stopFileSyncLoop(): void {
  if (intervalHandle !== null) { clearInterval(intervalHandle); intervalHandle = null }
  setState({ status: 'disabled' })
}

// ─── Core sync ────────────────────────────────────────────────────────────────

/** Run one push+pull cycle. Returns silently if the share is unreachable (offline). */
export async function runFileSync(sharePath: string): Promise<void> {
  setState({ status: 'syncing', error: null })

  // ── Offline check ────────────────────────────────────────────────────────
  const accessible = await isPathAccessible(sharePath)
  if (!accessible) {
    // Not an error — the terminal is simply offline. Stay in idle so the user
    // can see "offline" rather than a red error banner.
    setState({ status: 'idle', error: null })
    return
  }

  const terminalId = settingsService.get('terminalId') || 'unknown'

  try {
    const pendingCount = await pushChangesToShare(sharePath, terminalId)
    await pullChangesFromShare(sharePath, terminalId)

    const now = new Date().toISOString()
    setState({ status: 'synced', lastSyncAt: now, error: null, pendingChanges: 0 })
    settingsService.set('lastSyncAt', now)
    if (pendingCount > 0) {
      console.log(`[file-sync] pushed ${pendingCount} record(s), pull complete`)
    }
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err)
    const cause = (err as { cause?: unknown })?.cause
    if (cause instanceof Error && cause.message) msg += ` (${cause.message})`
    setState({ status: 'error', error: msg })
  }
}

// ─── Push ─────────────────────────────────────────────────────────────────────

/**
 * Collect records changed since `lastSyncAt` and write them as a single JSON
 * file into `{sharePath}/push/`.  Returns the total row count pushed (0 = nothing to do).
 */
async function pushChangesToShare(sharePath: string, terminalId: string): Promise<number> {
  const lastSync = settingsService.get('lastSyncAt' as never) || '1970-01-01T00:00:00.000Z'
  const db = getSqlite()
  const records: SyncPayload = {}

  for (const table of SYNC_TABLES) {
    const col = HAS_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'
    try {
      const rows = db.prepare(
        `SELECT * FROM ${table} WHERE ${col} > ? ORDER BY ${col} ASC`
      ).all(lastSync) as SyncRecord[]

      // Strip machine-specific settings before pushing
      const filtered = table === 'settings'
        ? rows.filter((r) => !MACHINE_SPECIFIC_SETTINGS.has(r['key'] as string))
        : rows

      if (filtered.length > 0) records[table] = filtered
    } catch (err) {
      console.warn(`[file-sync] skipping "${table}" — query failed:`, (err as Error).message)
    }
  }

  const totalRows = Object.values(records).reduce((n, r) => n + r.length, 0)
  if (totalRows === 0) return 0

  setState({ pendingChanges: totalRows })

  const pushDir = path.join(sharePath, 'push')
  await fs.promises.mkdir(pushDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `${terminalId}-${timestamp}.json`
  const payload = JSON.stringify({ terminalId, pushedAt: new Date().toISOString(), records })

  await fs.promises.writeFile(path.join(pushDir, filename), payload, 'utf8')
  return totalRows
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

/**
 * Read all server pull files newer than `fileSyncLastPullAt`, apply their
 * records to the local database, and advance the pull cursor.
 */
async function pullChangesFromShare(sharePath: string, _terminalId: string): Promise<void> {
  const pullDir = path.join(sharePath, 'pull')

  // Pull dir may not exist yet if the server hasn't written anything
  const pullDirExists = await isPathAccessible(pullDir)
  if (!pullDirExists) return

  const lastPullAt = settingsService.get('fileSyncLastPullAt' as never) || '1970-01-01T00:00:00.000Z'

  let files: string[]
  try {
    files = (await fs.promises.readdir(pullDir))
      .filter((f) => f.startsWith('server-') && f.endsWith('.json'))
      .sort() // ISO timestamps sort lexicographically = chronologically
  } catch {
    return
  }

  let latestTs = lastPullAt

  for (const file of files) {
    // Extract timestamp from filename: server-{ISO}-{randomSuffix}.json
    const tsMatch = file.match(/^server-(\d{4}-\d{2}-\d{2}T[\d-]+Z)/)
    const fileTs = tsMatch ? tsMatch[1].replace(/-(\d{2})-(\d{2}Z?)$/, ':$1:$2').replace(/-(\d{2})Z/, ':$1Z') : file
    if (fileTs <= lastPullAt) continue // already processed

    try {
      const raw = await fs.promises.readFile(path.join(pullDir, file), 'utf8')
      const parsed = JSON.parse(raw) as { records: SyncPayload; serverTime?: string }
      applyPulledRecords(parsed.records)
      if (file > latestTs) latestTs = file // track furthest processed file name
    } catch (err) {
      console.warn(`[file-sync] could not process pull file ${file}:`, (err as Error).message)
    }
  }

  if (latestTs !== lastPullAt) {
    settingsService.set('fileSyncLastPullAt' as never, latestTs)
  }
}

// ─── Apply pulled records (shared with HTTP sync) ────────────────────────────

function applyPulledRecords(records: SyncPayload): void {
  const db = getSqlite()

  const applyTable = db.transaction((table: string, rows: SyncRecord[]) => {
    if (rows.length === 0) return
    const isSettings = table === 'settings'

    if (isSettings) {
      for (const row of rows) {
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

    const tableColsRaw = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    const tableColSet = new Set(tableColsRaw.map((r) => r.name))
    const updateCol = HAS_UPDATED_AT.has(table as SyncTable) ? 'updated_at' : 'created_at'

    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => tableColSet.has(c))
      if (cols.length === 0) continue

      const placeholders = cols.map(() => '?').join(', ')
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
        // Row may reference a foreign key not yet pulled — retry next cycle
      }
    }
  })

  for (const [table, rows] of Object.entries(records)) {
    if (!(SYNC_TABLES as readonly string[]).includes(table)) {
      console.warn(`[file-sync] ignoring unknown table "${table}"`)
      continue
    }
    if (Array.isArray(rows) && rows.length > 0) applyTable(table, rows)
  }

  // Delta inventory recompute after pulling adjustments
  const pulledAdjustments = records['inventory_adjustments']
  if (Array.isArray(pulledAdjustments) && pulledAdjustments.length > 0) {
    const affected = [...new Set(pulledAdjustments.map((r) => r['product_id'] as string).filter(Boolean))]
    recomputeInventory(db, affected)
  }
}

function recomputeInventory(db: ReturnType<typeof getSqlite>, productIds: string[]): void {
  if (productIds.length === 0) return
  const now = new Date().toISOString()
  for (const pid of productIds) {
    const result = db.prepare(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_adjustments WHERE product_id = ?`
    ).get(pid) as { total: number } | undefined
    if (result == null) continue
    db.prepare(`UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?`)
      .run(Math.max(0, result.total), now, pid)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if `p` is accessible (share is online). Never throws. */
async function isPathAccessible(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Test whether a share path is reachable and looks like a valid Kinetix sync root.
 * Returns { ok, message }.
 */
export async function testSharePath(sharePath: string): Promise<{ ok: boolean; message: string }> {
  if (!sharePath?.trim()) return { ok: false, message: 'No share path configured' }
  const accessible = await isPathAccessible(sharePath.trim())
  if (!accessible) return { ok: false, message: `Cannot access: ${sharePath} — check the share name and network connection` }

  // Check for the marker file (created by the server on first run)
  const markerPath = path.join(sharePath.trim(), '.kinetix-sync')
  const hasMarker = await isPathAccessible(markerPath)
  if (!hasMarker) {
    // Path is accessible but no marker — might be wrong folder, or server hasn't started yet
    return {
      ok: true,
      message: `Share is accessible but the server marker file was not found. ` +
        `Ensure the Kinetix POS server has been started at least once with File Sync enabled.`
    }
  }

  return { ok: true, message: `Connected — share is accessible and ready` }
}
