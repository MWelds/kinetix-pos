import { app, shell, BrowserWindow, session, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { execFile } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers } from './ipc/handlers'
import { getDatabase, closeDatabase } from './database/connection'
import { seedDatabase } from './database/seed'
import { setMainWindow, startHttpServer } from './display/customer-display'
import { initSync } from './sync/sync.service'
import { initSyncV2 } from './sync/sync-v2.service'
import { initCloudSync } from './sync/cloud-sync.service'
import { initBackupSchedule } from './services/backup.service'
import { initFileSync } from './sync/file-sync.service'
import { startFileSyncServer, getDefaultLocalSharePath } from './sync/file-sync-server'
import { settingsService } from './services/settings.service'
import { startEmbeddedServer } from './sync/embedded-server'

// ─── Crash logger ─────────────────────────────────────────────────────────────
function logError(context: string, err: unknown): void {
  try {
    const logDir = join(app.getPath('userData'), 'logs')
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
    const line = `[${new Date().toISOString()}] [${context}] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`
    appendFileSync(join(logDir, 'main.log'), line)
  } catch {
    // If logging itself fails there is nothing we can do
  }
}

/**
 * Ensures a Windows Firewall inbound rule exists for the given TCP port.
 * Uses netsh (always present on Windows) so we don't need an external dep.
 * Runs fire-and-forget — a failure is logged but never surfaces to the user.
 * No-op on non-Windows platforms.
 */
function ensureFirewallRule(port: number): void {
  if (process.platform !== 'win32') return
  const ruleName = `Kinetix POS Sync Server (port ${port})`
  execFile('netsh', [
    'advfirewall', 'firewall', 'show', 'rule', `name=${ruleName}`
  ], (_checkErr, stdout) => {
    if (stdout && stdout.includes(ruleName)) return
    execFile('netsh', [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${ruleName}`,
      'dir=in', 'action=allow', 'protocol=TCP',
      `localport=${port}`, 'profile=any'
    ], (addErr) => {
      if (addErr) logError('ensureFirewallRule', addErr)
    })
  })
}

process.on('uncaughtException', (err) => {
  logError('uncaughtException', err)
  dialog.showErrorBox(
    'Kinetix POS – Fatal Error',
    `An unexpected error occurred and the application must close.\n\n${err?.message ?? err}\n\nDetails have been saved to:\n%APPDATA%\\Kinetix POS\\logs\\main.log`
  )
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason)
})

function initAutoUpdater(win: BrowserWindow): void {
  if (is.dev) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', () => { win.webContents.send('update:ready') })
  autoUpdater.on('error', (err) => { console.error('[auto-updater] error:', err?.message ?? err) })
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 4 * 60 * 60 * 1000)
  ipcMain.on('update:install', () => { autoUpdater.quitAndInstall(false, true) })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1280, minHeight: 800,
    show: false, autoHideMenuBar: true, title: 'Kinetix POS',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, contextIsolation: true, nodeIntegration: false,
      // Disabled outright in production — this is the one setting that closes
      // every path to DevTools (menu item, keyboard shortcut, or a renderer
      // script calling webContents.openDevTools()), not just the shortcut
      // blocking optimizer.watchWindowShortcuts() does below.
      devTools: is.dev
    }
  })
  win.on('ready-to-show', () => { win.show() })
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app
  .whenReady()
  .then(() => {
    electronApp.setAppUserModelId('com.kinetix.pos')
    app.on('browser-window-created', (_, window) => { optimizer.watchWindowShortcuts(window) })
    // Production ships without a menu bar already (autoHideMenuBar) — removing
    // the underlying Menu strips its "Toggle Developer Tools" item too, so
    // Alt (which reveals a hidden Windows menu bar) can't get to it either.
    // devTools: false on the window is the primary gate; this is defense in depth.
    if (!is.dev) Menu.setApplicationMenu(null)

    try {
      getDatabase()
    } catch (err) {
      logError('getDatabase', err)
      dialog.showErrorBox('Kinetix POS – Database Error',
        `Failed to initialise the database.\n\n${err instanceof Error ? err.message : String(err)}\n\nDetails saved to:\n%APPDATA%\\Kinetix POS\\logs\\main.log`)
      app.exit(1)
      return
    }

    try { seedDatabase() } catch { /* already seeded */ }

    registerIpcHandlers()

    if (settingsService.get('nodeMode') === 'server' && settingsService.get('setupComplete') === 'true') {
      const port = parseInt(settingsService.get('embeddedServerPort') || '3030', 10)
      const apiKey = settingsService.get('embeddedServerApiKey') || ''
      startEmbeddedServer(port, apiKey).catch((err) => logError('startEmbeddedServer', err))
      ensureFirewallRule(port)
      if (settingsService.get('syncMode') === 'file') {
        const localSharePath = settingsService.get('syncSharePath')?.trim()
          || getDefaultLocalSharePath(app.getPath('userData'))
        const intervalSec = parseInt(settingsService.get('syncIntervalSeconds') || '30', 10)
        startFileSyncServer(localSharePath, intervalSec)
      }
    }

    initSync()
    initSyncV2()
    initFileSync()
    initCloudSync()
    initBackupSchedule()

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [[
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'" + (is.dev ? " 'unsafe-eval'" : ''),
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "form-action 'none'",
            "frame-ancestors 'none'"
          ].join('; ')]
        }
      })
    })

    const mainWin = createWindow()
    setMainWindow(mainWin)
    initAutoUpdater(mainWin)

    if (settingsService.get('networkDisplayAutoStart') === 'true') {
      const port = parseInt(settingsService.get('networkDisplayPort') || '3031', 10)
      startHttpServer(port)
        .then(() => {
          ensureFirewallRule(port)
          console.log(`[display] Network display auto-started on port ${port}`)
        })
        .catch((err) => logError('networkDisplay autoStart', err))
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((err) => {
    logError('whenReady', err)
    dialog.showErrorBox('Kinetix POS – Startup Error',
      `The application failed to start.\n\n${err instanceof Error ? err.message : String(err)}\n\nDetails saved to:\n%APPDATA%\\Kinetix POS\\logs\\main.log`)
    app.exit(1)
  })

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})
