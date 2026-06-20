import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'

/** Schema version — increment whenever tables change */
const SCHEMA_VERSION = 28

/**
 * Runs idempotent DDL migrations on first launch.
 * Uses a schema_version table to track applied version.
 */
export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `)

  const row = sqlite.prepare('SELECT version FROM schema_version').get() as
    | { version: number }
    | undefined
  const currentVersion = row?.version ?? 0

  if (currentVersion < 1) {
    applyV1(sqlite)
  }
  if (currentVersion < 2) {
    applyV2(sqlite)
  }
  if (currentVersion < 3) {
    applyV3(sqlite)
  }
  if (currentVersion < 4) {
    applyV4(sqlite)
  }
  if (currentVersion < 5) {
    applyV5(sqlite)
  }
  if (currentVersion < 6) {
    applyV6(sqlite)
  }
  if (currentVersion < 7) {
    applyV7(sqlite)
  }
  if (currentVersion < 8) {
    applyV8(sqlite)
  }
  if (currentVersion < 9) {
    applyV9(sqlite)
  }
  if (currentVersion < 10) {
    applyV10(sqlite)
  }
  if (currentVersion < 11) {
    applyV11(sqlite)
  }
  if (currentVersion < 12) {
    applyV12(sqlite)
  }
  if (currentVersion < 13) {
    applyV13(sqlite)
  }
  if (currentVersion < 14) {
    applyV14(sqlite)
  }
  if (currentVersion < 15) {
    applyV15(sqlite)
  }
  if (currentVersion < 16) {
    applyV16(sqlite)
  }
  if (currentVersion < 17) {
    applyV17(sqlite)
  }
  if (currentVersion < 18) {
    applyV18(sqlite)
  }
  if (currentVersion < 19) {
    applyV19(sqlite)
  }
  // V20 previously called applyV19 again which re-ran the bcrypt PIN reset on every
  // machine upgrading past V19. This was a bug — applyV19 is removed from V20.
  // V21 heals any staff whose PIN was left as a bcrypt hash by V19/V20 by
  // re-hashing them to the correct SHA-256+salt format used by the auth system.
  if (currentVersion < 21) {
    applyV21(sqlite)
  }
  // V22 re-runs V21 with the corrected substr() query — machines that already ran
  // V21 had their PINs silently left broken due to the $2% named-parameter bug.
  if (currentVersion < 22) {
    applyV21(sqlite)
  }
  // V23: Add sync_queue outbox table for reliable terminal → server delivery.
  if (currentVersion < 23) {
    applyV23(sqlite)
  }
  // V24: Add updated_at and deleted_at to shifts so they can participate in
  // bidirectional sync. Without updated_at, closing a shift on one terminal
  // would never propagate to other terminals or the server.
  if (currentVersion < 24) {
    applyV24(sqlite)
  }
  // V25: Add sync_log table and SQLite triggers for the new seq-based sync
  // protocol (v2). The log captures every INSERT/UPDATE/DELETE on synced tables
  // as an append-only sequence of change events.  The v2 push/pull uses these
  // sequence numbers as cursors instead of wall-clock timestamps, eliminating
  // clock-skew bugs and race conditions in the v1 watermark approach.
  if (currentVersion < 25) {
    applyV25(sqlite)
  }

  // V26: Idempotent heal for updated_at / deleted_at on shifts.
  //
  // V24 added these columns, but DBs that were already at schema_version=25
  // (i.e. every machine that upgraded incrementally through v1.0.99) skipped
  // V24 because `currentVersion < 24` evaluated to false.  As a result those
  // installations have no `updated_at` column on shifts, causing ALL shift
  // queries to fail with "no such column: updated_at" and preventing users
  // from opening or closing shifts.
  //
  // SQLite cannot add a NOT NULL column with a non-constant DEFAULT expression
  // to a table that already has rows, so V26 adds the column as nullable TEXT
  // and then back-fills it from opened_at.
  if (currentVersion < 26) {
    applyV26(sqlite)
  }

  // V28: Delete stuck 'POS-NaN' pending orders created by the generateOrderNumber
  // bug where a REF- refund order was the most recent order, causing parseInt to
  // return NaN. These orphaned rows block all future sales with a UNIQUE constraint.
  if (currentVersion < 28) {
    try {
      sqlite.exec(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'POS-NaN%')`)
      sqlite.exec(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'POS-NaN%')`)
      sqlite.exec(`DELETE FROM orders WHERE order_number LIKE 'POS-NaN%'`)
    } catch { /* non-fatal */ }
  }

  // V27: Re-run the shifts column heal unconditionally for machines that
  // reached schema_version=26 via a build that called applyV26() but the
  // function body was missing (truncated source file).  applyV26 is fully
  // idempotent (try/catch around each ALTER TABLE), so running it again is safe.
  if (currentVersion < 27) {
    applyV26(sqlite)
  }

  if (currentVersion < SCHEMA_VERSION) {
    sqlite.prepare('DELETE FROM schema_version').run()
    sqlite.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION)
  }
}

/**
 * V2: Add order_type column to orders (instore/delivery).
 * Uses ALTER TABLE with error suppression so it is idempotent on re-runs.
 */
function applyV2(sqlite: Database.Database): void {
  try {
    sqlite.exec(`ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'instore'`)
  } catch {
    // Column already exists -- ignore
  }
}

/**
 * V3: Add pack/individual product link columns to products.
 * units_per_pack > 1 means this is a pack product (e.g. "Box of 100 Spoons").
 * individual_product_id links the pack to its auto-created individual SKU.
 * pack_product_id links the individual back to its parent pack.
 */
function applyV3(sqlite: Database.Database): void {
  const cols = [
    `ALTER TABLE products ADD COLUMN units_per_pack INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE products ADD COLUMN individual_product_id TEXT REFERENCES products(id)`,
    `ALTER TABLE products ADD COLUMN pack_product_id TEXT REFERENCES products(id)`
  ]
  for (const ddl of cols) {
    try {
      sqlite.exec(ddl)
    } catch {
      // Column already exists -- ignore
    }
  }
}

/**
 * V4: Add vendor/consignment support.
 * - vendors table: tracks vendors for consignment products.
 * - vendor_payouts table: records payments made to vendors.
 * - products.vendor_id / vendor_cost: link a product to a vendor and record per-unit cost.
 */
function applyV4(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS vendor_payouts (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      amount REAL NOT NULL,
      note TEXT,
      staff_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)

  const productCols = [
    'ALTER TABLE products ADD COLUMN vendor_id TEXT REFERENCES vendors(id)',
    'ALTER TABLE products ADD COLUMN vendor_cost REAL'
  ]
  for (const ddl of productCols) {
    try { sqlite.exec(ddl) } catch { /* column already exists */ }
  }
}

/**
 * V5: Add track_stock column to products.
 * When false, the product is a service/non-physical item (e.g. "Print Services").
 * Out-of-stock checks and inventory deductions are skipped for these products.
 */
function applyV5(sqlite: Database.Database): void {
  try {
    sqlite.exec(`ALTER TABLE products ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 1`)
  } catch {
    // Column already exists -- ignore
  }
}

/**
 * V6: Add deleted_at column to all synced tables for soft-delete support.
 * When a record is deleted it gets deleted_at = ISO timestamp instead of a
 * hard DELETE, so the tombstone can propagate to other terminals via sync.
 * Also seeds the terminalId and sync-related settings rows.
 */
function applyV6(sqlite: Database.Database): void {
  const syncedTables = [
    'products', 'categories', 'product_variants', 'product_components',
    'customers', 'orders', 'order_items', 'payments',
    'discount_rules', 'gift_cards', 'vendors', 'vendor_payouts',
    'inventory', 'inventory_adjustments'
  ]
  for (const table of syncedTables) {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`)
    } catch {
      // Column already exists — ignore
    }
  }

  // Seed sync-related settings keys if not already present
  const syncSettings = [
    ['syncEnabled', 'false'],
    ['syncUrl', ''],
    ['syncApiKey', ''],
    ['syncIntervalSeconds', '30'],
    ['terminalId', crypto.randomUUID()]
  ]
  for (const [key, value] of syncSettings) {
    sqlite
      .prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .run(key, value, new Date().toISOString())
  }
}

