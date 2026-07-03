/**
 * Type-safe wrapper around window.api (the IPC bridge).
 * Components import from here, never accessing window.api directly.
 */

import type {
  Product,
  Category,
  Customer,
  StaffMember,
  Order,
  InventoryItem,
  SalesSummary,
  ProductComponent,
  Vendor,
  VendorPayable
} from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = (window as any).api

export const api = {
  products: {
    list: (categoryId?: string): Promise<Product[]> => bridge.products.list(categoryId),
    get: (id: string): Promise<Product | null> => bridge.products.get(id),
    search: (query: string): Promise<Product[]> => bridge.products.search(query),
    byBarcode: (barcode: string): Promise<Product | null> => bridge.products.byBarcode(barcode),
    create: (input: Partial<Product>): Promise<Product> => bridge.products.create(input),
    update: (id: string, input: Partial<Product>): Promise<Product> =>
      bridge.products.update(id, input),
    delete: (id: string): Promise<void> => bridge.products.delete(id),
    getComponents: (compositeProductId: string): Promise<ProductComponent[]> =>
      bridge.products.getComponents(compositeProductId),
    setComponents: (
      compositeProductId: string,
      components: Array<{ componentProductId: string; quantity: number }>
    ): Promise<void> => bridge.products.setComponents(compositeProductId, components),
    /** Fetch only the imageUrl for a product — used for lazy loading base64 images */
    imageUrl: (id: string): Promise<string | null> => bridge.products.imageUrl(id),
    /**
     * Server-side paginated product list with optional search and category filter.
     * Returns only `limit` rows from SQLite — avoids loading the full catalogue.
     */
    listPaginated: (opts: {
      search?: string
      categoryId?: string
      offset: number
      limit: number
    }): Promise<{ items: Product[]; total: number }> => bridge.products.listPaginated(opts)
  },

  categories: {
    list: (): Promise<Category[]> => bridge.categories.list(),
    create: (input: { name: string; color?: string }): Promise<Category> =>
      bridge.categories.create(input),
    update: (id: string, input: Partial<Category>): Promise<Category> =>
      bridge.categories.update(id, input),
    delete: (id: string): Promise<void> => bridge.categories.delete(id)
  },

  inventory: {
    list: (): Promise<InventoryItem[]> => bridge.inventory.list(),
    listPaginated: (opts: {
      search?: string
      offset: number
      limit: number
    }): Promise<{ items: InventoryItem[]; total: number; lowStockCount: number }> =>
      bridge.inventory.listPaginated(opts),
    lowStock: (): Promise<InventoryItem[]> => bridge.inventory.lowStock(),
    adjust: (input: {
      productId: string
      type: 'receive' | 'transfer' | 'loss' | 'adjustment'
      quantity: number
      note?: string
      staffId?: string
    }): Promise<InventoryItem> => bridge.inventory.adjust(input)
  },

  customers: {
    list: (): Promise<Customer[]> => bridge.customers.list(),
    get: (id: string): Promise<Customer | null> => bridge.customers.get(id),
    search: (query: string): Promise<Customer[]> => bridge.customers.search(query),
    create: (input: Partial<Customer>): Promise<Customer> => bridge.customers.create(input),
    update: (id: string, input: Partial<Customer>): Promise<Customer> =>
      bridge.customers.update(id, input),
    delete: (id: string): Promise<void> => bridge.customers.delete(id),
    purchaseHistory: (customerId: string): Promise<Order[]> =>
      bridge.customers.purchaseHistory(customerId)
  },

  orders: {
    create: (input: unknown): Promise<{ order: Order; items: unknown[]; payments: unknown[] }> =>
      bridge.orders.create(input),
    get: (id: string): Promise<{ order: Order; items: unknown[]; payments: unknown[] } | null> =>
      bridge.orders.get(id),
    list: (filters?: {
      status?: string
      fromDate?: string
      toDate?: string
      customerId?: string
      limit?: number
      offset?: number
    }): Promise<Order[]> => bridge.orders.list(filters),
    complete: (input: unknown): Promise<{ order: Order; items: unknown[]; payments: unknown[] }> =>
      bridge.orders.complete(input),
    voidOrder: (id: string, staffId: string): Promise<void> =>
      bridge.orders.voidOrder(id, staffId),
    refund: (id: string, itemIds: string[]): Promise<unknown> =>
      bridge.orders.refund(id, itemIds),
    hold: (id: string): Promise<void> => bridge.orders.hold(id),
    heldList: (): Promise<Order[]> => bridge.orders.heldList(),
    updateStatus: (id: string, status: string): Promise<void> =>
      bridge.orders.updateStatus(id, status),
    getForEdit: (id: string): Promise<{ order: Order; items: unknown[]; payments: unknown[] } | null> =>
      bridge.orders.getForEdit(id),
    updateAndComplete: (input: unknown): Promise<{ order: Order; items: unknown[]; payments: unknown[] }> =>
      bridge.orders.updateAndComplete(input)
  },

  staff: {
    list: (): Promise<StaffMember[]> => bridge.staff.list(),
    auth: (pin: string): Promise<StaffMember | null> => bridge.staff.auth(pin),
    logout: (): Promise<{ ok: boolean }> => bridge.staff.logout(),
    create: (input: Partial<StaffMember> & { pin: string }): Promise<StaffMember> =>
      bridge.staff.create(input),
    update: (id: string, input: Partial<StaffMember> & { pin?: string }): Promise<StaffMember> =>
      bridge.staff.update(id, input),
    delete: (id: string): Promise<void> => bridge.staff.delete(id),
    resetPin: (input: { staffId: string; adminPin: string; newPin: string; useRecoveryKey?: boolean }): Promise<{ ok: boolean; error?: string }> =>
      bridge.staff.resetPin(input),
    sendResetCode: (staffId: string): Promise<{ ok: boolean; maskedEmail?: string; error?: string }> =>
      bridge.staff.sendResetCode(staffId),
    verifyResetCode: (input: { staffId: string; code: string; newPin: string }): Promise<{ ok: boolean; error?: string }> =>
      bridge.staff.verifyResetCode(input)
  },

  shifts: {
    open: (staffId: string, openingCash: number): Promise<unknown> =>
      bridge.shifts.open(staffId, openingCash),
    close: (shiftId: string, closingCash: number, notes?: string, requestingStaffId?: string): Promise<unknown> =>
      bridge.shifts.close(shiftId, closingCash, notes, requestingStaffId),
    current: (staffId: string): Promise<unknown> => bridge.shifts.current(staffId),
    list: (): Promise<unknown[]> => bridge.shifts.list(),
    reopen: (shiftId: string): Promise<unknown> => bridge.shifts.reopen(shiftId),
    orders: (shiftId: string): Promise<unknown[]> => bridge.shifts.orders(shiftId)
  },

  reports: {
    salesSummary: (from: string, to: string): Promise<SalesSummary> =>
      bridge.reports.salesSummary(from, to),
    salesByProduct: (from: string, to: string): Promise<unknown[]> =>
      bridge.reports.salesByProduct(from, to),
    salesByStaff: (from: string, to: string): Promise<unknown[]> =>
      bridge.reports.salesByStaff(from, to),
    salesByTerminal: (from: string, to: string): Promise<unknown[]> =>
      bridge.reports.salesByTerminal(from, to),
    paymentBreakdown: (from: string, to: string): Promise<unknown[]> =>
      bridge.reports.paymentBreakdown(from, to),
    inventoryValuation: (): Promise<unknown[]> => bridge.reports.inventoryValuation(),
    vendorPayables: (from: string, to: string): Promise<VendorPayable[]> =>
      bridge.reports.vendorPayables(from, to),
    eodByTerminal: (from: string, to: string): Promise<{
      terminals: Array<{
        terminalId: string
        terminalName: string
        orderCount: number
        totalRevenue: number
        totalDiscount: number
        paymentRows: Array<{ method: string; count: number; total: number }>
      }>
      combined: { orderCount: number; totalRevenue: number; totalDiscount: number }
    }> => bridge.reports.eodByTerminal(from, to)
  },

  settings: {
    get: (key: string): Promise<string> => bridge.settings.get(key),
    set: (key: string, value: string): Promise<void> => bridge.settings.set(key, value),
    getAll: (): Promise<Record<string, string>> => bridge.settings.getAll()
  },

  audit: {
    log: (input: unknown): Promise<void> => bridge.audit.log(input),
    list: (limit?: number): Promise<unknown[]> => bridge.audit.list(limit)
  },

  receipt: {
    print: (html: string): Promise<{ success: boolean }> => bridge.receipt.print(html)
  },

  invoice: {
    print: (html: string): Promise<{ success: boolean }> => bridge.invoice.print(html)
  },

  tag: {
    print: (html: string): Promise<{ success: boolean }> => bridge.tag.print(html)
  },

  printers: {
    list: (): Promise<Array<{ name: string; displayName: string; isDefault: boolean }>> =>
      bridge.printers.list()
  },

  email: {
    sendReceipt: (to: string, html: string, orderNumber: string): Promise<{ success: boolean; error?: string }> =>
      bridge.email.sendReceipt(to, html, orderNumber),
    sendInvoice: (to: string, html: string, orderNumber: string): Promise<{ success: boolean; error?: string }> =>
      bridge.email.sendInvoice(to, html, orderNumber),
    testConnection: (cfg: {
      host: string; port: number; secure: boolean
      user: string; password: string; fromName: string; fromAddress: string
    }): Promise<{ success: boolean; error?: string }> =>
      bridge.email.testConnection(cfg)
  },

  display: {
    open: (): Promise<{ open: boolean }> => bridge.display.open(),
    close: (): Promise<{ open: boolean }> => bridge.display.close(),
    status: (): Promise<{ windowOpen: boolean; networkRunning: boolean; localIp: string }> =>
      bridge.display.status(),
    update: (data: unknown): Promise<{ ok: boolean }> => bridge.display.update(data),
    getState: (): Promise<unknown> => bridge.display.getState(),
    networkStart: (port: number): Promise<{ running: boolean; port: number; ip: string }> =>
      bridge.display.networkStart(port),
    networkStop: (): Promise<{ running: boolean }> => bridge.display.networkStop(),
    networkStatus: (): Promise<{ running: boolean; ip: string }> => bridge.display.networkStatus()
  },

  csv: {
    importProducts: (csvText: string): Promise<{ imported: number; updated: number; failed: number; errors: string[] }> =>
      bridge.csv.importProducts(csvText),
    exportProducts: (): Promise<string> => bridge.csv.exportProducts(),
    importCustomers: (csvText: string): Promise<{ imported: number; updated: number; failed: number; errors: string[] }> =>
      bridge.csv.importCustomers(csvText),
    exportCustomers: (): Promise<string> => bridge.csv.exportCustomers()
  },

  app: {
    getVersion: (): Promise<string> => bridge.app.getVersion(),
    openCashDrawer: (): Promise<{ success: boolean }> => bridge.app.openCashDrawer(),
    getLocalIps: (): Promise<string[]> => bridge.app.getLocalIps()
  },

  qbo: {
    status: (): Promise<{
      connected: boolean
      companyName: string | null
      realmId: string | null
      sandbox: boolean
      lastSyncAt: string | null
    }> => bridge.qbo.status(),
    startAuth: (): Promise<{ success: boolean; companyName?: string; error?: string }> =>
      bridge.qbo.startAuth(),
    disconnect: (): Promise<{ disconnected: boolean }> => bridge.qbo.disconnect(),
    syncSales: (): Promise<{ synced: number; failed: number; errors: string[] }> =>
      bridge.qbo.syncSales(),
    syncCustomers: (): Promise<{ synced: number; failed: number; errors: string[] }> =>
      bridge.qbo.syncCustomers()
  },

  accounting: {
    transactionsCsv: (from: string, to: string): Promise<string> =>
      bridge.accounting.transactionsCsv(from, to),
    iif: (from: string, to: string): Promise<string> => bridge.accounting.iif(from, to),
    dailySummaryCsv: (from: string, to: string): Promise<string> =>
      bridge.accounting.dailySummaryCsv(from, to)
  },

  images: {
    pick: (): Promise<string | null> => bridge.images.pick()
  },

  vendors: {
    list: (): Promise<Vendor[]> => bridge.vendors.list(),
    get: (id: string): Promise<Vendor | null> => bridge.vendors.get(id),
    create: (input: { name: string; phone?: string; email?: string; notes?: string }): Promise<Vendor> =>
      bridge.vendors.create(input),
    update: (id: string, input: Partial<{ name: string; phone: string; email: string; notes: string }>): Promise<Vendor> =>
      bridge.vendors.update(id, input),
    delete: (id: string): Promise<{ ok: boolean; reason?: string }> => bridge.vendors.delete(id),
    recordPayout: (input: { vendorId: string; amount: number; note?: string; staffId?: string }): Promise<{ balanceOwed: number }> =>
      bridge.vendors.recordPayout(input),
    payoutHistory: (vendorId: string): Promise<unknown[]> => bridge.vendors.payoutHistory(vendorId),
    products: (vendorId: string): Promise<unknown[]> => bridge.vendors.products(vendorId)
  },

  listeners: {
    onDisplayPush: (callback: (data: unknown) => void): (() => void) =>
      bridge.listeners.onDisplayPush(callback),
    onUpdateReady: (callback: () => void): (() => void) =>
      typeof bridge.listeners?.onUpdateReady === 'function'
        ? bridge.listeners.onUpdateReady(callback)
        : () => {}
  },

  setup: {
    get: (): Promise<{
      setupComplete: string
      nodeMode: string
      embeddedServerPort: string
      /** True if an embedded server API key has been configured — key value is never returned to renderer */
      embeddedServerApiKeySet: boolean
      terminalId: string
      syncUrl: string
      /** True if a sync API key has been configured — key value is never returned to renderer */
      syncApiKeySet: boolean
    }> => bridge.setup.get(),
    complete: (input: {
      nodeMode: 'standalone' | 'server' | 'terminal'
      embeddedServerPort?: number
      embeddedServerApiKey?: string
      syncUrl?: string
      syncApiKey?: string
      syncIntervalSeconds?: number
    }): Promise<{ ok: boolean; generatedApiKey?: string }> => bridge.setup.complete(input),
    reset: (): Promise<{ ok: boolean }> => bridge.setup.reset(),
    embeddedServerStart: (port: number, apiKey: string): Promise<{ running: boolean; port: number; ip: string }> =>
      bridge.setup.embeddedServerStart(port, apiKey),
    embeddedServerStop: (): Promise<{ running: boolean }> => bridge.setup.embeddedServerStop(),
    embeddedServerStatus: (): Promise<{ running: boolean; port: number; ip: string }> =>
      bridge.setup.embeddedServerStatus()
  },

  sync: {
    getState: (): Promise<unknown> => bridge.sync.getState(),
    runNow: (): Promise<unknown> => bridge.sync.runNow(),
    forceFull: (): Promise<unknown> => bridge.sync.forceFull(),
    testConnection: (url: string, apiKey: string): Promise<{ ok: boolean; message: string }> =>
      bridge.sync.testConnection(url, apiKey),
    start: (intervalSeconds?: number): Promise<void> => bridge.sync.start(intervalSeconds),
    stop: (): Promise<void> => bridge.sync.stop(),
    onStateChange: (callback: (state: unknown) => void): (() => void) =>
      bridge.sync.onStateChange(callback),
    discover: (): Promise<string[]> => bridge.sync.discover()
  },

  syncV2: {
    getState: (): Promise<unknown> => bridge.syncV2.getState(),
    runNow: (): Promise<unknown> => bridge.syncV2.runNow(),
    forceFull: (): Promise<unknown> => bridge.syncV2.forceFull(),
    start: (intervalSeconds?: number): Promise<void> => bridge.syncV2.start(intervalSeconds),
    stop: (): Promise<void> => bridge.syncV2.stop(),
    onStateChange: (callback: (state: unknown) => void): (() => void) =>
      bridge.syncV2.onStateChange(callback)
  },

  fileSync: {
    getState: (): Promise<unknown> => bridge.fileSync.getState(),
    runNow: (): Promise<{ ok: boolean; error?: string }> => bridge.fileSync.runNow(),
    start: (intervalSeconds?: number): Promise<{ ok: boolean; error?: string }> =>
      bridge.fileSync.start(intervalSeconds),
    stop: (): Promise<{ ok: boolean }> => bridge.fileSync.stop(),
    testPath: (sharePath: string): Promise<{ ok: boolean; message: string }> =>
      bridge.fileSync.testPath(sharePath),
    getLocalSharePath: (): Promise<string> => bridge.fileSync.getLocalSharePath(),
    onStateChange: (callback: (state: unknown) => void): (() => void) =>
      bridge.fileSync.onStateChange(callback)
  },


  cloudSync: {
    getState: (): Promise<unknown> => bridge.cloudSync.getState(),
    runNow: (): Promise<unknown> => bridge.cloudSync.runNow(),
    forceFull: (): Promise<unknown> => bridge.cloudSync.forceFull(),
    register: (args: { licenseKey: string; cloudSyncUrl: string }): Promise<{ ok: boolean; storeId?: string; error?: string }> =>
      bridge.cloudSync.register(args),
    onStateChange: (callback: (state: unknown) => void): (() => void) =>
      bridge.cloudSync.onStateChange(callback),
  },
}
