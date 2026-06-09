/**
 * Sync Queue (Outbox) Service
 *
 * Terminals write orders, payments and inventory adjustments here immediately
 * after saving them locally.  The background sync worker flushes pending items
 * to the server and marks them delivered once confirmed.  Items are retried
 * automatically on the next sync cycle if the server was unreachable.
 *
 * Only terminal machines enqueue records — server and standalone machines skip
 * enqueueing entirely because they write directly to the authoritative DB.
 */

import { getSqlite } from '../database/connection'
import { generateId } from '../lib/id'
import { settingsService } from '../services/settings.service'

/** Tables that flow terminal → server via the outbox queue. */
export const QUEUE_TABLES = new Set([
  'orders',
  'order_items',
  'payments',
  'inventory_adjustments',
  'vendor_payouts',
])

export interface QueueItem {
  id: string
  table_name: string
  record_id: string
  payload: string // JSON string
}

/**
 * Enqueue one or more records for delivery to the server.
 * No-ops on server/standalone machines.
 */
export function enqueue(tableName: string, records: Record<string, unknown>[]): void {
  if (records.length === 0) return
  const nodeMode = settingsService.get('nodeMode')
  if (nodeMode === 'server' || nodeMode === 'standalone' || !nodeMode) return

  const db = getSqlite()
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sync_queue (id, table_name, record_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction((rows: Record<string, unknown>[]) => {
    for (const record of rows) {
      insert.run(generateId(), tableName, String(record['id'] ?? ''), JSON.stringify(record), now)
    }
  })
  try {
    insertAll(records)
  } catch (err) {
    console.warn(`[sync-queue] enqueue failed for ${tableName}:`, (err as Error).message)
  }
}

/** Return up to `limit` undelivered queue items, oldest first. */
export function getPendingItems(limit = 200): QueueItem[] {
  const db = getSqlite()
  try {
    return db.prepare(`
      SELECT id, table_name, record_id, payload
      FROM sync_queue
      WHERE delivered = 0
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as QueueItem[]
  } catch {
    return []
  }
}

/** Mark items as successfully delivered. */
export function markDelivered(ids: string[]): void {
  if (ids.length === 0) return
  const db = getSqlite()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`UPDATE sync_queue SET delivered = 1 WHERE id IN (${placeholders})`).run(...ids)
}

/** Increment attempt counter for items that failed this cycle. */
export function markAttempted(ids: string[]): void {
  if (ids.length === 0) return
  const db = getSqlite()
  const now = new Date().toISOString()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`
    UPDATE sync_queue SET attempts = attempts + 1, last_attempted_at = ?
    WHERE id IN (${placeholders})
  `).run(now, ...ids)
}

/** How many items are currently waiting to be delivered. */
export function pendingCount(): number {
  const db = getSqlite()
  try {
    const row = db.prepare(`SELECT COUNT(*) as n FROM sync_queue WHERE delivered = 0`).get() as { n: number }
    return row.n
  } catch {
    return 0
  }
}

/** Remove delivered items older than `daysOld` days to keep the table lean. */
export function cleanupDelivered(daysOld = 7): void {
  const db = getSqlite()
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString()
  try {
    db.prepare(`DELETE FROM sync_queue WHERE delivered = 1 AND created_at < ?`).run(cutoff)
  } catch { /* non-fatal */ }
}
