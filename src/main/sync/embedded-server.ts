/**
 * Embedded Sync Server
 *
 * Runs a lightweight HTTP sync server directly in the Electron main process.
 * Used when nodeMode === 'server'. No external dependencies needed — built on
 * Node's built-in `http` module with better-sqlite3 for the central DB.
 *
 * Exposes three endpoints:
 *   GET  /sync/status  — health check
 *   POST /sync/pull    — pull records changed after `since`
 *   POST /sync/push    — push local changes to the central DB
 */

import http from 'http'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

// ─── Types ────────────────────────────────────────────────────────────────────

type SyncRecord = Record<string, unknown>
type SyncPayload = Record<string, SyncRecord[]>

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

// ─── State ────────────────────────────────────────────────────────────────────

let server: http.Server | null = null
let serverDb: Database.Database | null = null

export interface EmbeddedServerStatus {
  running: boolean
  port: number
  ip: string
}

// ─── Database ─────────────────────────────────────────────────────────────────

function getServerDb(): Database.Database {
  if (serverDb) return serverDb

  const dbDir = join(app.getPath('userData'), 'sync-server')
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

  serverDb = new Database(join(dbDir, 'central.db'))
  serverDb.pragma('journal_mode = WAL')
  serverDb.pragma('foreign_keys = ON')
  serverDb.pragma('synchronous = NORMAL')
  applyServerSchema(serverDb)
  return serverDb
}

