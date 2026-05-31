import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { hashPin } from '../lib/pin'

export const DEFAULT_SETTINGS = {
  storeName: '',
  storeAddress: '',
  storePhone: '',
  storeLogo: '',
  taxRate: '0',
  taxName: 'Tax',
  receiptFooter: 'Thank you for your purchase!',
  currency: 'USD',
  currency2: 'KYD',
  currencySymbol: '$',
  loyaltyPointsPerDollar: '1',
  receiptPrinterPort: '',
  cashDrawerPort: '',
  syncEnabled: 'false',
  syncUrl: '',
  syncApiKey: '',
  syncIntervalSeconds: '30',
  terminalId: '',
  setupComplete: 'false',
  nodeMode: '',
  embeddedServerPort: '3030',
  embeddedServerApiKey: '',
  emailHost: '',
  emailPort: '587',
  emailSecure: 'false',
  emailUser: '',
  emailPassword: '',
  emailFromName: 'Kinetix POS',
  emailFromAddress: '',
  dashboardAdminPin: '',
  receiptPaperSize: 'auto',
  tagPaperSize: 'auto'
}

export type SettingKey = keyof typeof DEFAULT_SETTINGS

const SENSITIVE_KEYS = new Set([
  'qboAccessToken',
  'qboRefreshToken',
  'qboTokenExpiry',
  'pinSalt',
  'emailPassword',
  'dashboardAdminPin'
])

/** Maximum payload size for any single setting value (2 MB). */
const MAX_VALUE_BYTES = 2 * 1024 * 1024

export const settingsService = {
  get(key: SettingKey): string {
    const db = getDatabase()
    const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()
    return row?.value ?? DEFAULT_SETTINGS[key]
  },

  set(key: string, value: string): void {
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
      throw new Error(`Setting '${key}' exceeds the maximum allowed size (2 MB)`)
    }
    // Hash the dashboard admin PIN before storage so it is never persisted in plaintext.
    // An empty string means "no PIN set" — don't hash that.
    let storedValue = value
    if (key === 'dashboardAdminPin' && value.length > 0) {
      storedValue = hashPin(value)
    }
    const db = getDatabase()
    const now = new Date().toISOString()
    db.insert(schema.settings)
      .values({ key, value: storedValue, updatedAt: now })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: storedValue, updatedAt: now } })
      .run()
  },

  getAll(): Record<string, string> {
    const db = getDatabase()
    const rows = db.select().from(schema.settings).all()
    const result: Record<string, string> = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      if (!SENSITIVE_KEYS.has(row.key)) {
        result[row.key] = row.value
      }
    }
    return result
  }
}
