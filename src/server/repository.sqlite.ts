/**
 * SQLite implementation of SyncRepository.
 *
 * Used by:
 *  - The embedded Electron sync server (passes the shared app DB handle)
 *  - The standalone Node.js server entry point (opens its own SQLite file)
 *
 * The implementation is intentionally identical to the logic that was previously
 * inlined in embedded-server.ts so that both deployment targets share the same
 * behaviour.
 */

import type { Database } from 'better-sqlite3'
import type { SyncRepository, SyncRecord, V2ChangeEntry } from './repository.interface'
import {
  SYNC_TABLES, HAS_UPDATED_AT, MACHINE_SPECIFIC_SETTINGS, LWW_EXCLUDE_COLS,
  type SyncTable,
} from '../main/sync/sync.constants'

/** Column-existence cache keyed by table name. Reset when the DB handle changes. */
const columnCache = new Map<string, Set<string>>()

function getTableColumns(db: Database, table: string): Set<string> {
  if (columnCache.has(table)) return columnCache.get(table)!
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  const cols = new Set(rows.map((r) => r.name))
  columnCache.set(table, cols)
  return cols
}

export class RepositorySqlite implements SyncRepository {
  constructor(private readonly db: Database) {}

  // ── v1 sync ────────────────────────────────────────────────────────────────

  getRecordsSince(table: string, since: string): SyncRecord[] {
    const col = HAS_UPDATED_AT.has(table as SyncTable) ? 'updated_at' : 'created_at'
    return this.db
      .prepare(`SELECT * FROM ${table} WHERE ${col} > ? ORDER BY ${col} ASC`)
      .all(since) as SyncRecord[]
  }

  upsertRecords(table: string, records: SyncRecord[]): void {
    if (records.length === 0) return
    const { db } = this

    if (table === 'settings') {
      const upsertSettings = db.transaction((rows: SyncRecord[]) => {
        for (const row of rows) {
          if (MACHINE_SPECIFIC_SETTINGS.has(row['key'] as string)) continue
          const existing = db
            .prepare('SELECT updated_at FROM settings WHERE key = ?')
            .get(row['key']) as { updated_at: string } | undefined
          if (!existing || (row['updated_at'] as string) >= existing.updated_at) {
            db.prepare(
              `INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`
            ).run(row['key'], row['value'], row['updated_at'])
          }
        }
      })
      upsertSettings(records)
      return
    }

    const existingCols = getTableColumns(db, table)
    const sample = records[0]
    const cols = Object.keys(sample).filter((c) => existingCols.has(c))
    if (cols.length === 0) {
      console.warn(`[RepositorySqlite] upsertRecords: no known columns for ${table} — skipping`)
      return
    }

    const placeholders = cols.map(() => '?').join(', ')
    const updateCol = HAS_UPDATED_AT.has(table as SyncTable) ? 'updated_at' : 'created_at'
    const lwwExclude = LWW_EXCLUDE_COLS[table as SyncTable] ?? new Set<string>()
    const setClauses = cols
      .filter((c) => c !== 'id' && !lwwExclude.has(c))
      .map(
        (c) =>
          `${c} = CASE WHEN excluded.${updateCol} >= COALESCE(${table}.${updateCol}, '') ` +
          `THEN excluded.${c} ELSE ${table}.${c} END`
      )
      .join(', ')

    const stmt = db.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${setClauses}`
    )

    const upsertMany = db.transaction((rows: SyncRecord[]) => {
      for (const row of rows) {
        try {
          stmt.run(cols.map((c) => row[c]))
        } catch (err) {
          const msg = (err as Error).message ?? ''
          if (msg.includes('UNIQUE constraint failed') && !msg.includes(`${table}.id`)) {
            console.warn(`[RepositorySqlite] skipping ${table} record (secondary unique conflict): ${msg}`)
          } else {
            throw err
          }
        }
      }
    })
    upsertMany(records)
  }

  recomputeInventory(productIds: string[]): void {
    if (productIds.length === 0) return
    const { db } = this
    const now = new Date().toISOString()
    for (const productId of productIds) {
      const result = db
        .prepare(`SELECT COALESCE(SUM(quantity),0) as total FROM inventory_adjustments WHERE product_id=?`)
        .get(productId) as { total: number } | undefined
      if (result == null) continue
      db.prepare(`UPDATE inventory SET quantity=?,updated_at=? WHERE product_id=?`)
        .run(Math.max(0, result.total), now, productId)
    }
  }

  // ── v2 sync ────────────────────────────────────────────────────────────────

  getServerV2Changes(since: number, limit = 1000): V2ChangeEntry[] {
    const { db } = this

    const entries = db.prepare(`
      SELECT seq, table_name, row_id, operation
      FROM sync_log
      WHERE seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(since, limit) as { seq: number; table_name: string; row_id: string; operation: string }[]

    if (entries.length === 0) return []

    // Deduplicate: for each (table_name, row_id), keep only the highest seq
    const seen = new Map<string, { seq: number; operation: string }>()
    for (const e of entries) {
      const key = `${e.table_name}:${e.row_id}`
      const prev = seen.get(key)
      if (!prev || e.seq > prev.seq) seen.set(key, { seq: e.seq, operation: e.operation })
    }

    const result: V2ChangeEntry[] = []
    for (const [key, { seq, operation }] of seen) {
      const colonIdx = key.indexOf(':')
      const tableName = key.slice(0, colonIdx)
      const rowId = key.slice(colonIdx + 1)

      if (!SYNC_TABLES.includes(tableName as SyncTable)) continue

      let row: SyncRecord | null = null
      if (operation !== 'DELETE') {
        const pkCol = tableName === 'settings' ? 'key' : 'id'
        try {
          const fetched = db.prepare(`SELECT * FROM ${tableName} WHERE ${pkCol} = ?`).get(rowId) as SyncRecord | undefined
          row = fetched ?? null
          // Strip machine-specific settings from the payload
          if (tableName === 'settings' && row && MACHINE_SPECIFIC_SETTINGS.has(row['key'] as string)) {
            row = null
          }
        } catch {
          row = null
        }
      }

      if (operation === 'DELETE' || row !== null) {
        result.push({ seq, table_name: tableName, row_id: rowId, row })
      }
    }

    // Sort by seq so the terminal can safely advance its cursor
    result.sort((a, b) => a.seq - b.seq)
    return result
  }

  // ── settings / auth ───────────────────────────────────────────────────────

  getSetting(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value
  }

  validateAdminPin(hashedPin: string): boolean {
    const { db } = this
    try {
      const appPin = this.getSetting('dashboardAdminPin')
      if (appPin && appPin === hashedPin) return true
    } catch { /* fall through */ }
    try {
      const staffRow = db.prepare(
        `SELECT id FROM staff WHERE pin=? AND is_active=1 AND can_access_dashboard=1`
      ).get(hashedPin)
      if (staffRow) return true
    } catch { /* fall through */ }
    return false
  }
}
