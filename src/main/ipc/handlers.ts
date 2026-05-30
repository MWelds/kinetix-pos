import { ipcMain, IpcMainInvokeEvent, BrowserWindow, dialog, app, WebContents } from 'electron'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, copyFileSync, existsSync } from 'fs'
import { extname, join } from 'path'
import { tmpdir, networkInterfaces } from 'os'
import { randomBytes } from 'crypto'
import {
  openDisplayWindow,
  closeDisplayWindow,
  isDisplayWindowOpen,
  pushData,
  getLastData,
  startHttpServer,
  stopHttpServer,
  isHttpServerRunning,
  getLocalIp,
  forcePushCurrentState
} from '../display/customer-display'
import { IPC } from './channels'
import { sendReceiptEmail, sendInvoiceEmail, testSmtpConnection } from '../services/email.service'
import { productService } from '../services/product.service'
import { orderService } from '../services/order.service'
import { customerService } from '../services/customer.service'
import { inventoryService } from '../services/inventory.service'
import { staffService } from '../services/staff.service'
import { reportService } from '../services/report.service'
import { settingsService } from '../services/settings.service'
import { setDisplayLogo } from '../display/customer-display'
import { qboService } from '../services/qbo.service'
import { exportService } from '../services/export.service'
import { csvImportExportService } from '../services/csv-import-export.service'
import { vendorService } from '../services/vendor.service'
import { getSyncState, runSync, testConnection, startSyncLoop, stopSyncLoop, onSyncStateChange } from '../sync/sync.service'
import { startEmbeddedServer, stopEmbeddedServer, getEmbeddedServerStatus } from '../sync/embedded-server'

