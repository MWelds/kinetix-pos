import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'

/** Type-safe IPC bridge exposed to the renderer as window.api */
const api = {
  // Products
  products: {
    list: (categoryId?: string) => ipcRenderer.invoke(IPC.PRODUCTS_LIST, categoryId),
    get: (id: string) => ipcRenderer.invoke(IPC.PRODUCTS_GET, id),
    search: (query: string) => ipcRenderer.invoke(IPC.PRODUCTS_SEARCH, query),
    byBarcode: (barcode: string) => ipcRenderer.invoke(IPC.PRODUCTS_BY_BARCODE, barcode),
    create: (input: unknown) => ipcRenderer.invoke(IPC.PRODUCTS_CREATE, input),
    update: (id: string, input: unknown) => ipcRenderer.invoke(IPC.PRODUCTS_UPDATE, id, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.PRODUCTS_DELETE, id),
    getComponents: (compositeProductId: string) =>
      ipcRenderer.invoke(IPC.PRODUCTS_GET_COMPONENTS, compositeProductId),
    setComponents: (
      compositeProductId: string,
      components: Array<{ componentProductId: string; quantity: number }>
    ) => ipcRenderer.invoke(IPC.PRODUCTS_SET_COMPONENTS, compositeProductId, components)
  },

  // Categories
  categories: {
    list: () => ipcRenderer.invoke(IPC.CATEGORIES_LIST),
    create: (input: unknown) => ipcRenderer.invoke(IPC.CATEGORIES_CREATE, input),
    update: (id: string, input: unknown) => ipcRenderer.invoke(IPC.CATEGORIES_UPDATE, id, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.CATEGORIES_DELETE, id)
  },

  // Inventory
  inventory: {
    list: () => ipcRenderer.invoke(IPC.INVENTORY_LIST),
    lowStock: () => ipcRenderer.invoke(IPC.INVENTORY_LOW_STOCK),
    adjust: (input: unknown) => ipcRenderer.invoke(IPC.INVENTORY_ADJUST, input)
  },

  // Customers
  customers: {
    list: () => ipcRenderer.invoke(IPC.CUSTOMERS_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.CUSTOMERS_GET, id),
    search: (query: string) => ipcRenderer.invoke(IPC.CUSTOMERS_SEARCH, query),
    create: (input: unknown) => ipcRenderer.invoke(IPC.CUSTOMERS_CREATE, input),
    update: (id: string, input: unknown) => ipcRenderer.invoke(IPC.CUSTOMERS_UPDATE, id, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.CUSTOMERS_DELETE, id),
    purchaseHistory: (customerId: string) =>
      ipcRenderer.invoke(IPC.CUSTOMERS_PURCHASE_HISTORY, customerId)
  },

  // Orders
  orders: {
    create: (input: unknown) => ipcRenderer.invoke(IPC.ORDERS_CREATE, input),
    get: (id: string) => ipcRenderer.invoke(IPC.ORDERS_GET, id),
    list: (filters?: unknown) => ipcRenderer.invoke(IPC.ORDERS_LIST, filters),
    complete: (input: unknown) => ipcRenderer.invoke(IPC.ORDERS_COMPLETE, input),
    voidOrder: (id: string, staffId: string) => ipcRenderer.invoke(IPC.ORDERS_VOID, id, staffId),
    refund: (id: string, itemIds: string[]) => ipcRenderer.invoke(IPC.ORDERS_REFUND, id, itemIds),
    hold: (id: string) => ipcRenderer.invoke(IPC.ORDERS_HOLD, id),
    heldList: () => ipcRenderer.invoke(IPC.ORDERS_HELD_LIST),
    updateStatus: (id: string, status: string) => ipcRenderer.invoke(IPC.ORDERS_UPDATE_STATUS, id, status),
    getForEdit: (id: string) => ipcRenderer.invoke(IPC.ORDERS_GET_FOR_EDIT, id),
    updateAndComplete: (input: unknown) => ipcRenderer.invoke(IPC.ORDERS_UPDATE_AND_COMPLETE, input)
  },

  // Staff
  staff: {
    list: () => ipcRenderer.invoke(IPC.STAFF_LIST),
    auth: (pin: string) => ipcRenderer.invoke(IPC.STAFF_AUTH, pin),
    logout: () => ipcRenderer.invoke(IPC.STAFF_LOGOUT),
    create: (input: unknown) => ipcRenderer.invoke(IPC.STAFF_CREATE, input),
    update: (id: string, input: unknown) => ipcRenderer.invoke(IPC.STAFF_UPDATE, id, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.STAFF_DELETE, id)
  },

  // Shifts
  shifts: {
    open: (staffId: string, openingCash: number) =>
      ipcRenderer.invoke(IPC.SHIFTS_OPEN, staffId, openingCash),
    close: (shiftId: string, closingCash: number, notes?: string, requestingStaffId?: string) =>
      ipcRenderer.invoke(IPC.SHIFTS_CLOSE, shiftId, closingCash, notes, requestingStaffId),
    current: (staffId: string) => ipcRenderer.invoke(IPC.SHIFTS_CURRENT, staffId),
    list: () => ipcRenderer.invoke(IPC.SHIFTS_LIST),
    reopen: (shiftId: string) => ipcRenderer.invoke(IPC.SHIFTS_REOPEN, shiftId),
    orders: (shiftId: string) => ipcRenderer.invoke(IPC.SHIFTS_ORDERS, shiftId)
  },

  // Reports
  reports: {
    salesSummary: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.REPORTS_SALES_SUMMARY, from, to),
    salesByProduct: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.REPORTS_SALES_BY_PRODUCT, from, to),
    salesByStaff: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.REPORTS_SALES_BY_STAFF, from, to),
    salesByTerminal: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.REPORTS_SALES_BY_TERMINAL, from, to),
    paymentBreakdown: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.REPORTS_PAYMENT_BREAKDOWN, from, to),
    inventoryValuation: () => ipcRenderer.invoke(IPC.REPORTS_INVENTORY_VALUATION)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, key),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),
    getAll: () => ipcRenderer.invoke(IPC.SETTINGS_GET_ALL)
  },

  // Audit
  audit: {
    log: (input: unknown) => ipcRenderer.invoke(IPC.AUDIT_LOG, input),
    list: (limit?: number) => ipcRenderer.invoke(IPC.AUDIT_LIST, limit)
  },

  // Receipt
  receipt: {
    print: (html: string) => ipcRenderer.invoke(IPC.RECEIPT_PRINT, html)
  },

  // Invoice
  invoice: {
    print: (html: string) => ipcRenderer.invoke(IPC.INVOICE_PRINT, html)
  },

  // Price tags (routes to the tag printer, not the invoice printer)
  tag: {
    print: (html: string) => ipcRenderer.invoke(IPC.TAG_PRINT, html)
  },

  // Hardware / Printers
  printers: {
    list: () => ipcRenderer.invoke(IPC.PRINTERS_LIST)
  },

  // Display (customer-facing screen)
  display: {
    open: () => ipcRenderer.invoke(IPC.DISPLAY_OPEN),
    close: () => ipcRenderer.invoke(IPC.DISPLAY_CLOSE),
    status: () => ipcRenderer.invoke(IPC.DISPLAY_STATUS),
    update: (data: unknown) => ipcRenderer.invoke(IPC.DISPLAY_UPDATE, data),
    getState: () => ipcRenderer.invoke(IPC.DISPLAY_GET_STATE),
    networkStart: (port: number) => ipcRenderer.invoke(IPC.DISPLAY_NETWORK_START, port),
    networkStop: () => ipcRenderer.invoke(IPC.DISPLAY_NETWORK_STOP),
    networkStatus: () => ipcRenderer.invoke(IPC.DISPLAY_NETWORK_STATUS)
  },

  // CSV bulk import / export
  csv: {
    importProducts: (csvText: string) => ipcRenderer.invoke(IPC.CSV_IMPORT_PRODUCTS, csvText),
    exportProducts: () => ipcRenderer.invoke(IPC.CSV_EXPORT_PRODUCTS),
    importCustomers: (csvText: string) => ipcRenderer.invoke(IPC.CSV_IMPORT_CUSTOMERS, csvText),
    exportCustomers: () => ipcRenderer.invoke(IPC.CSV_EXPORT_CUSTOMERS)
  },

  // App
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
    openCashDrawer: () => ipcRenderer.invoke(IPC.APP_OPEN_CASH_DRAWER),
    getLocalIps: () => ipcRenderer.invoke(IPC.APP_GET_LOCAL_IPS)
  },

  // QuickBooks Online
  qbo: {
    status: () => ipcRenderer.invoke(IPC.QBO_STATUS),
    startAuth: () => ipcRenderer.invoke(IPC.QBO_START_AUTH),
    disconnect: () => ipcRenderer.invoke(IPC.QBO_DISCONNECT),
    syncSales: () => ipcRenderer.invoke(IPC.QBO_SYNC_SALES),
    syncCustomers: () => ipcRenderer.invoke(IPC.QBO_SYNC_CUSTOMERS)
  },

  // Accounting exports
  accounting: {
    transactionsCsv: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.EXPORT_TRANSACTIONS_CSV, from, to),
    iif: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.EXPORT_IIF, from, to),
    dailySummaryCsv: (from: string, to: string) =>
      ipcRenderer.invoke(IPC.EXPORT_DAILY_SUMMARY_CSV, from, to)
  },

  // Email
  email: {
    sendReceipt: (to: string, html: string, orderNumber: string) =>
      ipcRenderer.invoke(IPC.EMAIL_SEND_RECEIPT, to, html, orderNumber),
    sendInvoice: (to: string, html: string, orderNumber: string) =>
      ipcRenderer.invoke(IPC.EMAIL_SEND_INVOICE, to, html, orderNumber),
    testConnection: (cfg: {
      host: string; port: number; secure: boolean
      user: string; password: string; fromName: string; fromAddress: string
    }) => ipcRenderer.invoke(IPC.EMAIL_TEST_CONNECTION, cfg)
  },

  // Images
  images: {
    pick: () => ipcRenderer.invoke(IPC.IMAGE_PICK)
  },

  // Vendors
  vendors: {
    list: () => ipcRenderer.invoke(IPC.VENDORS_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.VENDORS_GET, id),
    create: (input: unknown) => ipcRenderer.invoke(IPC.VENDORS_CREATE, input),
    update: (id: string, input: unknown) => ipcRenderer.invoke(IPC.VENDORS_UPDATE, id, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.VENDORS_DELETE, id),
    recordPayout: (input: unknown) => ipcRenderer.invoke(IPC.VENDORS_RECORD_PAYOUT, input),
    payoutHistory: (vendorId: string) => ipcRenderer.invoke(IPC.VENDORS_PAYOUT_HISTORY, vendorId),
    products: (vendorId: string) => ipcRenderer.invoke(IPC.VENDORS_PRODUCTS, vendorId)
  },

  // Push listeners -- one-way main -> renderer subscriptions
  listeners: {
    onDisplayPush: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.DISPLAY_PUSH, handler)
      return () => ipcRenderer.removeListener(IPC.DISPLAY_PUSH, handler)
    },

    onUpdateReady: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('update:ready', handler)
      return () => ipcRenderer.removeListener('update:ready', handler)
    }
  },

  // Auto-updater
  updater: {
    /** Quit and install the downloaded update immediately. */
    install: () => ipcRenderer.send('update:install')
  },

  // Multi-terminal sync
  sync: {
    getState: () => ipcRenderer.invoke(IPC.SYNC_GET_STATE),
    runNow: () => ipcRenderer.invoke(IPC.SYNC_RUN_NOW),
    testConnection: (url: string, apiKey: string) => ipcRenderer.invoke(IPC.SYNC_TEST_CONNECTION, url, apiKey),
    start: (intervalSeconds?: number) => ipcRenderer.invoke(IPC.SYNC_START, intervalSeconds),
    stop: () => ipcRenderer.invoke(IPC.SYNC_STOP),
    onStateChange: (callback: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
      ipcRenderer.on(IPC.SYNC_STATE_PUSH, handler)
      return () => ipcRenderer.removeListener(IPC.SYNC_STATE_PUSH, handler)
    },
    /** Scan local subnet for running Kinetix POS server nodes. */
    discover: () => ipcRenderer.invoke(IPC.SYNC_DISCOVER)
  },

  // Setup wizard + embedded server
  setup: {
    get: () => ipcRenderer.invoke(IPC.SETUP_GET),
    complete: (input: unknown) => ipcRenderer.invoke(IPC.SETUP_COMPLETE, input),
    reset: () => ipcRenderer.invoke(IPC.SETUP_RESET),
    embeddedServerStart: (port: number, apiKey: string) =>
      ipcRenderer.invoke(IPC.EMBEDDED_SERVER_START, port, apiKey),
    embeddedServerStop: () => ipcRenderer.invoke(IPC.EMBEDDED_SERVER_STOP),
    embeddedServerStatus: () => ipcRenderer.invoke(IPC.EMBEDDED_SERVER_STATUS)
  },

}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
