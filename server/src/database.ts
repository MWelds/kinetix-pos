import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { SYNC_TABLES, type SyncTable, type SyncRecord, type SyncPayload } from './types'

let db: Database.Database | null = null

/** Tables that have an updated_at column for change-tracking. */
const TABLES_WITH_UPDATED_AT = new Set<SyncTable>([
  'categories', 'products', 'product_variants', 'customers',
  'discount_rules', 'gift_cards', 'orders', 'order_items',
  'staff', 'vendors', 'settings'
])

/** Tables that are append-only (no updated_at — just pull everything newer than last id/created_at). */
const APPEND_ONLY_TABLES = new Set<SyncTable>([
  'inventory_adjustments', 'vendor_payouts', 'payments', 'product_components'
])

/**
 * Returns the singleton SQLite connection.
 * Creates the database directory and applies the schema on first run.
 */
export function getDb(): Database.Database {
  if (db) return db

  const dbDir = process.env['DB_PATH'] ?? join(process.cwd(), 'data')
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

  db = new Database(join(dbDir, 'pos-server.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  applySchema(db)
  return db
}

/**
 * Creates all tables using the same DDL as the terminal (schema V6).
 * Safe to call repeatedly — all statements use CREATE TABLE IF NOT EXISTS.
 */
function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      sort_order INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
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
      units_per_pack INTEGER NOT NULL DEFAULT 1,
      individual_product_id TEXT REFERENCES products(id),
      pack_product_id TEXT REFERENCES products(id),
      vendor_id TEXT REFERENCES vendors(id),
      vendor_cost REAL,
      track_stock INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT,
      price_modifier REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS product_components (
      id TEXT PRIMARY KEY,
      composite_product_id TEXT NOT NULL REFERENCES products(id),
      component_product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 1,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      variant_id TEXT REFERENCES product_variants(id),
      quantity REAL NOT NULL DEFAULT 0,
      low_stock_threshold REAL NOT NULL DEFAULT 5,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      variant_id TEXT REFERENCES product_variants(id),
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      note TEXT,
      staff_id TEXT,
      deleted_at TEXT,
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
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      pin TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      is_active INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
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
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      order_type TEXT NOT NULL DEFAULT 'instore',
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
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

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
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      reference TEXT,
      change_given REAL,
      status TEXT NOT NULL DEFAULT 'completed',
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS gift_cards (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      balance REAL NOT NULL,
      initial_balance REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS vendor_payouts (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      amount REAL NOT NULL,
      note TEXT,
      staff_id TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  `)
}

/**
 * Returns all records in `table` that were updated after `since`.
 * Falls back to created_at for append-only tables.
 */
export function getRecordsSince(table: SyncTable, since: string): SyncRecord[] {
  const db = getDb()
  const col = TABLES_WITH_UPDATED_AT.has(table) ? 'updated_at'
    : APPEND_ONLY_TABLES.has(table) ? 'created_at'
    : 'updated_at'

  // inventory uses updated_at
  const sql = `SELECT * FROM ${table} WHERE ${col} > ? ORDER BY ${col} ASC`
  return db.prepare(sql).all(since) as SyncRecord[]
}

/**
 * Upserts an array of records into `table` using last-write-wins by updated_at.
 * Records with a newer updated_at on the server are NOT overwritten.
 */
export function upsertRecords(table: SyncTable, records: SyncRecord[]): void {
  if (records.length === 0) return
  const db = getDb()

  // Build UPSERT SQL dynamically from the first record's keys
  const sample = records[0]
  const cols = Object.keys(sample)
  const placeholders = cols.map(() => '?').join(', ')
  const updateCol = TABLES_WITH_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'

  // For tables with updated_at: only update if incoming record is newer
  const setClauses = cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = CASE WHEN excluded.${updateCol} >= ${table}.${updateCol} THEN excluded.${c} ELSE ${table}.${c} END`)
    .join(', ')

  const sql = `
    INSERT INTO ${table} (${cols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${setClauses}
  `
  const stmt = db.prepare(sql)
  const upsertMany = db.transaction((rows: SyncRecord[]) => {
    for (const row of rows) {
      stmt.run(cols.map((c) => row[c]))
    }
  })
  upsertMany(records)
}