/** V7: Seed setup wizard settings. */
function applyV7(sqlite: Database.Database): void {
  const { randomBytes } = require('crypto') as typeof import('crypto')
  const setupSettings: [string, string][] = [
    ['setupComplete', 'false'],
    ['nodeMode', ''],                                          // 'standalone' | 'server' | 'terminal'
    ['embeddedServerPort', '3030'],
    ['embeddedServerApiKey', randomBytes(24).toString('hex')] // auto-generated secure key
  ]
  for (const [key, value] of setupSettings) {
    sqlite
      .prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .run(key, value, new Date().toISOString())
  }
}

/**
 * V9: Belt-and-suspenders repeat of the V8 column additions.
 * Databases that were already recorded as schema_version=8 before V8 was
 * implemented never had the ALTER TABLE run.  This migration re-applies the
 * same idempotent DDL so those databases are healed on the next launch.
 */
function applyV9(sqlite: Database.Database): void {
  const cols = [
    `ALTER TABLE product_components ADD COLUMN created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    `ALTER TABLE gift_cards ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ]
  for (const ddl of cols) {
    try {
      sqlite.exec(ddl)
    } catch {
      // Column already exists — this is the normal case for databases that ran V8 correctly
    }
  }
}

/**
 * V8: Add created_at to product_components (was missing, causing sync to crash).
 * Also adds updated_at to gift_cards so the HAS_UPDATED_AT sync set is consistent.
 */