/** Register all IPC handlers. Call once after app is ready. */
export function registerIpcHandlers(): void {
  // Products
  ipcMain.handle(IPC.PRODUCTS_LIST, (_e, categoryId?: string) =>
    productService.listWithInventory(categoryId)
  )
  ipcMain.handle(IPC.PRODUCTS_GET, (_e, id: string) => productService.getById(id))
  ipcMain.handle(IPC.PRODUCTS_SEARCH, (_e, query: string) => productService.search(query))
  ipcMain.handle(IPC.PRODUCTS_BY_BARCODE, (_e, barcode: string) =>
    productService.findByBarcode(barcode)
  )
  ipcMain.handle(IPC.PRODUCTS_CREATE, (_e, input) => productService.create(input))
  ipcMain.handle(IPC.PRODUCTS_UPDATE, (_e, id: string, input) =>
    productService.update(id, input)
  )
  ipcMain.handle(IPC.PRODUCTS_DELETE, (_e, id: string) => productService.delete(id))
  ipcMain.handle(IPC.PRODUCTS_GET_COMPONENTS, (_e, compositeProductId: string) =>
    productService.getComponents(compositeProductId)
  )
  ipcMain.handle(
    IPC.PRODUCTS_SET_COMPONENTS,
    (
      _e,
      compositeProductId: string,
      components: Array<{ componentProductId: string; quantity: number }>
    ) => productService.setComponents(compositeProductId, components)
  )

  // Categories
  ipcMain.handle(IPC.CATEGORIES_LIST, () => productService.listCategories())
  ipcMain.handle(IPC.CATEGORIES_CREATE, (_e, input) => productService.createCategory(input))
  ipcMain.handle(IPC.CATEGORIES_UPDATE, (_e, id: string, input) =>
    productService.updateCategory(id, input)
  )
  ipcMain.handle(IPC.CATEGORIES_DELETE, (_e, id: string) => productService.deleteCategory(id))

  // Inventory
  ipcMain.handle(IPC.INVENTORY_LIST, () => inventoryService.list())
  ipcMain.handle(IPC.INVENTORY_LOW_STOCK, () => inventoryService.lowStock())
  ipcMain.handle(IPC.INVENTORY_ADJUST, (_e, input) => inventoryService.adjust(input))

  // Customers
  ipcMain.handle(IPC.CUSTOMERS_LIST, () => customerService.list())
  ipcMain.handle(IPC.CUSTOMERS_GET, (_e, id: string) => customerService.getById(id))
  ipcMain.handle(IPC.CUSTOMERS_SEARCH, (_e, query: string) => customerService.search(query))
  ipcMain.handle(IPC.CUSTOMERS_CREATE, (_e, input) => customerService.create(input))
  ipcMain.handle(IPC.CUSTOMERS_UPDATE, (_e, id: string, input) =>
    customerService.update(id, input)
  )
  ipcMain.handle(IPC.CUSTOMERS_DELETE, (_e, id: string) => customerService.delete(id))
  ipcMain.handle(IPC.CUSTOMERS_PURCHASE_HISTORY, (_e, customerId: string) =>
    customerService.getPurchaseHistory(customerId)
  )

  // Orders
  ipcMain.handle(IPC.ORDERS_CREATE, (_e, input) => orderService.create(input))
  ipcMain.handle(IPC.ORDERS_GET, (_e, id: string) => orderService.getWithItems(id))
  ipcMain.handle(IPC.ORDERS_LIST, (_e, filters) => orderService.list(filters))
  ipcMain.handle(IPC.ORDERS_COMPLETE, (_e, input) => orderService.complete(input))
  ipcMain.handle(IPC.ORDERS_VOID, (_e, id: string, staffId: string) =>
    orderService.voidOrder(id, staffId)
  )
  ipcMain.handle(IPC.ORDERS_REFUND, (_e, id: string, itemIds: string[]) =>
    orderService.refund(id, itemIds)
  )
  ipcMain.handle(IPC.ORDERS_HOLD, (_e, id: string) => orderService.hold(id))
  ipcMain.handle(IPC.ORDERS_HELD_LIST, () => orderService.listHeld())
  ipcMain.handle(IPC.ORDERS_UPDATE_STATUS, (_e, id: string, status: string) =>
    orderService.updateStatus(id, status)
  )
  ipcMain.handle(IPC.ORDERS_GET_FOR_EDIT, (_e, id: string) =>
    orderService.getWithItems(id)
  )
  ipcMain.handle(IPC.ORDERS_UPDATE_AND_COMPLETE, (_e, input) =>
    orderService.updateAndComplete(input)
  )

  // Payments
  ipcMain.handle(IPC.PAYMENTS_LIST_FOR_ORDER, (_e, orderId: string) =>
    orderService.getWithItems(orderId)
  )

  // Staff
  ipcMain.handle(IPC.STAFF_LIST, () => staffService.list())
  ipcMain.handle(IPC.STAFF_AUTH, (_e, pin: string) => staffService.authenticate(pin))
  ipcMain.handle(IPC.STAFF_CREATE, (_e, input) => staffService.create(input))
  ipcMain.handle(IPC.STAFF_UPDATE, (_e, id: string, input) => staffService.update(id, input))
  ipcMain.handle(IPC.STAFF_DELETE, (_e, id: string) => staffService.delete(id))

  // Shifts
  ipcMain.handle(IPC.SHIFTS_OPEN, (_e, staffId: string, openingCash: number) =>
    staffService.openShift(staffId, openingCash)
  )
  ipcMain.handle(IPC.SHIFTS_CLOSE, (_e, shiftId: string, closingCash: number, notes?: string) =>
    staffService.closeShift(shiftId, closingCash, notes)
  )
  ipcMain.handle(IPC.SHIFTS_CURRENT, (_e, staffId: string) =>
    staffService.getCurrentShift(staffId)
  )

  // Reports
  ipcMain.handle(IPC.REPORTS_SALES_SUMMARY, (_e, from: string, to: string) =>
    reportService.salesSummary(from, to)
  )
  ipcMain.handle(IPC.REPORTS_SALES_BY_PRODUCT, (_e, from: string, to: string) =>
    reportService.salesByProduct(from, to)
  )
  ipcMain.handle(IPC.REPORTS_SALES_BY_STAFF, (_e, from: string, to: string) =>
    reportService.salesByStaff(from, to)
  )
  ipcMain.handle(IPC.REPORTS_SALES_BY_TERMINAL, (_e, from: string, to: string) =>
    reportService.salesByTerminal(from, to)
  )
  ipcMain.handle(IPC.REPORTS_PAYMENT_BREAKDOWN, (_e, from: string, to: string) =>
    reportService.paymentBreakdown(from, to)
  )
  ipcMain.handle(IPC.REPORTS_INVENTORY_VALUATION, () => reportService.inventoryValuation())

  // Settings
  // SECURITY: sensitive keys (tokens, passwords, hashed PINs) are never returned to the
  // renderer — the renderer has no legitimate need to read back a stored password.
  const RENDERER_BLOCKED_SETTINGS = new Set([
    'emailPassword', 'qboAccessToken', 'qboRefreshToken', 'qboTokenExpiry',
    'pinSalt', 'dashboardAdminPin', 'embeddedServerApiKey', 'syncApiKey'
  ])
  ipcMain.handle(IPC.SETTINGS_GET, (_e, key: string) => {
    if (RENDERER_BLOCKED_SETTINGS.has(key)) return ''
    return settingsService.get(key as never)
  })
  ipcMain.handle(IPC.SETTINGS_SET, (_e, key: string, value: string) =>
    settingsService.set(key, value)
  )
  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => settingsService.getAll())

  // Audit
  ipcMain.handle(IPC.AUDIT_LOG, (_e, input) => staffService.logAction(input))
  ipcMain.handle(IPC.AUDIT_LIST, (_e, limit?: number) => staffService.listAuditLog(limit))

  // ─── Shared print helper ───────────────────────────────────────────────────
  /**
   * Opens a hidden BrowserWindow, loads HTML from a temp file, then calls
   * webContents.print(). When `printerName` is set the job goes silently to
   * that printer; otherwise the Windows print dialog is shown so the user can
   * select paper size, orientation, and other driver settings manually.
   */
  async function printHtml(
    html: string,
    prefix: string,
    printerName: string,
    color: boolean,
    extraOpts?: Partial<Electron.WebContentsPrintOptions>
  ): Promise<{ success: boolean; error?: string }> {
    if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 5_000_000) {
      return { success: false, error: 'Print payload too large (max 5 MB)' }
    }
    const tmpFile = join(tmpdir(), `${prefix}-${randomBytes(8).toString('hex')}.html`)
    try {
      writeFileSync(tmpFile, html, 'utf8')
    } catch {
      return { success: false, error: 'Failed to write temp file for printing' }
    }
    return new Promise<{ success: boolean }>((resolve) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      })
      win.loadFile(tmpFile)
      win.webContents.once('did-finish-load', () => {
        const opts: Electron.WebContentsPrintOptions = {
          silent: !!printerName,   // silent when a specific printer is chosen; shows dialog otherwise
          printBackground: true,
          color,
          ...(printerName ? { deviceName: printerName } : {}),
          ...extraOpts
        }
        win.webContents.print(opts, (success) => {
          win.destroy()
          try { unlinkSync(tmpFile) } catch { /* ignore cleanup errors */ }
          resolve({ success })
        })
      })
    })
  }

  /**
   * Convert a paper-size setting string into Electron WebContentsPrintOptions
   * fields (margins + optional pageSize). Used for receipts and price tags.
   *
   * Values:
   *   'auto'   – rely entirely on the printer driver (recommended for thermal printers)
   *   '58mm'   – 58 mm roll paper  (width = 58 000 µm)
   *   '72mm'   – 72 mm roll paper  (width = 72 000 µm)
   *   '80mm'   – 80 mm roll paper  (width = 80 000 µm, most common)
   *   'A4'     – ISO A4 full page
   *   'Letter' – US Letter full page
   */
  function receiptPrintOpts(paperSize: string): Partial<Electron.WebContentsPrintOptions> {
    const base: Partial<Electron.WebContentsPrintOptions> = {
      margins: { marginType: 'none' }
    }
    const mmWidths: Record<string, number> = { '58mm': 58000, '72mm': 72000, '80mm': 80000 }
    if (mmWidths[paperSize]) {
      // Very tall height (999 mm) lets the content determine the actual printed length.
      return { ...base, pageSize: { width: mmWidths[paperSize], height: 999000 } }
    }
    if (paperSize === 'A4')     return { ...base, pageSize: 'A4' }
    if (paperSize === 'Letter') return { ...base, pageSize: 'Letter' }
    // 'auto' — send no pageSize; printer driver controls paper dimensions
    return base
  }

  // Receipt
  ipcMain.handle(IPC.RECEIPT_PRINT, async (_e, html: string) => {
    const printerName = settingsService.get('receiptPrinterName')?.trim() ?? ''
    const paperSize   = settingsService.get('receiptPaperSize')?.trim() || 'auto'
    return printHtml(html, 'receipt', printerName, false, receiptPrintOpts(paperSize))
  })

  // Invoice — always full-page, no custom margins (driver/dialog handles it)
  ipcMain.handle(IPC.INVOICE_PRINT, async (_e, html: string) => {
    const printerName = settingsService.get('invoicePrinterName')?.trim() ?? ''
    return printHtml(html, 'invoice', printerName, true)
  })

  // Price tag — uses its own paper size setting (independent of receipt paper size)
  ipcMain.handle(IPC.TAG_PRINT, async (_e, html: string) => {
    const printerName = settingsService.get('tagPrinterName')?.trim() ?? ''
    const paperSize   = settingsService.get('tagPaperSize')?.trim() || 'auto'
    return printHtml(html, 'tag', printerName, false, receiptPrintOpts(paperSize))
  })

  // List available Windows printers
  ipcMain.handle(IPC.PRINTERS_LIST, async () => {
    try {
      const wins = BrowserWindow.getAllWindows()
      if (!wins.length) return []
      const printers = await wins[0].webContents.getPrintersAsync()
      return printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: p.isDefault
      }))
    } catch {
      return []
    }
  })

  // Display (customer-facing screen)
  ipcMain.handle(IPC.DISPLAY_OPEN, () => {
    setDisplayLogo(settingsService.get('logoBase64') ?? '')
    openDisplayWindow()
    try {
      const bgColor = settingsService.get('displayBgColor')
      const bgImage = settingsService.get('displayBgImage')
      const storeName = settingsService.get('storeName') ?? undefined
      const current = getLastData()
      pushData({
        ...current,
        ...(bgColor != null && { displayBgColor: bgColor }),
        ...(bgImage != null && { displayBgImage: bgImage }),
        ...(storeName && { storeName }),
      })
    } catch { /* non-fatal */ }
    return { open: true }
  })
  ipcMain.handle(IPC.DISPLAY_CLOSE, () => {
    closeDisplayWindow()
    return { open: false }
  })
  ipcMain.handle(IPC.DISPLAY_STATUS, () => ({
    windowOpen: isDisplayWindowOpen(),
    networkRunning: isHttpServerRunning(),
    localIp: getLocalIp()
  }))
  ipcMain.handle(IPC.DISPLAY_UPDATE, (_e: IpcMainInvokeEvent, data: unknown) => {
    pushData(data as Parameters<typeof pushData>[0])
    return { ok: true }
  })
  /** Hydrate the renderer on mount — solves timing race with display:push */
  ipcMain.handle(IPC.DISPLAY_GET_STATE, () => getLastData())
  ipcMain.handle(IPC.DISPLAY_NETWORK_START, async (_e: IpcMainInvokeEvent, port: number) => {
    const usePort = port || 3031
    try { setDisplayLogo(settingsService.get('logoBase64') ?? '') } catch { /* non-fatal */ }
    try {
      await startHttpServer(usePort)
    } catch (err) {
      const msg = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `Port ${usePort} is already in use. The sync server may be using this port — try a different port (e.g. 3031).`
        : (err instanceof Error ? err.message : String(err))
      throw new Error(msg)
    }
    forcePushCurrentState().catch(() => { /* renderer not ready — ignore */ })
    return { running: true, port: usePort, ip: getLocalIp() }
  })
  ipcMain.handle(IPC.DISPLAY_NETWORK_STOP, async () => {
    await stopHttpServer()
    return { running: false }
  })
  ipcMain.handle(IPC.DISPLAY_NETWORK_STATUS, () => ({
    running: isHttpServerRunning(),
    ip: getLocalIp()
  }))

  // App
  ipcMain.handle(IPC.APP_GET_VERSION, () => '1.0.0')
  ipcMain.handle(IPC.APP_OPEN_CASH_DRAWER, () => {
    // TODO: send ESC/POS pulse command to cash drawer port
    return { success: true }
  })
  /** Returns all non-loopback IPv4 addresses on this machine for the server URL helper. */
  ipcMain.handle(IPC.APP_GET_LOCAL_IPS, (): string[] => {
    const nets = networkInterfaces()
    const ips: string[] = []
    for (const list of Object.values(nets)) {
      for (const iface of list ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address)
        }
      }
    }
    return ips
  })

  // QuickBooks Online
  ipcMain.handle(IPC.QBO_STATUS, () => qboService.getStatus())

  ipcMain.handle(IPC.QBO_START_AUTH, async (e) => {
    const { shell } = await import('electron')
    const { authUrl, completion } = qboService.startAuth()
    shell.openExternal(authUrl)
    return completion
  })

  ipcMain.handle(IPC.QBO_DISCONNECT, () => {
    qboService.disconnect()
    return { disconnected: true }
  })

  ipcMain.handle(IPC.QBO_SYNC_SALES, () => qboService.syncSales())
  ipcMain.handle(IPC.QBO_SYNC_CUSTOMERS, () => qboService.syncCustomers())

  // Accounting exports
  ipcMain.handle(IPC.EXPORT_TRANSACTIONS_CSV, (_e, from: string, to: string) =>
    exportService.transactionsCsv(from, to)
  )
  ipcMain.handle(IPC.EXPORT_IIF, (_e, from: string, to: string) =>
    exportService.quickbooksIif(from, to)
  )
  ipcMain.handle(IPC.EXPORT_DAILY_SUMMARY_CSV, (_e, from: string, to: string) =>
    exportService.dailySummaryCsv(from, to)
  )

  // CSV bulk import / export
  ipcMain.handle(IPC.CSV_IMPORT_PRODUCTS, (_e, csvText: string) =>
    csvImportExportService.importProducts(csvText)
  )
  ipcMain.handle(IPC.CSV_EXPORT_PRODUCTS, () =>
    csvImportExportService.exportProducts()
  )
  ipcMain.handle(IPC.CSV_IMPORT_CUSTOMERS, (_e, csvText: string) =>
    csvImportExportService.importCustomers(csvText)
  )
  ipcMain.handle(IPC.CSV_EXPORT_CUSTOMERS, () =>
    csvImportExportService.exportCustomers()
  )

  // Email
  ipcMain.handle(IPC.EMAIL_SEND_RECEIPT, async (_e, to: string, html: string, orderNumber: string) => {
    if (!to || !html) return { success: false, error: 'Missing recipient or content' }
    if (html.length > 2 * 1024 * 1024) return { success: false, error: 'Receipt HTML too large' }
    return sendReceiptEmail(to, html, orderNumber)
  })

  ipcMain.handle(IPC.EMAIL_SEND_INVOICE, async (_e, to: string, html: string, orderNumber: string) => {
    if (!to || !html) return { success: false, error: 'Missing recipient or content' }
    if (html.length > 2 * 1024 * 1024) return { success: false, error: 'Invoice HTML too large' }
    return sendInvoiceEmail(to, html, orderNumber)
  })

  ipcMain.handle(IPC.EMAIL_TEST_CONNECTION, async (_e, cfg: {
    host: string; port: number; secure: boolean
    user: string; password: string; fromName: string; fromAddress: string
  }) => {
    return testSmtpConnection(cfg)
  })

  // Image pick (open file dialog, return base64 data URL)
  ipcMain.handle(IPC.IMAGE_PICK, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Product Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const ext = extname(filePath).toLowerCase().replace('.', '')
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp', gif: 'image/gif'
    }
    const mime = mimeMap[ext] ?? 'image/jpeg'
    const data = readFileSync(filePath)
    return `data:${mime};base64,${data.toString('base64')}`
  })

  // Vendors
  ipcMain.handle(IPC.VENDORS_LIST, () => vendorService.list())
  ipcMain.handle(IPC.VENDORS_GET, (_e, id: string) => vendorService.getById(id))
  ipcMain.handle(IPC.VENDORS_CREATE, (_e, input) => vendorService.create(input))
  ipcMain.handle(IPC.VENDORS_UPDATE, (_e, id: string, input) => vendorService.update(id, input))
  ipcMain.handle(IPC.VENDORS_DELETE, (_e, id: string) => vendorService.delete(id))
  ipcMain.handle(IPC.VENDORS_RECORD_PAYOUT, (_e, input) => vendorService.recordPayout(input))
  ipcMain.handle(IPC.VENDORS_PAYOUT_HISTORY, (_e, vendorId: string) => vendorService.payoutHistory(vendorId))
  ipcMain.handle(IPC.VENDORS_PRODUCTS, (_e, vendorId: string) => vendorService.products(vendorId))

  // ── Multi-terminal sync ──────────────────────────────────────────────────

  // Push state changes to all renderer windows
  onSyncStateChange((syncState) => {
    BrowserWindow.getAllWindows().forEach((win: BrowserWindow) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SYNC_STATE_PUSH, syncState)
      }
    })
  })

  ipcMain.handle(IPC.SYNC_GET_STATE, () => getSyncState())

  ipcMain.handle(IPC.SYNC_RUN_NOW, async () => {
    await runSync()
    return getSyncState()
  })

  ipcMain.handle(IPC.SYNC_TEST_CONNECTION, async (_e, url: string, apiKey: string) => {
    return testConnection(url, apiKey)
  })

  ipcMain.handle(IPC.SYNC_START, (_e, intervalSeconds?: number) => {
    startSyncLoop(intervalSeconds)
    return getSyncState()
  })

  ipcMain.handle(IPC.SYNC_STOP, () => {
    stopSyncLoop()
    return getSyncState()
  })

  // ── Setup wizard + embedded server ──────────────────────────────────────────

  /** Returns the current setup state for the wizard to read on mount. */
  ipcMain.handle(IPC.SETUP_GET, () => ({
    setupComplete: settingsService.get('setupComplete'),
    nodeMode: settingsService.get('nodeMode'),
    embeddedServerPort: settingsService.get('embeddedServerPort'),
    embeddedServerApiKey: settingsService.get('embeddedServerApiKey'),
    terminalId: settingsService.get('terminalId'),
    syncUrl: settingsService.get('syncUrl'),
    syncApiKey: settingsService.get('syncApiKey')
  }))

  /**
   * Called when the user finishes the setup wizard.
   * Persists settings, then auto-starts sync / embedded server as appropriate.
   */
  ipcMain.handle(IPC.SETUP_COMPLETE, async (_e, input: {
    nodeMode: 'standalone' | 'server' | 'terminal'
    embeddedServerPort?: number
    embeddedServerApiKey?: string
    syncUrl?: string
    syncApiKey?: string
    syncIntervalSeconds?: number
  }) => {
    const now = new Date().toISOString()
    const save = (key: string, value: string) =>
      settingsService.set(key, value)

    save('nodeMode', input.nodeMode)
    save('setupComplete', 'true')

    if (input.nodeMode === 'standalone') {
      save('syncEnabled', 'false')

    } else if (input.nodeMode === 'server') {
      const port = input.embeddedServerPort ?? 3030
      const apiKey = input.embeddedServerApiKey ?? ''
      save('embeddedServerPort', String(port))
      save('embeddedServerApiKey', apiKey)
      // Server hosts data — it does NOT sync to itself.
      // Clear any stale terminal-sync settings so initSync() stays disabled.
      save('syncEnabled', 'false')
      save('syncUrl', '')
      save('syncApiKey', '')
      await startEmbeddedServer(port, apiKey)
      // No sync loop — terminals push/pull TO this server

    } else if (input.nodeMode === 'terminal') {
      save('syncEnabled', 'true')
      save('syncUrl', input.syncUrl ?? '')
      save('syncApiKey', input.syncApiKey ?? '')
      save('syncIntervalSeconds', String(input.syncIntervalSeconds ?? 30))
      startSyncLoop(input.syncIntervalSeconds ?? 30)
    }

    return { ok: true, serverTime: now }
  })

  /** Resets setupComplete so the wizard shows again on next launch. */
  ipcMain.handle(IPC.SETUP_RESET, () => {
    settingsService.set('setupComplete', 'false')
    return { ok: true }
  })

  ipcMain.handle(IPC.EMBEDDED_SERVER_START, async (_e, port: number, apiKey: string) => {
    return startEmbeddedServer(port, apiKey)
  })

  ipcMain.handle(IPC.EMBEDDED_SERVER_STOP, async () => {
    await stopEmbeddedServer()
    return { running: false }
  })

  ipcMain.handle(IPC.EMBEDDED_SERVER_STATUS, () => getEmbeddedServerStatus())

  // Admin web dashboard

  /**
   * Scan the local subnet for running Kinetix POS server nodes.
   *
   * Strategy: find the first non-loopback IPv4 address, derive the /24 subnet,
   * then race HTTP probes to each host:port combination in parallel with a short
   * timeout. Returns an array of discovered server base URLs.
   *
   * Common ports checked: the configured embeddedServerPort plus 3030–3035
   * so we find servers even if they run on a non-default port.
   */
  ipcMain.handle(IPC.SYNC_DISCOVER, async (): Promise<string[]> => {
    const { get } = await import('http')

    // 1. Find our LAN IP to determine the subnet
    const nets = networkInterfaces()
    let localIp = ''
    for (const list of Object.values(nets)) {
      for (const iface of list ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIp = iface.address
          break
        }
      }
      if (localIp) break
    }
    if (!localIp) return []

    // 2. Build the /24 host list (exclude .0 and .255)
    const parts = localIp.split('.')
    const prefix = parts.slice(0, 3).join('.')
    const ownLast = parseInt(parts[3], 10)

    // Ports to probe — configured port + the default range
    const configuredPort = parseInt(settingsService.get('embeddedServerPort') || '3030', 10)
    const ports = [...new Set([configuredPort, 3030, 3031, 3032])]

    /**
     * Probe a single host:port. Resolves to the URL string if a Kinetix POS
     * server is detected, or null if not reachable within the timeout.
     */
    function probe(host: string, port: number): Promise<string | null> {
      return new Promise((resolve) => {
        const url = `http://${host}:${port}/sync/status`
        const req = get(url, { timeout: 400 }, (res) => {
          // Any 2xx from /sync/status is good enough — collect body to confirm
          let body = ''
          res.on('data', (chunk: Buffer) => { body += chunk.toString() })
          res.on('end', () => {
            try {
              const json = JSON.parse(body) as Record<string, unknown>
              // Kinetix POS servers return { ok: true, mode: 'server' }
              if (json.ok === true) {
                resolve(`http://${host}:${port}`)
              } else {
                resolve(null)
              }
            } catch {
              resolve(null)
            }
          })
        })
        req.on('error', () => resolve(null))
        req.on('timeout', () => { req.destroy(); resolve(null) })
      })
    }

    // 3. Build all probes — skip our own IP to avoid discovering ourselves
    const probes: Promise<string | null>[] = []
    for (let last = 1; last <= 254; last++) {
      if (last === ownLast) continue
      const host = `${prefix}.${last}`
      for (const port of ports) {
        probes.push(probe(host, port))
      }
    }

    const results = await Promise.all(probes)
    return [...new Set(results.filter((r): r is string => r !== null))]
  })

}