function applyServerSchema(db: Database.Database): void {
  // Mirrors the terminal schema (V6) so any table can be upserted into
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3b82f6', sort_order INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL UNIQUE,
      barcode TEXT, description TEXT, category_id TEXT, base_price REAL NOT NULL,
      cost_price REAL, image_url TEXT, is_composite INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1, tax_rate REAL NOT NULL DEFAULT 0,
      units_per_pack INTEGER NOT NULL DEFAULT 1, individual_product_id TEXT,
      pack_product_id TEXT, vendor_id TEXT, vendor_cost REAL,
      track_stock INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE, barcode TEXT, price_modifier REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS product_components (
      id TEXT PRIMARY KEY, composite_product_id TEXT NOT NULL,
      component_product_id TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, variant_id TEXT,
      quantity REAL NOT NULL DEFAULT 0, low_stock_threshold REAL NOT NULL DEFAULT 5,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, variant_id TEXT,
      type TEXT NOT NULL, quantity REAL NOT NULL, note TEXT, staff_id TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      email TEXT, phone TEXT, address TEXT,
      loyalty_points INTEGER NOT NULL DEFAULT 0, store_credit REAL NOT NULL DEFAULT 0,
      notes TEXT, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      email TEXT, pin TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cashier',
      is_active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS discount_rules (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, value REAL NOT NULL,
      min_order_amount REAL, category_id TEXT, product_id TEXT, coupon_code TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, valid_from TEXT, valid_until TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending', order_type TEXT NOT NULL DEFAULT 'instore',
      customer_id TEXT, staff_id TEXT, shift_id TEXT,
      subtotal REAL NOT NULL DEFAULT 0, discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
      notes TEXT, discount_id TEXT, manual_discount_type TEXT, manual_discount_value REAL,
      loyalty_points_earned INTEGER NOT NULL DEFAULT 0,
      loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'pending', deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL,
      variant_id TEXT, product_name TEXT NOT NULL, variant_name TEXT,
      sku TEXT NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0, tax_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL, notes TEXT, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, method TEXT NOT NULL,
      amount REAL NOT NULL, reference TEXT, change_given REAL,
      status TEXT NOT NULL DEFAULT 'completed', deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS gift_cards (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, balance REAL NOT NULL,
      initial_balance REAL NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, notes TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS vendor_payouts (
      id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, amount REAL NOT NULL,
      note TEXT, staff_id TEXT, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)
}

function getRecordsSince(table: SyncTable, since: string): SyncRecord[] {
  const db = getServerDb()
  const col = TABLES_WITH_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'
  return db.prepare(`SELECT * FROM ${table} WHERE ${col} > ? ORDER BY ${col} ASC`).all(since) as SyncRecord[]
}

function upsertRecords(table: SyncTable, records: SyncRecord[]): void {
  if (records.length === 0) return
  const db = getServerDb()
  const sample = records[0]
  const cols = Object.keys(sample)
  const placeholders = cols.map(() => '?').join(', ')
  const updateCol = TABLES_WITH_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'

  const setClauses = cols
    .filter((c) => c !== 'id')
    .map((c) =>
      `${c} = CASE WHEN excluded.${updateCol} >= COALESCE(${table}.${updateCol}, '') THEN excluded.${c} ELSE ${table}.${c} END`
    )
    .join(', ')

  const stmt = db.prepare(`
    INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${setClauses}
  `)
  const upsertMany = db.transaction((rows: SyncRecord[]) => {
    for (const row of rows) stmt.run(cols.map((c) => row[c]))
  })
  upsertMany(records)
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

function checkAuth(req: http.IncomingMessage, apiKey: string): boolean {
  if (!apiKey) return true  // no key configured → open
  const auth = req.headers['authorization'] ?? ''
  return auth === `Bearer ${apiKey}`
}

// ─── Request handler ──────────────────────────────────────────────────────────

function createHandler(apiKey: string) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    // CORS for same-LAN requests
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    // Auth check
    if (!checkAuth(req, apiKey)) {
      send(res, 401, { error: 'Unauthorized' }); return
    }

    const url = req.url ?? '/'

    try {
      // GET /sync/status
      if (req.method === 'GET' && url === '/sync/status') {
        send(res, 200, { ok: true, version: '1.0.0', serverTime: new Date().toISOString() })
        return
      }

      // POST /sync/pull
      if (req.method === 'POST' && url === '/sync/pull') {
        const body = await parseBody(req) as { since?: string }
        if (!body.since || typeof body.since !== 'string') {
          send(res, 400, { error: '`since` is required' }); return
        }
        const records: SyncPayload = {}
        for (const table of SYNC_TABLES) {
          const rows = getRecordsSince(table, body.since)
          if (rows.length > 0) records[table] = rows
        }
        send(res, 200, { serverTime: new Date().toISOString(), records })
        return
      }

      // POST /sync/push
      if (req.method === 'POST' && url === '/sync/push') {
        const body = await parseBody(req) as { terminalId?: string; records?: SyncPayload }
        if (!body.terminalId) { send(res, 400, { error: '`terminalId` is required' }); return }
        if (!body.records)    { send(res, 400, { error: '`records` is required' }); return }
        let total = 0
        for (const table of SYNC_TABLES) {
          const rows = body.records[table]
          if (Array.isArray(rows) && rows.length > 0) {
            upsertRecords(table, rows)
            total += rows.length
          }
        }
        send(res, 200, { ok: true, serverTime: new Date().toISOString(), rowsApplied: total })
        return
      }

      send(res, 404, { error: 'Not found' })
    } catch (err) {
      console.error('[embedded-server] handler error:', err)
      send(res, 500, { error: 'Internal server error' })
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Start the embedded sync server. No-op if already running. */
export function startEmbeddedServer(port: number, apiKey: string): Promise<EmbeddedServerStatus> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(getEmbeddedServerStatus())
      return
    }

    server = http.createServer(createHandler(apiKey))

    server.on('error', (err) => {
      server = null
      reject(err)
    })

    server.listen(port, '0.0.0.0', () => {
      console.log(`[embedded-server] listening on port ${port}`)
      resolve(getEmbeddedServerStatus())
    })
  })
}

/** Stop the embedded sync server gracefully. */
export function stopEmbeddedServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) { resolve(); return }
    server.close(() => {
      server = null
      serverDb?.close()
      serverDb = null
      resolve()
    })
  })
}

/** Returns current status without starting/stopping the server. */
export function getEmbeddedServerStatus(): EmbeddedServerStatus {
  const { networkInterfaces } = require('os') as typeof import('os')
  const nets = networkInterfaces()
  let ip = '127.0.0.1'
  for (const list of Object.values(nets)) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) { ip = iface.address; break }
    }
  }
  const addr = server?.address()
  const port = addr && typeof addr === 'object' ? addr.port : 3030
  return { running: server !== null, port, ip }
}