function applyV8(sqlite: Database.Database): void {
  const cols = [
    `ALTER TABLE product_components ADD COLUMN created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    `ALTER TABLE gift_cards ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  ]
  for (const ddl of cols) {
    try {
      sqlite.exec(ddl)
    } catch {
      // Column already exists — ignore
    }
  }
}

function applyV1(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT,
      description TEXT,
      category_id TEXT REFERENCES categories(id),
      base_price REAL NOT NULL,
      cost_price REAL,
      image_url TEXT,
      is_composite INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      tax_rate REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT,
      price_modifier REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS product_components (
      id TEXT PRIMARY KEY,
      composite_product_id TEXT NOT NULL REFERENCES products(id),
      component_product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      variant_id TEXT REFERENCES product_variants(id),
      quantity REAL NOT NULL DEFAULT 0,
      low_stock_threshold REAL NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);

    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      variant_id TEXT REFERENCES product_variants(id),
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      note TEXT,
      staff_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      loyalty_points INTEGER NOT NULL DEFAULT 0,
      store_credit REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      pin TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id),
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opening_cash REAL NOT NULL DEFAULT 0,
      closing_cash REAL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS discount_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      min_order_amount REAL,
      category_id TEXT REFERENCES categories(id),
      product_id TEXT REFERENCES products(id),
      coupon_code TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      valid_from TEXT,
      valid_until TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      customer_id TEXT REFERENCES customers(id),
      staff_id TEXT REFERENCES staff(id),
      shift_id TEXT REFERENCES shifts(id),
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      notes TEXT,
      discount_id TEXT REFERENCES discount_rules(id),
      manual_discount_type TEXT,
      manual_discount_value REAL,
      loyalty_points_earned INTEGER NOT NULL DEFAULT 0,
      loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      variant_id TEXT REFERENCES product_variants(id),
      product_name TEXT NOT NULL,
      variant_name TEXT,
      sku TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      reference TEXT,
      change_given REAL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

    CREATE TABLE IF NOT EXISTS gift_cards (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      balance REAL NOT NULL,
      initial_balance REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      staff_id TEXT REFERENCES staff(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_staff ON audit_log(staff_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('storeName', 'My Store'),
      ('taxRate', '0.08'),
      ('taxEnabled', 'true'),
      ('currency', 'USD'),
      ('receiptFooter', 'Thank you for your purchase!');
  `)
}

/**
 * V11: Seed admin web dashboard settings keys.
 * - adminWebPort: HTTP port for the admin dashboard (default 3001)
 * - adminWebToken: auth token (empty string — auto-generated on first start)
 */
function applyV11(sqlite: Database.Database): void {
  const seeds: [string, string][] = [
    ['adminWebPort', '3001'],
    ['adminWebToken', '']
  ]
  for (const [key, value] of seeds) {
    sqlite
      .prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .run(key, value, new Date().toISOString())
  }
}

/**
 * V13: Add deleted_at column to customers table for soft-delete support.
 */
function applyV13(sqlite: Database.Database): void {
  try {
    sqlite.exec(`ALTER TABLE customers ADD COLUMN deleted_at TEXT`)
  } catch {
    // Column already exists — idempotent
  }
}

/**
 * V12: Add can_access_dashboard flag to staff table.
 * Staff with this flag set can log into the browser-based admin dashboard.
 */
function applyV12(sqlite: Database.Database): void {
  try {
    sqlite.exec(`ALTER TABLE staff ADD COLUMN can_access_dashboard INTEGER NOT NULL DEFAULT 0`)
  } catch {
    // Column already exists — idempotent
  }
}

/**
 * V10: Add terminal_id to orders so sales can be broken down by register.
 * Falls back to 'unknown' for historical orders created before this migration.
 */
function applyV10(sqlite: Database.Database): void {
  try {
    sqlite.exec(`ALTER TABLE orders ADD COLUMN terminal_id TEXT NOT NULL DEFAULT 'unknown'`)
  } catch {
    // Column already exists — idempotent
  }
}

/**
 * V14: Add performance indexes for common query patterns.
 *
 * Before this migration every product list query performed a full table scan.
 * These indexes reduce category-filtered product lookups, barcode scans, text
 * searches, inventory joins, and report-range queries from O(n) to O(log n).
 * All are created with IF NOT EXISTS so the migration is fully idempotent.
 */
function applyV14(sqlite: Database.Database): void {
  sqlite.exec(`
    -- Product list: filter active products, optionally by category
    CREATE INDEX IF NOT EXISTS idx_products_active_category
      ON products (is_active, category_id);

    -- Barcode lookup (byBarcode / scanner flow)
    CREATE INDEX IF NOT EXISTS idx_products_barcode
      ON products (barcode)
      WHERE barcode IS NOT NULL;

    -- Text search on name and SKU
    CREATE INDEX IF NOT EXISTS idx_products_name
      ON products (name);
    CREATE INDEX IF NOT EXISTS idx_products_sku
      ON products (sku);

    -- Inventory join: product_id is the FK used in every product SELECT
    CREATE INDEX IF NOT EXISTS idx_inventory_product_id
      ON inventory (product_id);

    -- Order queries filtered by status + date range (reports, EOD)
    CREATE INDEX IF NOT EXISTS idx_orders_status_created
      ON orders (status, created_at);

    -- Order items join used by reports and receipt reprints
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id
      ON order_items (order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product_id
      ON order_items (product_id);

    -- Payments join used by payment breakdown report
    CREATE INDEX IF NOT EXISTS idx_payments_order_id
      ON payments (order_id);

    -- Customer lookup by email / phone (customer search)
    CREATE INDEX IF NOT EXISTS idx_customers_email
      ON customers (email)
      WHERE email IS NOT NULL;
  `)
}

/**
 * V15: Clear the 'My Store' placeholder that was seeded in V1 so receipts
 * no longer print a generic store name the user never configured.
 * Only clears the value if the user hasn't changed it from the original default.
 */
function applyV15(sqlite: Database.Database): void {
  sqlite.prepare(
    `UPDATE settings SET value = '' WHERE key = 'storeName' AND value = 'My Store'`
  ).run()
}

/**
 * V16: Add terminal_name column to orders so EOD reports can show a
 * human-readable register label alongside each terminal's totals.
 */
function applyV16(sqlite: Database.Database): void {
  try {
    sqlite.exec(`ALTER TABLE orders ADD COLUMN terminal_name TEXT NOT NULL DEFAULT ''`)
  } catch {
    // Column already exists — ignore
  }
}

/**
 * V17: Add currency column to payments so the original payment currency
 * (e.g. USD vs KYD) is preserved. Amounts are still stored in the store
 * currency; this column records what the customer actually handed over.
 * Existing rows default to the store primary currency (KYD).
 */
function applyV17(sqlite: Database.Database): void {
  try {
    sqlite.exec(`ALTER TABLE payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'KYD'`)
  } catch {
    // Column already exists — ignore
  }
}

/**
 * V18: Add original_amount to payments — the amount as tendered by the customer
 * in their chosen currency (e.g. US$10.00 when currency='USD').  The existing
 * `amount` column holds the store-currency equivalent used for accounting.
 * Existing rows default to amount (no conversion possible after the fact).
 */
function applyV18(sqlite: Database.Database): void {
  try {
    sqlite.exec(`ALTER TABLE payments ADD COLUMN original_amount REAL`)
  } catch {
    // Column already exists — ignore
  }
  // Back-fill: for existing rows where original_amount is NULL, default to amount
  // (they were single-currency stores so amount == original_amount).
  try {
    sqlite.exec(`UPDATE payments SET original_amount = amount WHERE original_amount IS NULL`)
  } catch { /* ignore */ }
}

/**
 * V19: Reset all admin staff PINs to '0000'.
 * Uses bcryptjs directly so the hash is guaranteed compatible with the auth system.
 * Runs once on upgrade so a locked-out admin can log in immediately.
 * Admins should change their PIN after first login.
 */
function applyV19(sqlite: Database.Database): void {
  try {
    const hash = bcrypt.hashSync('0000', 10)
    sqlite.prepare(`UPDATE staff SET pin = ? WHERE role = 'admin'`).run(hash)
  } catch (err) {
    console.error('[V19] Failed to reset admin PIN:', err)
  }
}

/**
 * V21: Fix PINs broken by V19/V20 calling bcrypt incorrectly.
 *
 * V19 and an erroneous V20 call reset admin PINs to bcrypt hashes of '0000'.
 * The app's auth system uses SHA-256 + per-installation salt, not bcrypt, so
 * those hashes never match and admins are locked out after every upgrade.
 *
 * This migration detects bcrypt-hashed PINs (they start with '$2') for ALL
 * staff roles and re-hashes them to SHA-256('0000') using the correct system.
 * Staff should change their PIN after logging in with '0000'.
 */
function applyV21(sqlite: Database.Database): void {
  try {
    const { createHash, randomBytes } = require('crypto') as typeof import('crypto')

    // Get or create the per-installation PIN salt
    const saltRow = sqlite.prepare(`SELECT value FROM settings WHERE key = 'pinSalt'`).get() as { value: string } | undefined
    let salt: string
    if (saltRow?.value) {
      salt = saltRow.value
    } else {
      salt = randomBytes(32).toString('hex')
      sqlite.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('pinSalt', ?, ?)`)
        .run(salt, new Date().toISOString())
    }

    const sha256of0000 = createHash('sha256').update(salt + '0000').digest('hex')
    const now = new Date().toISOString()

    // Fix any staff member whose PIN is a bcrypt hash (starts with '$2').
    // Use a bound parameter for the pattern — '$2%' as a literal in SQLite is
    // misinterpreted as a named parameter by better-sqlite3, causing no rows to match.
    const brokenStaff = sqlite.prepare(
      `SELECT id FROM staff WHERE substr(pin, 1, 2) = '$2' AND (deleted_at IS NULL OR deleted_at = '')`
    ).all() as { id: string }[]

    for (const row of brokenStaff) {
      sqlite.prepare(`UPDATE staff SET pin = ?, updated_at = ? WHERE id = ?`)
        .run(sha256of0000, now, row.id)
    }

    if (brokenStaff.length > 0) {
      console.log(`[V21] Fixed ${brokenStaff.length} staff PIN(s) — PIN reset to 0000. Staff should update their PIN after logging in.`)
    }
  } catch (err) {
    console.error('[V21] Failed to fix bcrypt PINs:', err)
  }
}

