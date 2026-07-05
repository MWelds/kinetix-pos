/**
 * Database Backup Service.
 *
 * Lets the user configure any number of destination folders — a plain local
 * folder, an external/USB drive (just another drive letter on Windows), or a
 * folder already managed by Dropbox/OneDrive/Google Drive's desktop app (which
 * uploads to the cloud automatically, no API integration needed here).
 *
 * Uses better-sqlite3's `.backup()` (SQLite's own online-backup API) rather
 * than a raw file copy — this app's database is opened in WAL mode and stays
 * open the whole time the app runs, so a naive `fs.copyFile` of `pos.db` could
 * capture an inconsistent snapshot mid-write. The online-backup API is safe
 * against a live, open database.
 */
import { dialog } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getSqlite } from '../database/connection'
import { settingsService } from './settings.service'
import { generateId } from '../lib/id'

export interface BackupDestination {
  id: string
  label: string
  path: string
}

export interface BackupResult {
  path: string
  ok: boolean
  error?: string
  sizeBytes?: number
  at: string
}

export interface BackupStatus {
  enabled: boolean
  intervalHours: number
  retentionCount: number
  lastBackupAt: string | null
  lastResults: BackupResult[]
  destinations: BackupDestination[]
}

const BACKUP_FILE_PREFIX = 'kinetix-pos-backup-'
const BACKUP_FILE_EXT = '.db'

function safeTimestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-')
}

function listDestinations(): BackupDestination[] {
  try {
    return JSON.parse(settingsService.get('backupDestinations')) as BackupDestination[]
  } catch {
    return []
  }
}

function saveDestinations(dests: BackupDestination[]): void {
  settingsService.set('backupDestinations', JSON.stringify(dests))
}

function getLastResults(): BackupResult[] {
  try {
    return JSON.parse(settingsService.get('lastBackupResults')) as BackupResult[]
  } catch {
    return []
  }
}

/** Deletes app-created backup files beyond `keep`, oldest first. Never touches anything else in the folder. */
function pruneOldBackups(folder: string, keep: number): void {
  try {
    const files = readdirSync(folder)
      .filter((f) => f.startsWith(BACKUP_FILE_PREFIX) && f.endsWith(BACKUP_FILE_EXT))
      .map((f) => ({ name: f, mtime: statSync(join(folder, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime) // newest first
    for (const file of files.slice(Math.max(0, keep))) {
      try { unlinkSync(join(folder, file.name)) } catch { /* best effort */ }
    }
  } catch { /* folder may not exist / be readable — non-fatal */ }
}

export const backupService = {
  listDestinations,

  /** Opens the native folder picker. Returns null if the user cancels. */
  async pickFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Choose Backup Folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  },

  addDestination(path: string, label?: string): BackupDestination[] {
    const dests = listDestinations()
    if (dests.some((d) => d.path === path)) return dests // no duplicates
    dests.push({ id: generateId(), label: label?.trim() || path, path })
    saveDestinations(dests)
    return dests
  },

  removeDestination(id: string): BackupDestination[] {
    const dests = listDestinations().filter((d) => d.id !== id)
    saveDestinations(dests)
    return dests
  },

  getStatus(): BackupStatus {
    return {
      enabled: settingsService.get('backupEnabled') === 'true',
      intervalHours: parseInt(settingsService.get('backupIntervalHours'), 10) || 24,
      retentionCount: parseInt(settingsService.get('backupRetentionCount'), 10) || 14,
      lastBackupAt: settingsService.get('lastBackupAt') || null,
      lastResults: getLastResults(),
      destinations: listDestinations(),
    }
  },

  setSchedule(input: { enabled: boolean; intervalHours: number; retentionCount: number }): void {
    settingsService.set('backupEnabled', input.enabled ? 'true' : 'false')
    settingsService.set('backupIntervalHours', String(input.intervalHours))
    settingsService.set('backupRetentionCount', String(input.retentionCount))
  },

  /**
   * Backs up to every configured destination. One destination failing (e.g. a
   * USB drive that's been unplugged) doesn't stop the others — each is wrapped
   * in its own try/catch and reported independently.
   */
  async runBackupNow(): Promise<BackupResult[]> {
    const dests = listDestinations()
    const sqlite = getSqlite()
    const retentionCount = parseInt(settingsService.get('backupRetentionCount'), 10) || 14
    const now = new Date()
    const filename = `${BACKUP_FILE_PREFIX}${safeTimestamp(now)}${BACKUP_FILE_EXT}`
    const results: BackupResult[] = []

    for (const dest of dests) {
      const at = new Date().toISOString()
      try {
        if (!existsSync(dest.path)) mkdirSync(dest.path, { recursive: true })
        const destFile = join(dest.path, filename)
        await sqlite.backup(destFile)
        const sizeBytes = statSync(destFile).size
        pruneOldBackups(dest.path, retentionCount)
        results.push({ path: dest.path, ok: true, sizeBytes, at })
      } catch (err) {
        results.push({ path: dest.path, ok: false, error: err instanceof Error ? err.message : String(err), at })
      }
    }

    settingsService.set('lastBackupAt', now.toISOString())
    settingsService.set('lastBackupResults', JSON.stringify(results))
    return results
  },
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
// Checks every 30 min whether a backup is due, rather than one long setInterval
// keyed to app-launch time — this way an interval like "daily" actually lands
// close to daily even if the app is restarted frequently, instead of resetting
// the wait on every relaunch.
let schedulerHandle: ReturnType<typeof setInterval> | null = null
const CHECK_INTERVAL_MS = 30 * 60 * 1000

function isBackupDue(): boolean {
  if (settingsService.get('backupEnabled') !== 'true') return false
  const lastAt = settingsService.get('lastBackupAt')
  if (!lastAt) return true
  const intervalHours = parseInt(settingsService.get('backupIntervalHours'), 10) || 24
  const elapsedMs = Date.now() - new Date(lastAt).getTime()
  return elapsedMs >= intervalHours * 60 * 60 * 1000
}

async function checkAndRun(): Promise<void> {
  if (!isBackupDue()) return
  if (listDestinations().length === 0) return
  try { await backupService.runBackupNow() } catch { /* captured in lastBackupResults */ }
}

export function initBackupSchedule(): void {
  stopBackupSchedule()
  setTimeout(() => { checkAndRun() }, 10_000) // let the app finish starting up first
  schedulerHandle = setInterval(() => { checkAndRun() }, CHECK_INTERVAL_MS)
}

export function stopBackupSchedule(): void {
  if (schedulerHandle !== null) { clearInterval(schedulerHandle); schedulerHandle = null }
}
