/** All IPC channel names -- single source of truth for main and renderer */
export const IPC = {
  // Products
  PRODUCTS_LIST: 'products:list',
  PRODUCTS_GET: 'products:get',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_SEARCH: 'products:search',
  PRODUCTS_BY_BARCODE: 'products:byBarcode',
  PRODUCTS_GET_COMPONENTS: 'products:getComponents',
  PRODUCTS_SET_COMPONENTS: 'products:setComponents',

  // Categories
  CATEGORIES_LIST: 'categories:list',
  CATEGORIES_CREATE: 'categories:create',
  CATEGORIES_UPDATE: 'categories:update',
  CATEGORIES_DELETE: 'categories:delete',

  // Variants
  VARIANTS_LIST: 'variants:list',
  VARIANTS_CREATE: 'variants:create',
  VARIANTS_UPDATE: 'variants:update',

  // Inventory
  INVENTORY_LIST: 'inventory:list',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_LOW_STOCK: 'inventory:lowStock',

  // Customers
  CUSTOMERS_LIST: 'customers:list',
  CUSTOMERS_GET: 'customers:get',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_SEARCH: 'customers:search',
  CUSTOMERS_PURCHASE_HISTORY: 'customers:purchaseHistory',

  // Orders
  ORDERS_CREATE: 'orders:create',
  ORDERS_GET: 'orders:get',
  ORDERS_LIST: 'orders:list',
  ORDERS_COMPLETE: 'orders:complete',
  ORDERS_VOID: 'orders:void',
  ORDERS_REFUND: 'orders:refund',
  ORDERS_HOLD: 'orders:hold',
  ORDERS_HELD_LIST: 'orders:heldList',
  ORDERS_UPDATE_STATUS: 'orders:updateStatus',
  ORDERS_GET_FOR_EDIT: 'orders:getForEdit',
  ORDERS_UPDATE_AND_COMPLETE: 'orders:updateAndComplete',

  // Payments
  PAYMENTS_LIST_FOR_ORDER: 'payments:listForOrder',

  // Staff
  STAFF_LIST: 'staff:list',
  STAFF_GET: 'staff:get',
  STAFF_CREATE: 'staff:create',
  STAFF_UPDATE: 'staff:update',
  STAFF_AUTH: 'staff:auth',

  // Shifts
  SHIFTS_OPEN: 'shifts:open',
  SHIFTS_CLOSE: 'shifts:close',
  SHIFTS_CURRENT: 'shifts:current',

  // Discounts
  DISCOUNTS_LIST: 'discounts:list',
  DISCOUNTS_CREATE: 'discounts:create',
  DISCOUNTS_UPDATE: 'discounts:update',
  DISCOUNTS_VALIDATE_COUPON: 'discounts:validateCoupon',

  // Gift Cards
  GIFT_CARDS_GET: 'giftCards:get',
  GIFT_CARDS_CREATE: 'giftCards:create',

  // Reports
  REPORTS_SALES_SUMMARY: 'reports:salesSummary',
  REPORTS_SALES_BY_PRODUCT: 'reports:salesByProduct',
  REPORTS_SALES_BY_STAFF: 'reports:salesByStaff',
  REPORTS_PAYMENT_BREAKDOWN: 'reports:paymentBreakdown',
  REPORTS_INVENTORY_VALUATION: 'reports:inventoryValuation',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',

  // Audit
  AUDIT_LOG: 'audit:log',
  AUDIT_LIST: 'audit:list',

  // Receipts
  RECEIPT_PRINT: 'receipt:print',

  // Display (customer-facing screen / network display)
  DISPLAY_OPEN: 'display:open',
  DISPLAY_CLOSE: 'display:close',
  DISPLAY_STATUS: 'display:status',
  DISPLAY_UPDATE: 'display:update',
  DISPLAY_NETWORK_START: 'display:networkStart',
  DISPLAY_NETWORK_STOP: 'display:networkStop',
  DISPLAY_NETWORK_STATUS: 'display:networkStatus',
  /** Push channel -- main -> renderer (not invoke) */
  DISPLAY_PUSH: 'display:push',
  /** Pull current display state on mount (fixes timing white-screen) */
  DISPLAY_GET_STATE: 'display:getState',

  // App
  APP_GET_VERSION: 'app:getVersion',
  APP_OPEN_CASH_DRAWER: 'app:openCashDrawer',

  // QuickBooks Online sync
  QBO_STATUS: 'qbo:status',
  QBO_START_AUTH: 'qbo:startAuth',
  QBO_DISCONNECT: 'qbo:disconnect',
  QBO_SYNC_SALES: 'qbo:syncSales',
  QBO_SYNC_CUSTOMERS: 'qbo:syncCustomers',

  // Accounting exports
  EXPORT_TRANSACTIONS_CSV: 'export:transactionsCsv',
  EXPORT_IIF: 'export:iif',
  EXPORT_DAILY_SUMMARY_CSV: 'export:dailySummaryCsv',

  // Invoice printing
  INVOICE_PRINT: 'invoice:print',

  // CSV bulk import / export
  CSV_IMPORT_PRODUCTS: 'csv:importProducts',
  CSV_EXPORT_PRODUCTS: 'csv:exportProducts',
  CSV_IMPORT_CUSTOMERS: 'csv:importCustomers',
  CSV_EXPORT_CUSTOMERS: 'csv:exportCustomers',

  // Email
  EMAIL_SEND_RECEIPT: 'email:sendReceipt',
  EMAIL_SEND_INVOICE: 'email:sendInvoice',
  EMAIL_TEST_CONNECTION: 'email:testConnection',

  // Images
  IMAGE_PICK: 'image:pick',

  // Vendors
  VENDORS_LIST: 'vendors:list',
  VENDORS_GET: 'vendors:get',
  VENDORS_CREATE: 'vendors:create',
  VENDORS_UPDATE: 'vendors:update',
  VENDORS_DELETE: 'vendors:delete',
  VENDORS_RECORD_PAYOUT: 'vendors:recordPayout',
  VENDORS_PAYOUT_HISTORY: 'vendors:payoutHistory',
  VENDORS_PRODUCTS: 'vendors:products',

  // Multi-terminal sync
  SYNC_GET_STATE: 'sync:getState',
  SYNC_RUN_NOW: 'sync:runNow',
  SYNC_TEST_CONNECTION: 'sync:testConnection',
  SYNC_START: 'sync:start',
  SYNC_STOP: 'sync:stop',
  /** Push channel — main → renderer, fires on every state change */
  SYNC_STATE_PUSH: 'sync:statePush',

  // Setup wizard + embedded server
  SETUP_GET: 'setup:get',
  SETUP_COMPLETE: 'setup:complete',
  SETUP_RESET: 'setup:reset',
  EMBEDDED_SERVER_START: 'embeddedServer:start',
  EMBEDDED_SERVER_STOP: 'embeddedServer:stop',
  EMBEDDED_SERVER_STATUS: 'embeddedServer:status'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
