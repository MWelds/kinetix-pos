/**
 * File-based sync server processor.
 *
 * Runs on the SERVER machine.  On a timer it:
 *   1. Reads terminal push files from {syncRoot}/push/, applies them to the
 *      server's local SQLite database, then moves them to push/processed/.
 *   2. Queries the server DB for records changed since the last export and
 *      writes them to {syncRoot}/pull/server-{timestamp}.json for terminals
 *      to read.
 *   3. Cleans up pull files older than PULL_FILE_TTL_DAYS.
 *
 * The sync root is created automatically on first use.  The caller is
 * responsible for creating the Windows network share so terminals can reach it.
 */

import fs from 'fs'
import path from 'path'
import { getSqlite } from '../database/connection'
import { settingsService } from '../services/settings.service'
import type { SyncRecord, SyncPayload } from './sync.types'

// ─── Config ───────────────────────────────────────────────────────────────────

/** Pull files older than this are deleted to prevent the share from filling up. */
const PULL_FILE_TTL_DAYS = 7

const SYNC_TABLES = [
  'categories', 'products', 'product_variants', 'product_components',
  'inventory', 'inventory_adjustments',
  'customers', 'discount_rules', 'gift_cards',
  'orders', 'order_items', 'payments',
  'staff', 'vendors', 'vendor_payouts', 'settings'
] as const

type SyncTable = (typeof SYNC_TABLES)[number]

const TABLES_WITH_UPDATED_AT = new Set<SyncTable>([
  'categories', 'products', 'product_variants', 'customers',
  'discount_rules', 'gift_cards', 'orders', 'order_items',
  'staff', 'vendors', 'settings', 'inventory'
])

const MACHINE_SPECIFIC_SETTINGS = new Set([
  'nodeMode', 'setupComplete', 'terminalId',
  'syncEnabled', 'syncUrl', 'syncApiKey', 'syncIntervalSeconds', 'lastSyncAt',
  'embeddedServerPort', 'embeddedServerApiKey', 'dashboardAdminPin',
  'syncMode', 'syncSharePath', 'fileSyncLastPullAt'
])

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null

/**
 * Start the server-side file sync processor.
 * @param localPath  Absolute local path to the sync share root (e.g. C:\KinetixSync)
 * @param intervalSeconds  How often to poll for new push files (default 30 s)
 */
export function startFileSyncServer(localPath: string, intervalSeconds = 30): void {
  stopFileSyncServer()
  // Ensure the share directory structure exists and write the marker file
  ensureShareDirectories(localPath).catch((err) =>
    console.error('[file-sync-server] could not create share directories:', err)
  )
  // Run immediately, then on the interval
  processFilesOnce(localPath).catch((err) =>
    console.error('[file-sync-server] initial processing error:', err)
  )
  intervalHandle = setInterval(() => {
    processFilesOnce(localPath).catch((err) =>
      console.error('[file-sync-server] processing error:', err)
    )
  }, intervalSeconds * 1000)
  console.log(`[file-sync-server] started — watching ${localPath} every ${intervalSeconds}s`)
}

export function stopFileSyncServer(): void {
  if (intervalHandle !== null) { clearInterval(intervalHandle); intervalHandle = null }
  console.log('[file-sync-server] stopped')
}

// ─── Share layout ─────────────────────────────────────────────────────────────

async function ensureShareDirectories(root: string): Promise<void> {
  await fs.promises.mkdir(path.join(root, 'push', 'processed'), { recursive: true })
  await fs.promises.mkdir(path.join(root, 'pull'), { recursive: true })
  // Write marker file so terminals can verify the share is correct
  const markerPath = path.join(root, '.kinetix-sync')
  try {
    await fs.promises.writeFile(markerPath, JSON.stringify({ server: true, createdAt: new Date().toISOString() }), 'utf8')
  } catch {
    // Non-fatal — terminal path test falls back gracefully
  }
}

// ─── One processing cycle ─────────────────────────────────────────────────────

async function processFilesOnce(root: string): Promise<void> {
  await applyTerminalPushFiles(root)
  await exportServerChanges(root)
  await cleanOldPullFiles(root)
}

// ─── Step 1: Apply push files from terminals ──────────────────────────────────

async function applyTerminalPushFiles(root: string): Promise<void> {
  const pushDir = path.join(root, 'push')
  const processedDir = path.join(pushDir, 'processed')
  await fs.promises.mkdir(processedDir, { recursive: true })

  let files: string[]
  try {
    files = (await fs.promises.readdir(pushDir))
      .filter((f) => f.endsWith('.json'))
      .sort()
  } catch {
    return
  }

  for (const file of files) {
    const filePath = path.join(pushDir, file)
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8')
      const payload = JSON.parse(raw) as { terminalId?: string; records?: SyncPayload; pushedAt?: string }
      if (!payload.records) {
        console.warn(`[file-sync-server] push file ${file} has no records — skipping`)
        await moveToProcessed(filePath, processedDir, file)
        continue
      }
      applyPushPayload(payload.records)
      console.log(`[file-sync-server] applied push file: ${file}`)
      await moveToProcessed(filePath, processedDir, file)
    } catch (err) {
      console.error(`[file-sync-server] error processing push file ${file}:`, (err as Error).message)
      // Leave file in place — retry next cycle
    }
  }
}

async function moveToProcessed(filePath: string, processedDir: string, filename: string): Promise<void> {
  const dest = path.join(processedDir, filename)
  try {
    await fs.promises.rename(filePath, dest)
  } catch {
    // If rename fails (e.g. cross-device on a network share), try copy+delete
    try {
      await fs.promises.copyFile(filePath, dest)
      await fs.promises.unlink(filePath)
    } catch (err2) {
      console.warn(`[file-sync-server] could not move ${filename} to processed:`, (err2 as Error).message)
    }
  }
}