/**
 * V23: Add sync_queue outbox table.
 *
 * Terminals write completed orders, payments and inventory adjustments to this
 * table immediately.  A background sync worker flushes pending items to the
 * server and marks them delivered once the server confirms receipt.
 * This ensures nothing is lost even when the server is temporarily unreachable.
 */
function applyV23(sqlite: Database.Database): void {
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id             TEXT    PRIMARY KEY,
        table_name     TEXT    NOT NULL,
        record_id      TEXT    NOT NULL,
        payload        TEXT    NOT NULL,
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        attempts       INTEGER NOT NULL DEFAULT 0,
        last_attempted_at TEXT,
        delivered      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
        ON sync_queue (delivered, created_at)
        WHERE delivered = 0;
    `)
  } catch (err) {
    console.error('[V23] Failed to create sync_queue:', err)
  }
}

/**
 * V24: Add updated_at and deleted_at to shifts for sync support.
 *
 * Shifts need updated_at so that closing a shift (setting closed_at, closing_cash)
 * on one terminal propagates to other terminals and the server via the normal
 * last-write-wins delta sync. Without this, shift close events were silently
 * terminal-local and never appeared in central reports.
 *
 * deleted_at follows the same soft-delete pattern used by all other synced tables.
 */
function applyV24(sqlite: Database.Database): void {
  const cols = [
    `ALTER TABLE shifts ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    `ALTER TABLE shifts ADD COLUMN deleted_at TEXT`,
  ]
  for (const ddl of cols) {
    try {
      sqlite.exec(ddl)
    } catch {
      // Column already exists — idempotent
    }
  }
  // Back-fill updated_at for existing rows using opened_at as a proxy.
  // opened_at is the closest available timestamp for historical shifts.
  try {
    sqlite.exec(`UPDATE shifts SET updated_at = opened_at WHERE updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
  } catch { /* non-fatal */ }
}

/**
 * V25: Append-only sync_log table + per-table SQLite triggers.
 *
 * Every INSERT / UPDATE / DELETE on a synced table writes one row to sync_log
 * with an AUTOINCREMENT seq.  The v2 sync protocol uses these seqs as cursors
 * instead of wall-clock timestamps, which eliminates:
 *   - Clock-skew bugs (terminal clock wrong → wrong LWW winner)
 *   - Watermark race conditions (records written between push & pull missed)
 *   - Partial-delivery ambiguity (acked seq proves exactly what the server saw)
 *
 * The v1 sync routes (/sync/push, /sync/pull) are untouched and remain active
 * until every terminal is switched to v2 via the syncVersion setting.
 */
function applyV25(sqlite: Database.Database): void {
  // ── 1. sync_log table ───────────────────────────────────────────────────────
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id    TEXT    NOT NULL DEFAULT 'local',
      table_name TEXT    NOT NULL,
      row_id     TEXT    NOT NULL,
      operation  TEXT    NOT NULL,
      written_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sync_log_seq
      ON sync_log (seq);
    CREATE INDEX IF NOT EXISTS idx_sync_log_site_seq
      ON sync_log (site_id, seq);
  `)

  // ── 2. Triggers ─────────────────────────────────────────────────────────────
  //
  // Pattern: AFTER INSERT / AFTER UPDATE record the new row_id so the push
  // service can SELECT the current state at flush time.  BEFORE DELETE captures
  // the row_id before the row disappears (most "deletes" in this schema are
  // actually soft-deletes via deleted_at, so hard DELETEs are rare).
  //
  // The site_id is read from the settings table at trigger time; it defaults to
  // 'local' on a fresh machine that hasn't been assigned a terminalId yet.
  const siteExpr = `COALESCE((SELECT value FROM settings WHERE key='terminalId'), 'local')`

  // Tables with `id` TEXT primary key
  const idTables = [
    'categories', 'products', 'product_variants', 'product_components',
    'inventory', 'inventory_adjustments', 'customers', 'discount_rules',
    'gift_cards', 'orders', 'order_items', 'payments', 'staff', 'shifts',
    'vendors', 'vendor_payouts',
  ]

  for (const table of idTables) {
    // AFTER INSERT
    try {
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS _sl_${table}_ins
        AFTER INSERT ON ${table} FOR EACH ROW BEGIN
          INSERT INTO sync_log (site_id, table_name, row_id, operation)
          VALUES (${siteExpr}, '${table}', NEW.id, 'INSERT');
        END
      `)
    } catch { /* already exists — idempotent */ }

    // AFTER UPDATE
    try {
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS _sl_${table}_upd
        AFTER UPDATE ON ${table} FOR EACH ROW BEGIN
          INSERT INTO sync_log (site_id, table_name, row_id, operation)
          VALUES (${siteExpr}, '${table}', NEW.id, 'UPDATE');
        END
      `)
    } catch { /* already exists */ }

    // BEFORE DELETE — capture row_id before the row is gone
    try {
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS _sl_${table}_del
        BEFORE DELETE ON ${table} FOR EACH ROW BEGIN
          INSERT INTO sync_log (site_id, table_name, row_id, operation)
          VALUES (${siteExpr}, '${table}', OLD.id, 'DELETE');
        END
      `)
    } catch { /* already exists */ }
  }

  // Settings table uses `key` TEXT as its primary key, not `id`
  try {
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS _sl_settings_ins
      AFTER INSERT ON settings FOR EACH ROW BEGIN
        INSERT INTO sync_log (site_id, table_name, row_id, operation)
        VALUES (${siteExpr}, 'settings', NEW.key, 'INSERT');
      END
    `)
  } catch { /* already exists */ }
  try {
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS _sl_settings_upd
      AFTER UPDATE ON settings FOR EACH ROW BEGIN
        INSERT INTO sync_log (site_id, table_name, row_id, operation)
        VALUES (${siteExpr}, 'settings', NEW.key, 'UPDATE');
      END
    `)
  } catch { /* already exists */ }
  try {
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS _sl_settings_del
      BEFORE DELETE ON settings FOR EACH ROW BEGIN
        INSERT INTO sync_log (site_id, table_name, row_id, operation)
        VALUES (${siteExpr}, 'settings', OLD.key, 'DELETE');
      END
    `)
  } catch { /* already exists */ }

  // ── 3. Backfill existing rows ───────────────────────────────────────────────
  //
  // Insert one synthetic INSERT entry per existing row so that when a terminal
  // first upgrades to v2, its initial push sends all locally-held data to the
  // server rather than starting from an empty log.  Uses written_at = epoch so
    // these backfill entries sort before any real-time entries.
  const siteId = (
    sqlite.prepare(`SELECT value FROM settings WHERE key='terminalId'`).get() as
      { value: string } | undefined
  )?.value ?? 'local'

  const backfillTables: Array<{ table: string; pk: string }> = [
    { table: 'categories',            pk: 'id'  },
    { table: 'products',              pk: 'id'  },
    { table: 'product_variants',      pk: 'id'  },
    { table: 'product_components',    pk: 'id'  },
    { table: 'inventory',             pk: 'id'  },
    { table: 'inventory_adjustments', pk: 'id'  },
    { table: 'customers',             pk: 'id'  },
    { table: 'discount_rules',        pk: 'id'  },
    { table: 'gift_cards',            pk: 'id'  },
    { table: 'orders',                pk: 'id'  },
    { table: 'order_items',           pk: 'id'  },
    { table: 'payments',              pk: 'id'  },
    { table: 'staff',                 pk: 'id'  },
    { table: 'shifts',                pk: 'id'  },
    { table: 'vendors',               pk: 'id'  },
    { table: 'vendor_payouts',        pk: 'id'  },
    { table: 'settings',              pk: 'key' },
  ]

  const backfillInsert = sqlite.prepare(`
    INSERT INTO sync_log (site_id, table_name, row_id, operation, written_at)
    VALUES (?, ?, ?, 'INSERT', '1970-01-01T00:00:00.000Z')
  `)
  const backfillAll = sqlite.transaction(() => {
    for (const { table, pk } of backfillTables) {
      try {
        const rows = sqlite.prepare(`SELECT ${pk} AS pk FROM ${table}`).all() as { pk: string }[]
        for (const { pk: rowId } of rows) {
          backfillInsert.run(siteId, table, rowId)
        }
      } catch { /* table may not exist on very old schemas — skip */ }
    }
  })
  try { backfillAll() } catch (err) {
    console.warn('[V25] backfill partial failure:', (err as Error).message)
  }
}

/**
 * V26: Idempotent heal for updated_at / deleted_at on shifts.
 *
 * V24 added these columns but was skipped on DBs already at schema_version=25
 * because `currentVersion < 24` evaluated to false. This migration re-applies
 * the same DDL using nullable TEXT (no NOT NULL DEFAULT expression) to avoid
 * the SQLite restriction that prevents adding a NOT NULL column with a
 * non-constant default to a table that already has rows.
 *
 * The back-fill sets updated_at = opened_at for any row where it is still NULL
 * so the Drizzle schema (which declares updated_at as notNull) can read without
 * errors.
 */
function applyV26(sqlite: Database.Database): void {
  const cols = [
    `ALTER TABLE shifts ADD COLUMN updated_at TEXT`,
    `ALTER TABLE shifts ADD COLUMN deleted_at TEXT`,
  ]
  for (const ddl of cols) {
    try {
      sqlite.exec(ddl)
    } catch {
      // Column already exists — idempotent
    }
  }
  // Back-fill: set updated_at = opened_at for rows where it is NULL.
  try {
    sqlite.exec(`UPDATE shifts SET updated_at = opened_at WHERE updated_at IS NULL`)
  } catch { /* non-fatal */ }
}
