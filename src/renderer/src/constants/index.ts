/** App-wide constants — no magic numbers elsewhere */

export const APP_NAME = 'POS System'
export const APP_VERSION = '1.0.0'

/** Minimum touch target size in pixels (WCAG AA) */
export const MIN_TOUCH_TARGET = 44

/** Default tax rate (overridden by settings) */
export const DEFAULT_TAX_RATE = 0.08

/** Loyalty: 1 point per dollar spent; 100 pts = $1 */
export const LOYALTY_POINTS_PER_DOLLAR = 1
export const LOYALTY_POINTS_TO_DOLLAR = 0.01

/** Low stock warning threshold */
export const LOW_STOCK_THRESHOLD = 5

/** Max items per page in lists */
export const PAGE_SIZE = 50

/** Barcode scanner input: max ms between keystrokes to be considered a scan */
export const BARCODE_SCAN_TIMEOUT_MS = 100

/** Payment methods display labels */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Credit / Debit Card',
  store_credit: 'Store Credit',
  gift_card: 'Gift Card',
  layaway: 'Layaway'
}

/** Role display labels */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  cashier: 'Cashier'
}

/** Role permission levels (higher = more access) */
export const ROLE_LEVEL: Record<string, number> = {
  cashier: 1,
  manager: 2,
  admin: 3
}

/** Routes */
export const ROUTES = {
  LOGIN: '/login',
  POS: '/pos',
  ORDERS: '/orders',
  PRODUCTS: '/products',
  CUSTOMERS: '/customers',
  INVENTORY: '/inventory',
  REPORTS: '/reports',
  STAFF: '/staff',
  SETTINGS: '/settings',
  VENDORS: '/vendors'
} as const
