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
  Vendor
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
    ): Promise<void> => bridge.products.setComponents(compositeProductId, components)
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
    create: (input: Partial<StaffMember> & { pin: string }): Promise<StaffMember> =>
      bridge.staff.create(input),
    update: (id: string, input: Partial<StaffMember> & { pin?: string }): Promise<StaffMember> =>
      bridge.staff.update(id, input),
    delete: (id: string): Promise<void> => bridge.staff.delete(id)
  },

  shifts: {
    open: (staffId: string, openingCash: number): Promise<unknown> =>
      bridge.shifts.open(staffId, openingCash),
    close: (shiftId: string, closingCash: number, notes?: string): Promise<unknown> =>
      bridge.shifts.close(shiftId, closingCash, notes),
    current: (staffId: string): Promise<unknown> => bridge.shifts.current(staffId)
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
    inventoryValuation: (): Promise<unknown[]> => bridge.reports.inventoryValuation()
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
      embeddedServerApiKey: string
      terminalId: string
      syncUrl: string
      syncApiKey: string
    }> => bridge.setup.get(),
    complete: (input: {
      nodeMode: 'standalone' | 'server' | 'terminal'
      embeddedServerPort?: number
      embeddedServerApiKey?: string
      syncUrl?: string
      syncApiKey?: string
      syncIntervalSeconds?: number
    }): Promise<{ ok: boolean }> => bridge.setup.complete(input),
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
    testConnection: (url: string, apiKey: string): Promise<{ ok: boolean; message: string }> =>
      bridge.sync.testConnection(url, apiKey),
    start: (intervalSeconds?: number): Promise<void> => bridge.sync.start(intervalSeconds),
    stop: (): Promise<void> => bridge.sync.stop(),
    onStateChange: (callback: (state: unknown) => void): (() => void) =>
      bridge.sync.onStateChange(callback)
  },

  adminServer: {
    start: (): Promise<{ running: boolean; port: number; ip: string; token: string }> =>
      bridge.adminServer.start(),
    stop: (): Promise<{ running: boolean; port: number; ip: string; token: string }> =>
      bridge.adminServer.stop(),
    status: (): Promise<{ running: boolean; port: number; ip: string; token: string }> =>
      bridge.adminServer.status()
  }
}
