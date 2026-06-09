/**
 * Database-agnostic repository interface for the Kinetix POS sync server.
 *
 * The embedded Electron server uses `RepositorySqlite` (backed by better-sqlite3).
 * A cloud/SaaS deployment can provide a `RepositoryPostgres` implementation without
 * touching the HTTP handler logic in `server.ts`.
 */

export type SyncRecord = Record<string, unknown>
export type SyncPayload = Record<string, SyncRecord[]>

export interface V2ChangeEntry {
  seq: number
  table_name: string
  row_id: string
  /** Full current row from the source table, or null if the row was deleted. */
  row: SyncRecord | null
}

export interface SyncRepository {
  // ── v1 sync ────────────────────────────────────────────────────────────────

  /**
   * Returns all rows from `table` whose `updated_at` (or `created_at` for tables
   * without `updated_at`) is strictly greater than `since`.
   */
  getRecordsSince(table: string, since: string): SyncRecord[]

  /**
   * LWW upsert — insert or update rows, respecting last-write-wins semantics.
   * Machine-specific settings and LWW-excluded columns are protected inside
   * the implementation.
   */
  upsertRecords(table: string, records: SyncRecord[]): void

  /**
   * Recompute `inventory.quantity` from `inventory_adjustments` for the given
   * product IDs.  Must be called after any inventory_adjustments upsert.
   */
  recomputeInventory(productIds: string[]): void

  // ── v2 sync ────────────────────────────────────────────────────────────────

  /**
   * Returns deduplicated v2 change entries from the server's `sync_log` table
   * with seq > `since`, up to `limit` entries.
   *
   * Deduplication: for each (table_name, row_id) pair only the highest-seq
   * entry is returned.  The current row is fetched and embedded in `row`.
   */
  getServerV2Changes(since: number, limit?: number): V2ChangeEntry[]

  // ── settings / auth ───────────────────────────────────────────────────────

  /** Returns the raw stored value for a settings key, or undefined if not set. */
  getSetting(key: string): string | undefined

  /**
   * Returns true if `hashedPin` matches either the dashboard admin PIN or any
   * active staff member with dashboard access.
   */
  validateAdminPin(hashedPin: string): boolean
}
