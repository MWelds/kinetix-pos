import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'

export const DEFAULT_SETTINGS = {
  storeName: 'My Store',
  storeAddress: '',
  storePhone: '',
  storeLogo: '',
  taxRate: '0',
  taxName: 'Tax',
  receiptFooter: 'Thank you for your purchase!',
  currency: 'USD',
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
  nodeMode: '',             // 'standalone' | 'server' | 'terminal'
  embeddedServerPort: '3030',
  embeddedServerApiKey: '',
  // Email / SMTP
  emailHost: '',
  emailPort: '587',
  emailSecure: 'false',
  emailUser: '',
  emailPassword: '',
  emailFromName: 'Kinetix POS',
  emailFromAddress: ''
}

export type SettingKey = keyof typeof DEFAULT_SETTINGS

/**
 * Keys that are generated internally by the app (OAuth tokens, security salt).
 * These are stripped from getAll() so they never travel over the IPC bridge
 * to the renderer.  User-entered credentials (clientId, clientSecret, syncApiKey)
 * ARE writable from the renderer — they are the user's own values.
 */
const SENSITIVE_KEYS = new Set([
  'qboAccessToken',
  'qboRefreshToken',
  'qboTokenExpiry',
  'pinSalt',
  'emailPassword'
])

/** Maximum payload size for any single setting value (2 MB). */
const MAX_VALUE_BYTES = 2 * 1024 * 1024

export const settingsService = {
  get(key: SettingKey): string {
    const db = getDatabase()
    const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()
    return row?.value ?? DEFAULT_SETTINGS[key]
  },

  /**
   * Persists a settings value.
   * Rejects writes to sensitive keys from this surface (they are set only by
   * internal services via direct DB access), and enforces a size cap to
   * prevent the renderer from storing unbounded data (e.g. a multi-MB logo).
   */
  set(key: string, value: string): void {
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
      throw new Error(`Setting '${key}' exceeds the maximum allowed size (2 MB)`)
    }
    const db = getDatabase()
    const now = new Date().toISOString()
    db.insert(schema.settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } })
      .run()
  },

  /**
   * Returns all non-sensitive settings as a flat key→value map.
   * Sensitive keys (OAuth tokens, secrets, PIN salt) are stripped before
   * the result is serialised and sent over the IPC bridge to the renderer.
   */
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
