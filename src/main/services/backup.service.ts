import { app } from 'electron'
import { join, basename } from 'path'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { getSqlite } from '../database/connection'
import { settingsService } from './settings.service'

/**
 * Automatic SQLite backups.
 *
 * Uses better-sqlite3's native online backup API (`db.backup(dest)`), which is
 * safe to run while the POS is in use — it snapshots a consistent copy of the
 * database without locking writers.
 *
 * Settings (all machine-specific, never synced):
 *   backupEnabled       'true' | 'false'      (default 'true')
 *   backupIntervalHours e.g. '24'             (default '24')
 *   backupRetention     how many to keep      (default '14')
 *   backupCustomPath    folder override       (default '' = <userData>/backups)
 *   lastBackupAt        ISO timestamp of last successful backup
 */

const FILE_PREFIX = 'pos-backup-'
/** How often the scheduler wakes up to check whether a backup is due. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let running = false
let lastError: string | null = null

export interface BackupStatus {
  enabled: boolean
  intervalHours: number
  retention: number
  directory: string
  lastBackupAt: string | null
  lastError: string | null
  backupCount: number
  latestFile: string | null
  running: boolean
}

function backupDir(): string {
  const custom = settingsService.get('backupCustomPath')?.trim()
  return custom || join(app.getPath('userData'), 'backups')
}

function listBackupFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith('.db'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}

/** Delete oldest backups beyond the retention count. Never throws. */
function rotate(dir: string, retention: number): void {
  try {
    const files = listBackupFiles(dir)
    for (const f of files.slice(Math.max(1, retention))) {
      try { unlinkSync(f) } catch { /* file locked/in use — try next cycle */ }
    }
  } catch { /* rotation is best-effort */ }
}

export const backupService = {
  /** Run a backup immediately. Returns the created file path. */
  async runNow(): Promise<{ file: string; sizeBytes: number }> {
    if (running) throw new Error('A backup is already in progress')
    running = true
    try {
      const dir = backupDir()
      mkdirSync(dir, { recursive: true })

      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      const dest = join(dir, `${FILE_PREFIX}${stamp}.db`)

      await getSqlite().backup(dest)

      const size = statSync(dest).size
      if (size === 0) throw new Error('Backup file is empty')

      settingsService.set('lastBackupAt', new Date().toISOString())
      lastError = null

      const retention = parseInt(settingsService.get('backupRetention') || '14', 10)
      rotate(dir, isNaN(retention) ? 14 : retention)

      console.log(`[backup] wrote ${basename(dest)} (${(size / 1024 / 1024).toFixed(1)} MB)`)
      return { file: dest, sizeBytes: size }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      running = false
    }
  },

  getStatus(): BackupStatus {
    const dir = backupDir()
    const files = listBackupFiles(dir)
    return {
      enabled: settingsService.get('backupEnabled') !== 'false',
      intervalHours: parseInt(settingsService.get('backupIntervalHours') || '24', 10) || 24,
      retention: parseInt(settingsService.get('backupRetention') || '14', 10) || 14,
      directory: dir,
      lastBackupAt: settingsService.get('lastBackupAt') || null,
      lastError,
      backupCount: files.length,
      latestFile: files[0] ?? null,
      running
    }
  },

  /** Run a backup if one is due (enabled + interval elapsed). */
  async runIfDue(): Promise<void> {
    if (settingsService.get('backupEnabled') === 'false') return
    const intervalHours = parseInt(settingsService.get('backupIntervalHours') || '24', 10) || 24
    const last = settingsService.get('lastBackupAt')
    const dueAt = last ? new Date(last).getTime() + intervalHours * 3600_000 : 0
    if (Date.now() < dueAt) return
    try {
      await this.runNow()
    } catch (err) {
      // Never let a failed backup disturb the POS — logged and surfaced in Settings.
      console.error('[backup] scheduled backup failed:', err)
    }
  },

  /** Start the scheduler. Safe to call once at app startup. */
  startScheduler(): void {
    if (timer) return
    // First check shortly after launch (don't compete with startup I/O),
    // then periodically.
    setTimeout(() => { void this.runIfDue() }, 60_000)
    timer = setInterval(() => { void this.runIfDue() }, CHECK_INTERVAL_MS)
  },

  stopScheduler(): void {
    if (timer) { clearInterval(timer); timer = null }
  }
}
