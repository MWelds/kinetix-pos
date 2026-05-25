import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import * as schema from './schema'
import { runMigrations } from './migrate'

/** Singleton Drizzle DB instance */
let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database.Database | null = null

/**
 * Returns (or creates) the singleton database connection.
 * WAL mode is enabled on every connection for crash safety.
 */
export function getDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db

  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'database')
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

  const dbPath = join(dbDir, 'pos.db')
  sqlite = new Database(dbPath)

  // Enable WAL mode for crash safety and concurrent reads
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')

  db = drizzle(sqlite, { schema })
  runMigrations(sqlite)

  return db
}

/** Close the database cleanly on app quit */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
  }
}

/**
 * Returns the raw better-sqlite3 instance.
 * Use for complex analytical queries that need prepared statements directly.
 * Always call getDatabase() first to ensure the connection is initialised.
 */
export function getSqlite(): Database.Database {
  if (!sqlite) getDatabase()
  return sqlite!
}

