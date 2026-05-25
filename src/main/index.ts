import { app, shell, BrowserWindow, session, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers } from './ipc/handlers'
import { getDatabase, closeDatabase } from './database/connection'
import { seedDatabase } from './database/seed'
import { setMainWindow } from './display/customer-display'

/**
 * Configure and start the auto-updater.
 * Runs silently in the background — the renderer is notified when an update
 * is downloaded and ready so it can show a "Restart to update" prompt.
 */
function initAutoUpdater(win: BrowserWindow): void {
  // Skip update checks in dev mode
  if (is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', () => {
    // Tell the renderer so it can show a toast / banner
    win.webContents.send('update:ready')
  })

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] error:', err?.message ?? err)
  })

  // Check immediately on launch, then every 4 hours
  autoUpdater.checkForUpdates().catch(() => { /* no network — ignore */ })
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => { /* no network — ignore */ })
  }, 4 * 60 * 60 * 1000)

  // Allow renderer to trigger install-and-restart
  ipcMain.on('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'Kinetix POS',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.kinetix.pos')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize DB and run migrations
  getDatabase()

  // Seed demo data on first run
  try {
    seedDatabase()
  } catch {
    // Seed already ran — ignore duplicate key errors
  }

  // Register all IPC handlers
  registerIpcHandlers()

  // ── Content-Security-Policy ──────────────────────────────────────────────
  // Applied to every web request served from the renderer session.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'" + (is.dev ? " 'unsafe-eval'" : ''),
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "form-action 'none'",
            "frame-ancestors 'none'"
          ].join('; ')
        ]
      }
    })
  })

  const mainWin = createWindow()
  setMainWindow(mainWin)
  initAutoUpdater(mainWin)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})
