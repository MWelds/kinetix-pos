import { eq } from 'drizzle-orm'
import { safeStorage } from 'electron'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { hashPin } from '../lib/pin'

/**
 * Settings whose stored value is encrypted at rest with the OS keystore
 * (Electron safeStorage → DPAPI on Windows). These are also machine-specific
 * (see MACHINE_SPECIFIC_SETTINGS) so the ciphertext, which is only decryptable
 * on the machine that wrote it, never syncs to other terminals.
 */
const ENCRYPTED_KEYS = new Set(['emailPassword'])
const ENC_PREFIX = 'enc:v1:'

/** Encrypt a value with the OS keystore. Falls back to plaintext if unavailable. */
function encryptValue(value: string): string {
  if (!value) return value
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  } catch { /* keystore unavailable — store as-is rather than lose the value */ }
  return value
}

/** Decrypt a value written by encryptValue(). Legacy plaintext passes through. */
function decryptValue(value: string): string {
  if (value && value.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
    } catch { return '' }
  }
  return value
}

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
  invoiceTemplate: 'classic',
  invoiceTitleLabel: 'INVOICE',
  invoiceNumberPrefix: '',
  invoiceFontSize: 'normal',
  invoiceMargin: 'normal',
  invoiceLogoSize: 'medium',
  invoiceShowSku: 'false',
  invoiceShowCustomer: 'true',
  invoiceShowPayments: 'true',
  invoiceShowPaidStamp: 'true',
  invoiceShowSignatureLine: 'false',
  invoiceWatermarkText: '',
  invoiceDueDays: '',

  // ── Customer display ───────────────────────────────────────────────────────
  displayBgColor: '#0f172a',
  displayBgImage: '',
  networkDisplayAutoStart: 'false',
  networkDisplayPort: '3031',

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

  // ── Cloud sync ─────────────────────────────────────────────────────────────
  cloudSyncEnabled: 'false',
  cloudSyncUrl: '',
  cloudApiKey: '',
  cloudSyncIntervalSeconds: '300',
  cloudPushWatermark: '',
  cloudPullWatermark: '',
  storeId: '',

  // ── Automatic database backups (machine-specific) ─────────────────────────
  backupEnabled: 'true',
  backupIntervalHours: '24',
  backupRetention: '14',
  backupCustomPath: '',
  lastBackupAt: '',
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
    const raw = row?.value ?? DEFAULT_SETTINGS[key]
    return ENCRYPTED_KEYS.has(key) ? decryptValue(raw) : raw
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
    } else if (ENCRYPTED_KEYS.has(key) && value.length > 0) {
      // Encrypt secrets (e.g. SMTP password) at rest with the OS keystore.
      storedValue = encryptValue(value)
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
