/**
 * Shared sync constants — single source of truth.
 *
 * Import from here in ALL sync-related files:
 *   sync.service.ts, embedded-server.ts,
 *   file-sync.service.ts, file-sync-server.ts
 *
 * When adding a new table to sync:
 *   1. Add it to SYNC_TABLES
 *   2. If it has an updated_at column, add it to HAS_UPDATED_AT
 *   3. That's it — all four sync files pick up the change automatically.
 */

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
  'shifts',
  'vendors',
  'vendor_payouts',
  'settings',
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

/**
 * Tables tracked by updated_at for bidirectional upsert (last-write-wins).
 *
 * NOTE: 'inventory' is intentionally included here so that fields like
 * low_stock_threshold sync correctly. However, the quantity column is
 * EXCLUDED from LWW updates (see INVENTORY_LWW_EXCLUDE_COLS) — it must
 * always be derived from the inventory_adjustments sum, never overwritten
 * by a pushed/pulled quantity value.
 */
export const HAS_UPDATED_AT = new Set<SyncTable>([
  'categories',
  'products',
  'product_variants',
  'customers',
  'discount_rules',
  'gift_cards',
  'orders',
  'order_items',
  'staff',
  'shifts',
  'vendors',
  'settings',
  'inventory',
])

/**
 * Columns that must never be overwritten by LWW upsert for a given table.
 * The recompute pass (recomputeInventoryFromAdjustments) is the sole writer
 * for inventory.quantity — a terminal's locally-cached quantity value must
 * not be allowed to overwrite the server's correctly-summed value.
 */
export const LWW_EXCLUDE_COLS: Partial<Record<SyncTable, Set<string>>> = {
  inventory: new Set(['quantity']),
}

/**
 * Settings keys that are machine-specific and must NEVER cross machine
 * boundaries via sync. Syncing these would overwrite a terminal's sync URL,
 * port, or API key with the server's values (or vice-versa), breaking future
 * syncs entirely.
 *
 * Only business-level settings (store name, tax rates, receipt templates,
 * currency config, loyalty rules, etc.) should travel between machines.
 */
export const MACHINE_SPECIFIC_SETTINGS = new Set([
  'nodeMode',
  'setupComplete',
  'terminalId',
  'syncEnabled',
  'syncUrl',
  'syncApiKey',
  'syncIntervalSeconds',
  'lastSyncAt',
  'embeddedServerPort',
  'embeddedServerApiKey',
  'dashboardAdminPin',
  'syncMode',
  'syncSharePath',
  'fileSyncLastPullAt',
  
  // v2 sync cursors — machine-specific, must never cross machine boundaries
  'syncVersion',
  'v2TerminalPushSeq',
  'v2ServerPullSeq',
  'fileSyncServerLastExport',
])
