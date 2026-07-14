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
 * Dependency-ordered (topological) list used when APPLYING synced records.
 *
 * SYNC_TABLES is a transfer manifest, not an apply order. Applying records in
 * that order inserts children before their foreign-key parents — e.g. an
 * `orders` row (which references shifts/staff/customers/discount_rules) is
 * applied before those rows exist locally, so SQLite rejects it with a foreign
 * key violation. The apply code caught and skipped those rows, and because the
 * v2 sequence cursor still advanced, the dropped order was never re-sent — which
 * is why orders never replicated between terminals.
 *
 * This list orders every referenced (parent) table before the tables that
 * reference it, so FK constraints are satisfied at insert time. Apply UPSERTS in
 * this order; apply DELETES in the reverse order (children before parents).
 */
export const SYNC_APPLY_ORDER = [
  // ── Parents / referenced tables (no outgoing FKs, or only to earlier rows) ──
  'categories',
  'customers',
  'staff',
  'vendors',
  'gift_cards',
  'products',            // → categories
  'product_variants',    // → products
  'product_components',  // → products
  'discount_rules',      // → categories, products
  'inventory',           // → products, product_variants
  'inventory_adjustments', // → products, product_variants
  'shifts',              // → staff
  // ── Children that reference the tables above ────────────────────────────────
  'orders',              // → customers, staff, shifts, discount_rules
  'order_items',         // → orders, products, product_variants
  'payments',            // → orders
  'vendor_payouts',      // → vendors
  'settings',
] as const satisfies readonly SyncTable[]

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

    // Cloud sync — hub-specific, must never propagate to terminals
  'cloudSyncEnabled',
  'cloudSyncUrl',
  'cloudSyncIntervalSeconds',
  'storeId',
  'cloudApiKey',
  'cloudPushWatermark',
  'cloudPullWatermark',

  // Automatic DB backups — paths and timestamps are per-machine
  'backupEnabled',
  'backupIntervalHours',
  'backupRetention',
  'backupCustomPath',
  'lastBackupAt',

  // SMTP password is encrypted at rest with this machine's OS keystore, so the
  // ciphertext is only decryptable here — it must never sync to other terminals.
  // Configure email per-terminal (typically only the register that sends mail).
  'emailPassword',
]) satisfies ReadonlySet<string>
