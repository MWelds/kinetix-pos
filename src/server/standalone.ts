#!/usr/bin/env node
/**
 * Kinetix POS — Standalone Sync Server
 *
 * Runs the HTTP sync server as a plain Node.js process — no Electron required.
 * Suitable for:
 *   - Docker / cloud VM deployment (SaaS mode)
 *   - Raspberry Pi or always-on LAN server without a monitor
 *   - CI integration tests against a real server
 *
 * Usage:
 *   node dist/server/standalone.js [options]
 *
 * Environment variables (all optional — fall back to DB settings or defaults):
 *   PORT          HTTP port to listen on (default: 3030)
 *   API_KEY       Bearer token required for /sync/* routes (default: none)
 *   DB_PATH       Path to the SQLite database file
 *                 (default: ./kinetix-pos-server.db)
 *   ADMIN_PIN     SHA-256 hex of the dashboard admin PIN; sets the
 *                 dashboardAdminPin setting on first start
 *
 * The database is created and migrated automatically on startup.
 */

import http from 'http'
import path from 'path'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { RepositorySqlite } from './repository.sqlite'
import { createSyncHandler, type SyncServerConfig } from './sync-handler'

// ── Configuration ──────────────────────────────────────────────────────────────

const PORT    = parseInt(process.env['PORT']    ?? '3030', 10)
const API_KEY = process.env['API_KEY'] ?? ''
const DB_PATH = process.env['DB_PATH']
  ?? path.resolve(process.cwd(), 'kinetix-pos-server.db')

// ── Database bootstrap ─────────────────────────────────────────────────────────

const isNew = !existsSync(DB_PATH)

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Minimal schema needed for the sync server routes.
// A full migration is not included here — this bootstrap is intentionally thin
// so it can be extended by a proper migration runner (e.g. drizzle-kit push).
if (isNew) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id     TEXT NOT NULL,
      operation  TEXT NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)
  console.log(`[standalone] Created new database at ${DB_PATH}`)
}

// Persist API key and admin pin to the settings table if supplied via env
if (API_KEY) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run('embeddedServerApiKey', API_KEY, new Date().toISOString())
}

if (process.env['ADMIN_PIN']) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run('dashboardAdminPin', process.env['ADMIN_PIN'], new Date().toISOString())
}

// ── Server ─────────────────────────────────────────────────────────────────────

const repo = new RepositorySqlite(db)

const config: SyncServerConfig = {
  getApiKey: () => db.prepare('SELECT value FROM settings WHERE key=?').get('embeddedServerApiKey') as { value: string } | undefined
    ? (db.prepare('SELECT value FROM settings WHERE key=?').get('embeddedServerApiKey') as { value: string }).value
    : API_KEY,
  repository: repo,
}

const handler = createSyncHandler(config)

const server = http.createServer(handler)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[standalone] Kinetix POS sync server listening on port ${PORT}`)
  console.log(`[standalone] Database: ${DB_PATH}`)
  console.log(`[standalone] API key: ${API_KEY ? 'set' : 'none (open access)'}`)
})

// Graceful shutdown
function shutdown() {
  console.log('[standalone] Shutting down…')
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT',  shutdown)
process.on('SIGTERM', shutdown)
