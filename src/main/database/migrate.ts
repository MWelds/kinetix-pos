import Database from 'better-sqlite3'

/** Schema version — increment whenever tables change */
const SCHEMA_VERSION = 8

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
