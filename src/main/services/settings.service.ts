import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { hashPin } from '../lib/pin'

export const DEFAULT_SETTINGS = {
  // ── Store ──────────────────────────────────────────────────────────────────
  storeName: '',
  storeAddress: '',
  storePhone: '',
  storeLogo: '',
  logoBase64: '',
  taxRate: '0',
  taxName: 'Tax',
  taxEnabled: 'true',
  receiptFooter: 'Thank you for your purchase!',
  currency: 'USD',
  currency2: 'KYD',
  currencySymbol: '$',
  kydToUsdRate: '0.82',
  loyaltyPointsPerDollar: '1',
  enabledPaymentMethods: '["cash","card","store_credit","gift_card","layaway"]',
  terminalName: 'Terminal 1',

  // ── Hardware ───────────────────────────────────────────────────────────────
  receiptPrinterPort: '',
  cashDrawerPort: '',
  receiptPrinterName: '',
  invoicePrinterName: '',
  tagPrinterName: '',
  receiptPaperSize: 'auto',
  tagPaperSize: 'auto',

  // ── Receipt & Invoice templates ────────────────────────────────────────────
  receiptTemplate: 'classic',
  receiptShowLogo: 'true',
  receiptFooterText: 'Thank you for your business!',
  receiptPrimaryColor: '#1e293b',
  receiptAccentColor: '#3b82f6',
  receiptFontFamily: 'system',
  receiptShowTaxLine: 'true',
  receiptShowDiscountLine: 'true',
  receiptShowNotes: 'true',
  receiptHeaderMessage: '',
  receiptCustomField1: '',
  receiptCustomField2: '',
  receiptCustomField3: '',
  invoiceShowLogo: 'true',
  invoiceFooterText: 'Payment due on receipt. Thank you!',
  invoicePrimaryColor: '#1e293b',
  invoiceAccentColor: '#10b981',
  invoiceHeaderMessage: '',
  invoiceShowTaxLine: 'true',
  invoiceShowDiscountLine: 'true',
  invoiceCustomField1: '',
  invoiceCustomField2: '',
  invoiceCustomField3: '',

  // ── Customer display ───────────────────────────────────────────────────────
  displayBgColor: '#0f172a',
  displayBgImage: '',

  // ── Sync — shared ─────────────────────────────────────────────────────────
  syncEnabled: 'false',
  syncUrl: '',
  syncApiKey: '',
  syncIntervalSeconds: '30',
  syncMode: 'http',          // 'http' | 'file'
  syncSharePath: '',

  // ── Sync — node identity ───────────────────────────────────────────────────
  terminalId: '',
  setupComplete: 'false',
  nodeMode: '',              // '' | 'server' | 'terminal'
  lastSyncAt: '',

  // ── Sync — embedded server (server mode only) ──────────────────────────────
  embeddedServerPort: '3030',
  embeddedServerApiKey: '',
  dashboardAdminPin: '',

  // ── Sync — v2 protocol ─────────────────────────────────────────────────────
  syncVersion: '',           // '' | 'v1' | 'v2'  ('' defaults to v1 behaviour)
  v2TerminalPushSeq: '0',    // highest seq this terminal has pushed & had acked
  v2ServerPullSeq: '0',      // highest server seq this terminal has applied

  // ── Sync — file sync (server + terminal) ──────────────────────────────────
  fileSyncLastPullAt: '',
  fileSyncServerLastExport: '',

  // ── Email ──────────────────────────────────────────────────────────────────
  emailHost: '',
  emailPort: '587',
  emailSecure: 'false',
  emailUser: '',
  emailPassword: '',
  emailFromName: 'Kinetix POS',
  emailFromAddress: '',

  // ── QuickBooks Online ──────────────────────────────────────────────────────
  qboClientId: '',
  qboClientSecret: '',
  qboSandbox: 'false',
  qboRealmId: '',

  // ── Database backups ───────────────────────────────────────────────────────
  /** JSON array of { id, label, path } — any folder: local, external drive, or a folder already synced by Dropbox/OneDrive/Google Drive. */
  backupDestinations: '[]',
  backupEnabled: 'false',
  /** Hours between automatic backups (6 / 12 / 24 / 168 = weekly). */
  backupIntervalHours: '24',
  /** Most recent backups to keep per destination — older app-created backups are pruned. */
  backupRetentionCount: '14',
  lastBackupAt: '',
  /** JSON array of { path, ok, error?, sizeBytes?, at } from the most recent run. */
  lastBackupResults: '[]',
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
