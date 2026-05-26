import { ipcMain, IpcMainInvokeEvent, BrowserWindow, dialog, app, WebContents } from 'electron'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, copyFileSync, existsSync } from 'fs'
import { extname, join } from 'path'
import { tmpdir } from 'os'
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
  getLocalIp
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
  ipcMain.handle(IPC.REPORTS_PAYMENT_BREAKDOWN, (_e, from: string, to: string) =>
    reportService.paymentBreakdown(from, to)
  )
  ipcMain.handle(IPC.REPORTS_INVENTORY_VALUATION, () => reportService.inventoryValuation())

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, (_e, key: string) => settingsService.get(key as never))
  ipcMain.handle(IPC.SETTINGS_SET, (_e, key: string, value: string) =>
    settingsService.set(key, value)
  )
  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => settingsService.getAll())

  // Audit
  ipcMain.handle(IPC.AUDIT_LOG, (_e, input) => staffService.logAction(input))
  ipcMain.handle(IPC.AUDIT_LIST, (_e, limit?: number) => staffService.listAuditLog(limit))

  // Receipt
  ipcMain.handle(IPC.RECEIPT_PRINT, async (_e, html: string) => {
    if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 5_000_000) {
      return { success: false, error: 'Receipt HTML payload too large (max 5 MB)' }
    }
    const tmpFile = join(tmpdir(), `receipt-${randomBytes(8).toString('hex')}.html`)
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
        win.webContents.print(
          { silent: false, printBackground: true, color: false },
          (success) => {
            win.destroy()
            try { unlinkSync(tmpFile) } catch { /* ignore cleanup errors */ }
            resolve({ success })
          }
        )
      })
    })
  })

  // Invoice print
  ipcMain.handle(IPC.INVOICE_PRINT, async (_e, html: string) => {
    if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 5_000_000) {
      return { success: false, error: 'Invoice HTML payload too large (max 5 MB)' }
    }
    const tmpFile = join(tmpdir(), `invoice-${randomBytes(8).toString('hex')}.html`)
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
        win.webContents.print(
          { silent: false, printBackground: true, color: true },
          (success) => {
            win.destroy()
            try { unlinkSync(tmpFile) } catch { /* ignore cleanup errors */ }
            resolve({ success })
          }
        )
      })
    })
  })

  // Display (customer-facing screen)
  ipcMain.handle(IPC.DISPLAY_OPEN, () => {
    setDisplayLogo(settingsService.get('logoBase64') ?? '')
    openDisplayWindow()
    try {
      const bgColor = settingsService.get('displayBgColor')
      const bgImage = settingsService.get('displayBgImage')
      const storeName = settingsService.get('storeName') ?? undefined
      // Merge display settings into the CURRENT lastData so we never clobber an
      // in-progress shopping session by hardcoding state:'idle' here.
      // The window's did-finish-load handler will push this merged state to the renderer.
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
    try { setDisplayLogo(settingsService.get('logoBase64') ?? '') } catch { /* non-fatal */ }
    await startHttpServer(port || 3030)
    return { running: true, port: port || 3030, ip: getLocalIp() }
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
  const { getSyncState, runSync, testConnection, startSyncLoop, stopSyncLoop, onSyncStateChange } = await import('../sync/sync.service')

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
}
