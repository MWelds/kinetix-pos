/**
 * Shared types for the Kinetix POS sync protocol.
 * These are imported by both the server and (via copy) the terminal sync client.
 */

/** A single synced record — any table row as a plain object. */
export type SyncRecord = Record<string, unknown>

/** All syncable table names. */
export const SYNC_TABLES = [
  'categories',
  'products',
  'product_variants',
  'product_components',
  'inventory',
  'inventory_adjustments',
  'customers',
  'discount_rules',
  'gift_cards',
  'orders',
  'order_items',
  'payments',
  'staff',
  'vendors',
  'vendor_payouts',
  'settings'
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

/** Map of table → rows included in a sync payload. */
export type SyncPayload = Partial<Record<SyncTable, SyncRecord[]>>

/** Request body for POST /sync/push */
export interface PushRequest {
  terminalId: string
  records: SyncPayload
}

/** Request body for POST /sync/pull */
export interface PullRequest {
  terminalId: string
  /** ISO timestamp — only records updated after this time are returned. */
  since: string
}

/** Response body for POST /sync/pull */
export interface PullResponse {
  /** ISO timestamp from the server at time of response — store as next `since`. */
  serverTime: string
  records: SyncPayload
}

/** Response body for GET /sync/status */
export interface StatusResponse {
  ok: true
  version: string
  serverTime: string
}