function applyPushPayload(records: SyncPayload): void {
  const db = getSqlite()

  const applyTable = db.transaction((table: SyncTable, rows: SyncRecord[]) => {
    if (rows.length === 0) return

    if (table === 'settings') {
      for (const row of rows) {
        if (MACHINE_SPECIFIC_SETTINGS.has(row['key'] as string)) continue
        const existing = db.prepare('SELECT updated_at FROM settings WHERE key = ?').get(row['key']) as { updated_at: string } | undefined
        if (!existing || (row['updated_at'] as string) >= existing.updated_at) {
          db.prepare(
            `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          ).run(row['key'], row['value'], row['updated_at'])
        }
      }
      return
    }

    // Intersect pushed columns with actual DB schema to handle version mismatches
    const existingCols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name)
    )
    const sample = rows[0]
    const cols = Object.keys(sample).filter((c) => existingCols.has(c))
    if (cols.length === 0) {
      console.warn(`[file-sync-server] no known columns for ${table} — skipping`)
      return
    }

    const placeholders = cols.map(() => '?').join(', ')
    const updateCol = TABLES_WITH_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'
    const setClauses = cols
      .filter((c) => c !== 'id')
      .map((c) =>
        `${c} = CASE WHEN excluded.${updateCol} >= COALESCE(${table}.${updateCol}, '') THEN excluded.${c} ELSE ${table}.${c} END`
      )
      .join(', ')

    const stmt = db.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${setClauses}`
    )

    for (const row of rows) {
      try { stmt.run(cols.map((c) => row[c])) }
      catch (err) {
        const msg = (err as Error).message ?? ''
        if (msg.includes('UNIQUE constraint failed') && !msg.includes(`${table}.id`)) {
          console.warn(`[file-sync-server] skipping ${table} (secondary unique conflict): ${msg}`)
        }
      }
    }
  })

  for (const [table, rows] of Object.entries(records)) {
    if (!(SYNC_TABLES as readonly string[]).includes(table)) {
      console.warn(`[file-sync-server] unknown table "${table}" — ignoring`)
      continue
    }
    if (Array.isArray(rows) && rows.length > 0) {
      applyTable(table as SyncTable, rows)
    }
  }

  // Recompute inventory from adjustments for affected products
  const adjRows = records['inventory_adjustments']
  if (Array.isArray(adjRows) && adjRows.length > 0) {
    const productIds = [...new Set(adjRows.map((r) => r['product_id'] as string).filter(Boolean))]
    recomputeInventory(db, productIds)
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

// ─── Step 2: Export server changes for terminals ──────────────────────────────

async function exportServerChanges(root: string): Promise<void> {
  const lastExport = settingsService.get('fileSyncServerLastExport' as never) || '1970-01-01T00:00:00.000Z'
  const db = getSqlite()
  const records: SyncPayload = {}

  for (const table of SYNC_TABLES) {
    const col = TABLES_WITH_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'
    try {
      const rows = db.prepare(
        `SELECT * FROM ${table} WHERE ${col} > ? ORDER BY ${col} ASC`
      ).all(lastExport) as SyncRecord[]

      // Strip machine-specific settings
      const filtered = table === 'settings'
        ? rows.filter((r) => !MACHINE_SPECIFIC_SETTINGS.has(r['key'] as string))
        : rows

      if (filtered.length > 0) records[table] = filtered
    } catch (err) {
      console.warn(`[file-sync-server] export: skipping "${table}":`, (err as Error).message)
    }
  }

  const totalRows = Object.values(records).reduce((n, r) => n + r.length, 0)
  const serverTime = new Date().toISOString()

  // Always write a pull file (even if empty) so terminals can advance their cursor
  // Only write when there are actual changes to keep the pull folder lean
  if (totalRows === 0) {
    settingsService.set('fileSyncServerLastExport' as never, serverTime)
    return
  }

  const pullDir = path.join(root, 'pull')
  await fs.promises.mkdir(pullDir, { recursive: true })

  const timestamp = serverTime.replace(/[:.]/g, '-')
  const filename = `server-${timestamp}.json`
  const payload = JSON.stringify({ serverTime, since: lastExport, records })

  await fs.promises.writeFile(path.join(pullDir, filename), payload, 'utf8')
  settingsService.set('fileSyncServerLastExport' as never, serverTime)
  console.log(`[file-sync-server] exported ${totalRows} row(s) → pull/${filename}`)
}

// ─── Step 3: Cleanup old pull files ──────────────────────────────────────────

async function cleanOldPullFiles(root: string): Promise<void> {
  const pullDir = path.join(root, 'pull')
  const cutoff = Date.now() - PULL_FILE_TTL_DAYS * 24 * 60 * 60 * 1000
  let files: string[]
  try {
    files = (await fs.promises.readdir(pullDir)).filter((f) => f.endsWith('.json'))
  } catch { return }

  for (const file of files) {
    try {
      const stat = await fs.promises.stat(path.join(pullDir, file))
      if (stat.mtimeMs < cutoff) {
        await fs.promises.unlink(path.join(pullDir, file))
        console.log(`[file-sync-server] cleaned old pull file: ${file}`)
      }
    } catch { /* ignore */ }
  }
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Returns the default local share path for this installation.
 * The app creates this folder automatically; the admin only needs to share it.
 */
export function getDefaultLocalSharePath(userData: string): string {
  return path.join(userData, 'sync-share')
}
