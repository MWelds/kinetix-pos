import { ipcMain, IpcMainInvokeEvent, BrowserWindow, dialog, app, WebContents } from 'electron'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, copyFileSync, existsSync } from 'fs'
import { extname, join } from 'path'
import { tmpdir } from 'os'
import { randomBytes, randomInt } from 'crypto'
import {
  openDisplayWindow,
  closeDisplayWindow,
  isDisplayWindowOpen,
  pushData,
  getLastData,
  startHttpServer,
  stopHttpServer,
  isHttpServerRunning,
  getLocalIp,
  forcePushCurrentState
} from '../display/customer-display'
import { IPC } from './channels'
import { sendReceiptEmail, sendInvoiceEmail, testSmtpConnection, sendGenericEmail } from '../services/email.service'
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
import { backupService } from '../services/backup.service'
import { discountService } from '../services/discount.service'
import { giftCardService } from '../services/gift-card.service'
import { getSyncState, runSync, forceFullSync, testConnection, startSyncLoop, stopSyncLoop, onSyncStateChange } from '../sync/sync.service'
import {
  getSyncV2State, runSyncV2, forceFullSyncV2,
  startSyncV2Loop, stopSyncV2Loop, onSyncV2StateChange
} from '../sync/sync-v2.service'
import {
  getCloudSyncState, runCloudSync, forceFullCloudSync, onCloudSyncStateChange,
  startCloudSyncLoop, stopCloudSyncLoop,
} from '../sync/cloud-sync.service'
import { startEmbeddedServer, stopEmbeddedServer, getEmbeddedServerStatus } from '../sync/embedded-server'
import {
  getFileSyncState, runFileSync, startFileSyncLoop, stopFileSyncLoop,
  testSharePath, onFileSyncStateChange
} from '../sync/file-sync.service'
import { startFileSyncServer, stopFileSyncServer, getDefaultLocalSharePath } from '../sync/file-sync-server'
import { getLanIps, getLanIp } from '../lib/network'

// ── PIN reset code store ─────────────────────────────────────────────────────

/** In-memory, single-use, time-limited codes for email-based PIN reset. */
interface ResetCode {
  code: string
  staffId: string
  expiresAt: number // epoch ms
}
const resetCodeStore = new Map<string, ResetCode>() // keyed by staffId

function generateResetCode(): string {
  // 6-digit numeric code — uses a CSPRNG so the code cannot be predicted
  return String(randomInt(100000, 1000000))
}

// ── Role enforcement ────────────────────────────────────────────────────────

/**
 * In-memory session store.  Keyed by the renderer WebContents.id so that if
 * the app has multiple windows each window tracks its own authenticated user.
 *
 * Entry is added on successful STAFF_AUTH and removed on STAFF_LOGOUT or when
 * the WebContents is destroyed.
 *
 * `pendingPinChange` is set when the authenticated account is still on its
 * seeded/known-default PIN (see `staff.isDefaultPin`). While true, requireRole()
 * rejects every gated action — the renderer's "Set a New PIN" modal has no
 * cancel, but it's a client-side gate; without this, anything reachable outside
 * that UI (e.g. devtools) could otherwise use the session immediately. The one
 * exception is STAFF_UPDATE setting the account's own PIN, handled specially
 * below, which clears the flag.
 */
const sessionStore = new Map<number, { staffId: string; role: string; pendingPinChange?: boolean }>()

/**
 * PIN login rate limiting, keyed by renderer WebContents.id (i.e. per terminal
 * keypad, not per staff account — the keypad is shared by all staff on the
 * device). Lockout duration doubles with each failure past the threshold.
 */
const STAFF_AUTH_MAX_ATTEMPTS = 5
const STAFF_AUTH_BASE_LOCKOUT_MS = 15_000
const STAFF_AUTH_MAX_LOCKOUT_MS = 5 * 60_000
const staffAuthAttempts = new Map<number, { count: number; lockUntil: number }>()

const ROLE_LEVEL: Record<string, number> = { cashier: 0, manager: 1, admin: 2 }

/**
 * Throws if the calling renderer has no active session or if its role is
 * below `minRole`.  Call at the top of any handler that should be restricted.
 *
 * @param e       The IPC event (provides sender identity)
 * @param minRole Minimum required role: 'cashier' | 'manager' | 'admin'
 */
function requireRole(e: IpcMainInvokeEvent, minRole: 'cashier' | 'manager' | 'admin'): void {
  const session = sessionStore.get(e.sender.id)
  if (!session) throw new Error('Not authenticated')
  if (session.pendingPinChange) throw new Error('PIN change required before continuing')
  const sessionLevel = ROLE_LEVEL[session.role] ?? -1
  const requiredLevel = ROLE_LEVEL[minRole] ?? 99
  if (sessionLevel < requiredLevel) {
    throw new Error(`Requires ${minRole} role — current role is ${session.role}`)
  }
}

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
  ipcMain.handle(IPC.PRODUCTS_CREATE, (e, input) => {
    requireRole(e, 'manager')
    return productService.create(input)
  })
  ipcMain.handle(IPC.PRODUCTS_UPDATE, (e, id: string, input) => {
    requireRole(e, 'manager')
    return productService.update(id, input)
  })
  ipcMain.handle(IPC.PRODUCTS_DELETE, (e, id: string) => {
    requireRole(e, 'manager')
    return productService.delete(id)
  })
  ipcMain.handle(IPC.PRODUCTS_GET_COMPONENTS, (_e, compositeProductId: string) =>
    productService.getComponents(compositeProductId)
  )
  ipcMain.handle(IPC.PRODUCTS_IMAGE_URL, (_e, id: string) =>
    productService.getImageUrl(id)
  )
  ipcMain.handle(
    IPC.PRODUCTS_LIST_PAGINATED,
    (_e, opts: { search?: string; categoryId?: string; offset: number; limit: number }) =>
      productService.listPaginated(opts)
  )
  ipcMain.handle(
    IPC.PRODUCTS_SET_COMPONENTS,
    (
      e,
      compositeProductId: string,
      components: Array<{ componentProductId: string; quantity: number }>
    ) => {
      requireRole(e, 'manager')
      return productService.setComponents(compositeProductId, components)
    }
  )

  // Categories
  ipcMain.handle(IPC.CATEGORIES_LIST, () => productService.listCategories())
  ipcMain.handle(IPC.CATEGORIES_CREATE, (e, input) => {
    requireRole(e, 'manager')
    return productService.createCategory(input)
  })
  ipcMain.handle(IPC.CATEGORIES_UPDATE, (e, id: string, input) => {
    requireRole(e, 'manager')
    return productService.updateCategory(id, input)
  })
  ipcMain.handle(IPC.CATEGORIES_DELETE, (e, id: string) => {
    requireRole(e, 'manager')
    return productService.deleteCategory(id)
  })

  // Inventory
  ipcMain.handle(IPC.INVENTORY_LIST, () => inventoryService.list())
  ipcMain.handle(IPC.INVENTORY_LIST_PAGINATED, (_e, opts) => inventoryService.listPaginated(opts))
  ipcMain.handle(IPC.INVENTORY_LOW_STOCK, () => inventoryService.lowStock())
  ipcMain.handle(IPC.INVENTORY_ADJUST, (e, input) => {
    requireRole(e, 'manager')
    return inventoryService.adjust(input)
  })

  // Customers
  ipcMain.handle(IPC.CUSTOMERS_LIST, () => customerService.list())
  ipcMain.handle(IPC.CUSTOMERS_GET, (_e, id: string) => customerService.getById(id))
  ipcMain.handle(IPC.CUSTOMERS_SEARCH, (_e, query: string) => customerService.search(query))
  ipcMain.handle(IPC.CUSTOMERS_PURCHASE_HISTORY, (_e, customerId: string) =>
    customerService.getPurchaseHistory(customerId)
  )
  ipcMain.handle(IPC.CUSTOMERS_CREATE, (e, input) => {
    requireRole(e, 'manager')
    return customerService.create(input)
  })
  ipcMain.handle(IPC.CUSTOMERS_UPDATE, (e, id: string, input) => {
    requireRole(e, 'manager')
    return customerService.update(id, input)
  })
  ipcMain.handle(IPC.CUSTOMERS_DELETE, (e, id: string) => {
    requireRole(e, 'manager')
    return customerService.delete(id)
  })

  // Orders
  ipcMain.handle(IPC.ORDERS_CREATE, (_e, input) => orderService.create(input))
  ipcMain.handle(IPC.ORDERS_GET, (_e, id: string) => orderService.getWithItems(id))
  ipcMain.handle(IPC.ORDERS_LIST, (_e, filters) => orderService.list(filters))
  ipcMain.handle(IPC.ORDERS_COMPLETE, (_e, input) => orderService.complete(input))
  ipcMain.handle(IPC.ORDERS_VOID, (e, id: string, staffId: string) => {
    requireRole(e, 'manager')
    return orderService.voidOrder(id, staffId)
  })
  ipcMain.handle(IPC.ORDERS_REFUND, (e, id: string, itemIds: string[]) => {
    requireRole(e, 'manager')
    return orderService.refund(id, itemIds)
  })
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
    orderService.getWithItems(orderId)?.payments ?? []
  )

  // Staff
  ipcMain.handle(IPC.STAFF_LIST, () => staffService.list())

  ipcMain.handle(IPC.STAFF_AUTH, (e, pin: string) => {
    const key = e.sender.id
    const attempt = staffAuthAttempts.get(key)
    if (attempt && attempt.lockUntil > Date.now()) {
      const retryAfterSec = Math.ceil((attempt.lockUntil - Date.now()) / 1000)
      throw new Error(`Too many failed attempts. Try again in ${retryAfterSec}s.`)
    }

    const result = staffService.authenticate(pin)
    if (result) {
      staffAuthAttempts.delete(key)
      // Register session in main process — used by requireRole() to enforce permissions.
      // An admin still on their seeded default PIN is registered as pending: requireRole()
      // rejects every gated action until the one-time self-PIN-update below clears it.
      const pendingPinChange = result.role === 'admin' && !!result.isDefaultPin
      sessionStore.set(e.sender.id, { staffId: result.id, role: result.role, pendingPinChange })
      // Auto-clear session when this WebContents is destroyed (window closed / reloaded)
      e.sender.once('destroyed', () => sessionStore.delete(e.sender.id))
    } else {
      const next = attempt ?? { count: 0, lockUntil: 0 }
      next.count += 1
      if (next.count >= STAFF_AUTH_MAX_ATTEMPTS) {
        const extra = next.count - STAFF_AUTH_MAX_ATTEMPTS
        next.lockUntil = Date.now() + Math.min(STAFF_AUTH_BASE_LOCKOUT_MS * 2 ** extra, STAFF_AUTH_MAX_LOCKOUT_MS)
      }
      staffAuthAttempts.set(key, next)
    }
    return result
  })

  ipcMain.handle(IPC.STAFF_LOGOUT, (e) => {
    sessionStore.delete(e.sender.id)
    return { ok: true }
  })

  /**
   * Unauthenticated PIN reset — available on the login screen.
   *
   * Two authorization paths:
   * 1. Normal: a valid manager or admin PIN. Managers cannot reset admin PINs.
   * 2. Emergency: the sync API key stored in settings. This path can reset any
   *    role including admin, and is the recovery route when no admin can log in.
   *    The API key is compared server-side and never returned to the renderer.
   *
   * Does NOT call requireRole() — intentionally reachable before any session.
   */
  ipcMain.handle(IPC.STAFF_RESET_PIN, (_e, input: {
    staffId: string
    /** Manager PIN (normal path) or sync API key (emergency path). */
    adminPin: string
    newPin: string
    /** When true, treat adminPin as the sync API key for emergency recovery. */
    useRecoveryKey?: boolean
  }) => {
    try {
      if (!input.staffId || !input.adminPin || !input.newPin) {
        return { ok: false, error: 'Missing required fields' }
      }
      if (input.newPin.length !== 4 || !/^\d{4}$/.test(input.newPin)) {
        return { ok: false, error: 'New PIN must be exactly 4 digits' }
      }

      // Look up target staff via staffService — no raw DB access needed.
      const allStaff = staffService.list()
      const target = allStaff.find((s) => s.id === input.staffId)
      if (!target) return { ok: false, error: 'Staff member not found' }

      if (input.useRecoveryKey) {
        // ── Emergency path: verify sync API key ───────────────────────────────
        const storedKey = (settingsService.get('syncApiKey') ?? '').trim()
        if (!storedKey) {
          return {
            ok: false,
            error: 'No recovery key configured. Set a Sync API Key in Settings → Sync first.'
          }
        }
        if (input.adminPin.trim() !== storedKey) {
          return { ok: false, error: 'Invalid recovery key' }
        }
        // Recovery key grants full reset access including admin accounts.
      } else {
        // ── Normal path: verify authorizing manager/admin PIN ─────────────────
        const authorizer = staffService.authenticate(input.adminPin)
        if (!authorizer) return { ok: false, error: 'Invalid manager PIN' }
        if (authorizer.role !== 'manager' && authorizer.role !== 'admin') {
          return { ok: false, error: 'Only a manager or admin can reset PINs' }
        }
        // Managers cannot reset another admin's PIN — only an admin can.
        if (target.role === 'admin' && authorizer.role !== 'admin') {
          return { ok: false, error: "Only an admin can reset another admin's PIN" }
        }
      }

      staffService.update(input.staffId, { pin: input.newPin })
      return { ok: true }
    } catch (err) {
      console.error('[STAFF_RESET_PIN] unexpected error:', err)
      return { ok: false, error: 'An unexpected error occurred during PIN reset' }
    }
  })

  /**
   * Send a 6-digit reset code to the staff member's registered email address.
   * The code is valid for 15 minutes and is single-use.
   * Does NOT require an active session — callable from the login screen.
   */
  ipcMain.handle(IPC.STAFF_SEND_RESET_CODE, async (_e, staffId: string) => {
    try {
      if (!staffId) return { ok: false, error: 'Missing staff ID' }
      const allStaff = staffService.list()
      const target = allStaff.find((s) => s.id === staffId)
      if (!target) return { ok: false, error: 'Staff member not found' }
      if (!target.email) {
        return { ok: false, error: `No email address on file for ${target.firstName}. Ask your system administrator to add one in Staff settings.` }
      }

      const code = generateResetCode()
      const expiresAt = Date.now() + 15 * 60 * 1000 // 15 minutes
      resetCodeStore.set(staffId, { code, staffId, expiresAt })

      const storeName = settingsService.get('storeName') ?? 'Kinetix POS'
      const result = await sendGenericEmail(
        target.email,
        `${storeName} — PIN Reset Code`,
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="color:#1e293b;margin-bottom:8px">PIN Reset Request</h2>
          <p style="color:#475569">Hi ${target.firstName}, your PIN reset code for <strong>${storeName}</strong> is:</p>
          <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#2563eb;text-align:center;padding:24px 0">${code}</div>
          <p style="color:#64748b;font-size:14px">This code expires in <strong>15 minutes</strong> and can only be used once.</p>
          <p style="color:#64748b;font-size:14px">If you did not request this reset, no action is needed — the code will expire automatically.</p>
        </div>`
      )
      if (!result.success) return { ok: false, error: result.error ?? 'Failed to send email' }

      // Mask email for display: ma***@example.com
      const [user, domain] = target.email.split('@')
      const maskedEmail = `${user.slice(0, 2)}***@${domain}`
      return { ok: true, maskedEmail }
    } catch (err) {
      console.error('[STAFF_SEND_RESET_CODE]', err)
      return { ok: false, error: 'Failed to send reset email' }
    }
  })

  /**
   * Verify the 6-digit code and reset the PIN if valid.
   * Code must not be expired and must match exactly. It is deleted on first use.
   */
  ipcMain.handle(IPC.STAFF_VERIFY_RESET_CODE, (_e, input: {
    staffId: string
    code: string
    newPin: string
  }) => {
    try {
      if (!input.staffId || !input.code || !input.newPin) {
        return { ok: false, error: 'Missing required fields' }
      }
      if (input.newPin.length !== 4 || !/^\d{4}$/.test(input.newPin)) {
        return { ok: false, error: 'New PIN must be exactly 4 digits' }
      }
      const stored = resetCodeStore.get(input.staffId)
      if (!stored) return { ok: false, error: 'No reset code found. Please request a new one.' }
      if (Date.now() > stored.expiresAt) {
        resetCodeStore.delete(input.staffId)
        return { ok: false, error: 'Reset code has expired. Please request a new one.' }
      }
      if (input.code.trim() !== stored.code) {
        return { ok: false, error: 'Incorrect code. Please try again.' }
      }
      // Single-use: delete immediately after successful verification
      resetCodeStore.delete(input.staffId)
      staffService.update(input.staffId, { pin: input.newPin })
      return { ok: true }
    } catch (err) {
      console.error('[STAFF_VERIFY_RESET_CODE]', err)
      return { ok: false, error: 'An unexpected error occurred' }
    }
  })

  ipcMain.handle(IPC.STAFF_CREATE, (e, input) => {
    requireRole(e, 'admin')
    return staffService.create(input)
  })
  ipcMain.handle(IPC.STAFF_UPDATE, (e, id: string, input) => {
    const session = sessionStore.get(e.sender.id)
    if (session?.pendingPinChange) {
      // Narrow exception: a session still pending its forced PIN change may only
      // set its OWN new PIN — nothing else — to unblock itself. Anything wider
      // (another field, another staff id) still requires a fully-cleared admin.
      const onlyPinField = Object.keys(input ?? {}).every((k) => k === 'pin')
      if (session.staffId !== id || !onlyPinField) {
        throw new Error('PIN change required before continuing')
      }
      const updated = staffService.update(id, input)
      session.pendingPinChange = false
      return updated
    }
    requireRole(e, 'admin')
    return staffService.update(id, input)
  })
  ipcMain.handle(IPC.STAFF_DELETE, (e, id: string) => {
    requireRole(e, 'admin')
    return staffService.delete(id)
  })

  // Shifts
  ipcMain.handle(IPC.SHIFTS_OPEN, (_e, staffId: string, openingCash: number) =>
    staffService.openShift(staffId, openingCash)
  )
  ipcMain.handle(IPC.SHIFTS_CLOSE, (e, shiftId: string, closingCash: number, notes?: string, requestingStaffId?: string) =>
    staffService.closeShift(shiftId, closingCash, notes, requestingStaffId)
  )
  ipcMain.handle(IPC.SHIFTS_CURRENT, (_e, staffId: string) =>
    staffService.getCurrentShift(staffId)
  )
  ipcMain.handle(IPC.SHIFTS_LIST, (e) => {
    requireRole(e, 'manager')
    return staffService.listShifts()
  })
  ipcMain.handle(IPC.SHIFTS_REOPEN, (e, shiftId: string) => {
    requireRole(e, 'manager')
    return staffService.reopenShift(shiftId)
  })
  ipcMain.handle(IPC.SHIFTS_ORDERS, (e, shiftId: string) => {
    requireRole(e, 'manager')
    return staffService.getOrdersForShift(shiftId)
  })

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
  ipcMain.handle(IPC.REPORTS_SALES_BY_TERMINAL, (_e, from: string, to: string) =>
    reportService.salesByTerminal(from, to)
  )
  ipcMain.handle(IPC.REPORTS_PAYMENT_BREAKDOWN, (_e, from: string, to: string) =>
    reportService.paymentBreakdown(from, to)
  )
  ipcMain.handle(IPC.REPORTS_INVENTORY_VALUATION, () => reportService.inventoryValuation())
  ipcMain.handle(IPC.REPORTS_VENDOR_PAYABLES, (_e, from: string, to: string) =>
    reportService.vendorPayables(from, to)
  )
  ipcMain.handle(IPC.REPORTS_EOD_BY_TERMINAL, (_e, from: string, to: string) =>
    reportService.eodByTerminal(from, to)
  )

  // Settings
  // SECURITY: sensitive keys (tokens, passwords, hashed PINs) are never returned to the
  // renderer — the renderer has no legitimate need to read back a stored password.
  const RENDERER_BLOCKED_SETTINGS = new Set([
    'emailPassword', 'qboAccessToken', 'qboRefreshToken', 'qboTokenExpiry',
    'pinSalt', 'dashboardAdminPin', 'embeddedServerApiKey', 'syncApiKey'
  ])
  ipcMain.handle(IPC.SETTINGS_GET, (_e, key: string) => {
    if (RENDERER_BLOCKED_SETTINGS.has(key)) return ''
    return settingsService.get(key as never)
  })
  ipcMain.handle(IPC.SETTINGS_SET, (e, key: string, value: string) => {
    requireRole(e, 'admin')
    return settingsService.set(key, value)
  })
  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => {
    const all = settingsService.getAll()
    // Apply the same block-list as SETTINGS_GET — strip sensitive keys before returning
    for (const key of RENDERER_BLOCKED_SETTINGS) {
      delete (all as Record<string, unknown>)[key]
    }
    return all
  })

  // Audit
  ipcMain.handle(IPC.AUDIT_LOG, (_e, input) => staffService.logAction(input))
  ipcMain.handle(IPC.AUDIT_LIST, (e, limit?: number) => {
    requireRole(e, 'manager')
    // Cap limit to prevent loading the entire table into memory
    const safeLimit = Math.min(typeof limit === 'number' && limit > 0 ? limit : 100, 1000)
    return staffService.listAuditLog(safeLimit)
  })

  // ─── Shared print helper ───────────────────────────────────────────────────
  /**
   * Opens a hidden BrowserWindow, loads HTML from a temp file, then calls
   * webContents.print(). When `printerName` is set the job goes silently to
   * that printer; otherwise the Windows print dialog is shown so the user can
   * select paper size, orientation, and other driver settings manually.
   */
  async function printHtml(
    html: string,
    prefix: string,
    printerName: string,
    color: boolean,
    extraOpts?: Partial<Electron.WebContentsPrintOptions>
  ): Promise<{ success: boolean; error?: string }> {
    if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > 5_000_000) {
      return { success: false, error: 'Print payload too large (max 5 MB)' }
    }
    const tmpFile = join(tmpdir(), `${prefix}-${randomBytes(8).toString('hex')}.html`)
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
        const opts: Electron.WebContentsPrintOptions = {
          silent: !!printerName,   // silent when a specific printer is chosen; shows dialog otherwise
          printBackground: true,
          color,
          ...(printerName ? { deviceName: printerName } : {}),
          ...extraOpts
        }
        win.webContents.print(opts, (success) => {
          win.destroy()
          try { unlinkSync(tmpFile) } catch { /* ignore cleanup errors */ }
          resolve({ success })
        })
      })
    })
  }

  /**
   * Convert a paper-size setting string into Electron WebContentsPrintOptions
   * fields (margins + optional pageSize). Used for receipts and price tags.
   *
   * Values:
   *   'auto'   – rely entirely on the printer driver (recommended for thermal printers)
   *   '58mm'   – 58 mm roll paper  (width = 58 000 µm)
   *   '72mm'   – 72 mm roll paper  (width = 72 000 µm)
   *   '80mm'   – 80 mm roll paper  (width = 80 000 µm, most common)
   *   'A4'     – ISO A4 full page
   *   'Letter' – US Letter full page
   */
  function receiptPrintOpts(paperSize: string): Partial<Electron.WebContentsPrintOptions> {
    const base: Partial<Electron.WebContentsPrintOptions> = {
      margins: { marginType: 'none' }
    }
    const mmWidths: Record<string, number> = { '58mm': 58000, '72mm': 72000, '80mm': 80000 }
    if (mmWidths[paperSize]) {
      // Very tall height (999 mm) lets the content determine the actual printed length.
      return { ...base, pageSize: { width: mmWidths[paperSize], height: 999000 } }
    }
    if (paperSize === 'A4')     return { ...base, pageSize: 'A4' }
    if (paperSize === 'Letter') return { ...base, pageSize: 'Letter' }
    // 'auto' — send no pageSize; printer driver controls paper dimensions
    return base
  }

  // Receipt
  ipcMain.handle(IPC.RECEIPT_PRINT, async (_e, html: string) => {
    const printerName = settingsService.get('receiptPrinterName')?.trim() ?? ''
    const paperSize   = settingsService.get('receiptPaperSize')?.trim() || 'auto'
    return printHtml(html, 'receipt', printerName, false, receiptPrintOpts(paperSize))
  })

  // Invoice — always full-page, no custom margins (driver/dialog handles it)
  ipcMain.handle(IPC.INVOICE_PRINT, async (_e, html: string) => {
    const printerName = settingsService.get('invoicePrinterName')?.trim() ?? ''
    return printHtml(html, 'invoice', printerName, true)
  })

  // Price tag — uses its own paper size setting (independent of receipt paper size)
  ipcMain.handle(IPC.TAG_PRINT, async (_e, html: string) => {
    const printerName = settingsService.get('tagPrinterName')?.trim() ?? ''
    const paperSize   = settingsService.get('tagPaperSize')?.trim() || 'auto'
    return printHtml(html, 'tag', printerName, false, receiptPrintOpts(paperSize))
  })

  // List available Windows printers
  ipcMain.handle(IPC.PRINTERS_LIST, async () => {
    try {
      const wins = BrowserWindow.getAllWindows()
      if (!wins.length) return []
      const printers = await wins[0].webContents.getPrintersAsync()
      return printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: p.isDefault
      }))
    } catch {
      return []
    }
  })

  // Display (customer-facing screen)
  ipcMain.handle(IPC.DISPLAY_OPEN, () => {
    setDisplayLogo(settingsService.get('logoBase64') ?? '')
    openDisplayWindow()
    try {
      const bgColor = settingsService.get('displayBgColor')
      const bgImage = settingsService.get('displayBgImage')
      const storeName = settingsService.get('storeName') ?? undefined
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
    const usePort = port || 3031
    try { setDisplayLogo(settingsService.get('logoBase64') ?? '') } catch { /* non-fatal */ }
    try {
      await startHttpServer(usePort)
    } catch (err) {
      const msg = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `Port ${usePort} is already in use. The sync server may be using this port — try a different port (e.g. 3031).`
        : (err instanceof Error ? err.message : String(err))
      throw new Error(msg)
    }
    forcePushCurrentState().catch(() => { /* renderer not ready — ignore */ })
    return { running: true, port: usePort, ip: getLocalIp() }
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
  /** Returns real LAN IPv4 addresses for this machine, filtering out Docker/WSL virtual adapters. */
  ipcMain.handle(IPC.APP_GET_LOCAL_IPS, (): string[] => getLanIps())

  // QuickBooks Online
  ipcMain.handle(IPC.QBO_STATUS, () => qboService.getStatus())

  ipcMain.handle(IPC.QBO_START_AUTH, async (e) => {
    requireRole(e, 'admin')
    const { shell } = await import('electron')
    const { authUrl, completion } = qboService.startAuth()
    shell.openExternal(authUrl)
    return completion
  })

  ipcMain.handle(IPC.QBO_DISCONNECT, (e) => {
    requireRole(e, 'admin')
    qboService.disconnect()
    return { disconnected: true }
  })

  ipcMain.handle(IPC.QBO_SYNC_SALES, (e) => {
    requireRole(e, 'admin')
    return qboService.syncSales()
  })
  ipcMain.handle(IPC.QBO_SYNC_CUSTOMERS, (e) => {
    requireRole(e, 'admin')
    return qboService.syncCustomers()
  })

  // Accounting exports (admin only — financial data)
  ipcMain.handle(IPC.EXPORT_TRANSACTIONS_CSV, (e, from: string, to: string) => {
    requireRole(e, 'admin')
    return exportService.transactionsCsv(from, to)
  })
  ipcMain.handle(IPC.EXPORT_IIF, (e, from: string, to: string) => {
    requireRole(e, 'admin')
    return exportService.quickbooksIif(from, to)
  })
  ipcMain.handle(IPC.EXPORT_DAILY_SUMMARY_CSV, (e, from: string, to: string) => {
    requireRole(e, 'admin')
    return exportService.dailySummaryCsv(from, to)
  })

  // CSV bulk import / export
  ipcMain.handle(IPC.CSV_IMPORT_PRODUCTS, async (e, csvText: string) => {
    requireRole(e, 'manager')
    return csvImportExportService.importProducts(csvText)
  })
  ipcMain.handle(IPC.CSV_EXPORT_PRODUCTS, (e) => {
    requireRole(e, 'manager')
    return csvImportExportService.exportProducts()
  })
  ipcMain.handle(IPC.CSV_IMPORT_CUSTOMERS, (e, csvText: string) => {
    requireRole(e, 'manager')
    return csvImportExportService.importCustomers(csvText)
  })
  ipcMain.handle(IPC.CSV_EXPORT_CUSTOMERS, (e) => {
    requireRole(e, 'manager')
    return csvImportExportService.exportCustomers()
  })

  // Email
  ipcMain.handle(IPC.EMAIL_SEND_RECEIPT, async (_e, to: string, html: string, orderNumber: string) => {
    if (!to || !html) return { success: false, error: 'Missing recipient or content' }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { success: false, error: 'Invalid email address' }
    if (html.length > 2 * 1024 * 1024) return { success: false, error: 'Receipt HTML too large' }
    return sendReceiptEmail(to, html, orderNumber)
  })

  ipcMain.handle(IPC.EMAIL_SEND_INVOICE, async (_e, to: string, html: string, orderNumber: string) => {
    if (!to || !html) return { success: false, error: 'Missing recipient or content' }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { success: false, error: 'Invalid email address' }
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

  // Database backups
  ipcMain.handle(IPC.BACKUP_GET_STATUS, () => backupService.getStatus())
  ipcMain.handle(IPC.BACKUP_ADD_DESTINATION, async (e, label?: string) => {
    requireRole(e, 'manager')
    const path = await backupService.pickFolder()
    if (!path) return null
    return backupService.addDestination(path, label)
  })
  ipcMain.handle(IPC.BACKUP_REMOVE_DESTINATION, (e, id: string) => {
    requireRole(e, 'manager')
    return backupService.removeDestination(id)
  })
  ipcMain.handle(IPC.BACKUP_RUN_NOW, (e) => {
    requireRole(e, 'manager')
    return backupService.runBackupNow()
  })
  ipcMain.handle(IPC.BACKUP_SET_SCHEDULE, (e, input: { enabled: boolean; intervalHours: number; retentionCount: number }) => {
    requireRole(e, 'manager')
    return backupService.setSchedule(input)
  })

  // Vendors
  ipcMain.handle(IPC.VENDORS_LIST, () => vendorService.list())
  ipcMain.handle(IPC.VENDORS_GET, (_e, id: string) => vendorService.getById(id))
  ipcMain.handle(IPC.VENDORS_PAYOUT_HISTORY, (_e, vendorId: string) => vendorService.payoutHistory(vendorId))
  ipcMain.handle(IPC.VENDORS_PRODUCTS, (_e, vendorId: string) => vendorService.products(vendorId))
  ipcMain.handle(IPC.VENDORS_CREATE, (e, input) => {
    requireRole(e, 'manager')
    return vendorService.create(input)
  })
  ipcMain.handle(IPC.VENDORS_UPDATE, (e, id: string, input) => {
    requireRole(e, 'manager')
    return vendorService.update(id, input)
  })
  ipcMain.handle(IPC.VENDORS_DELETE, (e, id: string) => {
    requireRole(e, 'manager')
    return vendorService.delete(id)
  })
  ipcMain.handle(IPC.VENDORS_RECORD_PAYOUT, (e, input) => {
    requireRole(e, 'manager')
    return vendorService.recordPayout(input)
  })

  // ── Multi-terminal sync ──────────────────────────────────────────────────

  // Push state changes to all renderer windows
  onSyncStateChange((syncState) => {
    BrowserWindow.getAllWindows().forEach((win: BrowserWindow) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SYNC_STATE_PUSH, syncState)
      }
    })
  })

  ipcMain.handle(IPC.SYNC_GET_STATE, () => getSyncState())

  ipcMain.handle(IPC.SYNC_RUN_NOW, async (e) => {
    requireRole(e, 'admin')
    await runSync()
    return getSyncState()
  })

  ipcMain.handle(IPC.SYNC_FORCE_FULL, async (e) => {
    requireRole(e, 'admin')
    await forceFullSync()
    return getSyncState()
  })

  ipcMain.handle(IPC.SYNC_TEST_CONNECTION, async (_e, url: string, apiKey: string) => {
    // Prefer a key the caller just typed in (e.g. the setup wizard, before it's
    // saved) — fall back to whatever is already stored (e.g. Settings → Sync,
    // re-testing an existing connection without re-entering the key).
    const key = apiKey?.trim() || settingsService.get('syncApiKey')?.trim() || ''
    return testConnection(url, key)
  })

  ipcMain.handle(IPC.SYNC_START, (e, intervalSeconds?: number) => {
    requireRole(e, 'admin')
    // Server machines must never run the sync client
    if (settingsService.get('nodeMode') === 'server') {
      return getSyncState()
    }
    startSyncLoop(intervalSeconds)
    return getSyncState()
  })

  ipcMain.handle(IPC.SYNC_STOP, (e) => {
    requireRole(e, 'admin')
    stopSyncLoop()
    return getSyncState()
  })

  // ── Multi-terminal sync v2 ──────────────────────────────────────────────────

  // Push v2 state changes to all renderer windows
  onSyncV2StateChange((v2State) => {
    BrowserWindow.getAllWindows().forEach((win: BrowserWindow) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SYNC_V2_STATE_PUSH, v2State)
      }
    })
    return undefined
  })

  ipcMain.handle(IPC.SYNC_V2_GET_STATE, () => getSyncV2State())

  ipcMain.handle(IPC.SYNC_V2_RUN_NOW, async (e) => {
    requireRole(e, 'admin')
    await runSyncV2()
    return getSyncV2State()
  })

  ipcMain.handle(IPC.SYNC_V2_FORCE_FULL, async (e) => {
    requireRole(e, 'admin')
    await forceFullSyncV2()
    return getSyncV2State()
  })

  ipcMain.handle(IPC.SYNC_V2_START, (e, intervalSeconds?: number) => {
    requireRole(e, 'admin')
    if (settingsService.get('nodeMode') === 'server') return getSyncV2State()
    startSyncV2Loop(intervalSeconds)
    return getSyncV2State()
  })

  ipcMain.handle(IPC.SYNC_V2_STOP, (e) => {
    requireRole(e, 'admin')
    stopSyncV2Loop()
    return getSyncV2State()
  })

  // ── Cloud sync (hub → Kinetix Cloud) ───────────────────────────────────────

  onCloudSyncStateChange((cloudState) => {
    BrowserWindow.getAllWindows().forEach((win: BrowserWindow) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.CLOUD_SYNC_STATE_PUSH, cloudState)
    })
    return undefined
  })

  ipcMain.handle(IPC.CLOUD_SYNC_GET_STATE, () => getCloudSyncState())

  ipcMain.handle(IPC.CLOUD_SYNC_RUN_NOW, async (e) => {
    requireRole(e, 'admin')
    await runCloudSync()
    return getCloudSyncState()
  })

  ipcMain.handle(IPC.CLOUD_SYNC_FORCE_FULL, async (e) => {
    requireRole(e, 'admin')
    await forceFullCloudSync()
    return getCloudSyncState()
  })

  /**
   * Activate a license key against the cloud backend.
   * Stores the returned storeId + cloudApiKey in settings and starts the sync loop.
   */
  ipcMain.handle(IPC.CLOUD_SYNC_REGISTER, async (e, { licenseKey, cloudSyncUrl }: { licenseKey: string; cloudSyncUrl: string }) => {
    requireRole(e, 'admin')
    try {
      const res = await fetch(`${cloudSyncUrl.trim().replace(/\/$/, '')}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey }),
      })
      const json = await res.json() as { ok?: boolean; storeId?: string; syncApiKey?: string; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Registration failed (${res.status})`)

      // Persist credentials
      settingsService.set('storeId', json.storeId!)
      settingsService.set('cloudApiKey', json.syncApiKey!)
      settingsService.set('cloudSyncUrl', cloudSyncUrl.trim().replace(/\/$/, ''))
      settingsService.set('cloudSyncEnabled', 'true')

      // Start the cloud sync loop now that we have credentials
      const intervalSec = parseInt(settingsService.get('cloudSyncIntervalSeconds') || '300', 10)
      startCloudSyncLoop(intervalSec)

      return { ok: true, storeId: json.storeId }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ── Setup wizard + embedded server ──────────────────────────────────────────

  /** Returns the current setup state for the wizard to read on mount.
   * SECURITY: API keys are never returned to the renderer — only boolean flags
   * indicating whether a key has been configured are exposed. */
  ipcMain.handle(IPC.SETUP_GET, () => ({
    setupComplete: settingsService.get('setupComplete'),
    nodeMode: settingsService.get('nodeMode'),
    embeddedServerPort: settingsService.get('embeddedServerPort'),
    embeddedServerApiKeySet: !!settingsService.get('embeddedServerApiKey'),
    terminalId: settingsService.get('terminalId'),
    syncUrl: settingsService.get('syncUrl'),
    syncApiKeySet: !!settingsService.get('syncApiKey')
  }))

  /**
   * Called when the user finishes the setup wizard.
   * Persists settings, then auto-starts sync / embedded server as appropriate.
   *
   * Auth strategy:
   *  - First run  (setupComplete !== 'true'): no user exists yet — skip auth check.
   *  - Re-run from Settings (setupComplete === 'true'): enforce admin role.
   */
  ipcMain.handle(IPC.SETUP_COMPLETE, async (e, input: {
    nodeMode: 'standalone' | 'server' | 'terminal'
    embeddedServerPort?: number
    embeddedServerApiKey?: string
    syncUrl?: string
    syncApiKey?: string
    syncIntervalSeconds?: number
  }) => {
    const alreadySetUp = settingsService.get('setupComplete') === 'true'
    if (alreadySetUp) {
      requireRole(e, 'admin')
    }
    const now = new Date().toISOString()
    const save = (key: string, value: string) =>
      settingsService.set(key, value)

    save('nodeMode', input.nodeMode)
    save('setupComplete', 'true')

    let generatedApiKey: string | undefined

    if (input.nodeMode === 'standalone') {
      save('syncEnabled', 'false')

    } else if (input.nodeMode === 'server') {
      const port = input.embeddedServerPort ?? 3030
      const apiKey = input.embeddedServerApiKey ?? ''
      save('embeddedServerPort', String(port))
      save('embeddedServerApiKey', apiKey)
      // Server hosts data — it does NOT sync to itself.
      // Clear any stale terminal-sync settings so initSync() stays disabled.
      save('syncEnabled', 'false')
      save('syncUrl', '')
      save('syncApiKey', '')
      await startEmbeddedServer(port, apiKey)
      // No sync loop — terminals push/pull TO this server

      // startEmbeddedServer auto-generates a key when apiKey is blank. Surface
      // it once here so the wizard can show it to the admin to copy to other
      // terminals — SETUP_GET intentionally never exposes stored keys later.
      if (!apiKey) {
        generatedApiKey = settingsService.get('embeddedServerApiKey') || undefined
      }

    } else if (input.nodeMode === 'terminal') {
      save('syncEnabled', 'true')
      save('syncUrl', input.syncUrl ?? '')
      save('syncApiKey', input.syncApiKey ?? '')
      save('syncIntervalSeconds', String(input.syncIntervalSeconds ?? 30))
      startSyncLoop(input.syncIntervalSeconds ?? 30)
    }

    return { ok: true, serverTime: now, ...(generatedApiKey && { generatedApiKey }) }
  })

  /** Resets setupComplete so the wizard shows again on next launch. */
  ipcMain.handle(IPC.SETUP_RESET, (e) => {
    requireRole(e, 'admin')
    settingsService.set('setupComplete', 'false')
    return { ok: true }
  })

  ipcMain.handle(IPC.EMBEDDED_SERVER_START, async (e, port: number, apiKey: string) => {
    requireRole(e, 'admin')
    return startEmbeddedServer(port, apiKey)
  })

  ipcMain.handle(IPC.EMBEDDED_SERVER_STOP, async (e) => {
    requireRole(e, 'admin')
    await stopEmbeddedServer()
    return { running: false }
  })

  ipcMain.handle(IPC.EMBEDDED_SERVER_STATUS, () => getEmbeddedServerStatus())

  // Admin web dashboard

  /**
   * Scan the local subnet for running Kinetix POS server nodes.
   *
   * Strategy: find the first non-loopback IPv4 address, derive the /24 subnet,
   * then race HTTP probes to each host:port combination in parallel with a short
   * timeout. Returns an array of discovered server base URLs.
   *
   * Common ports checked: the configured embeddedServerPort plus 3030–3035
   * so we find servers even if they run on a non-default port.
   */
  ipcMain.handle(IPC.SYNC_DISCOVER, async (): Promise<string[]> => {
    const { get } = await import('http')

    // 1. Find our best LAN IP to determine the subnet (skips Docker/WSL adapters)
    const localIp = getLanIp()
    if (localIp === '127.0.0.1') return []

    // 2. Build the /24 host list (exclude .0 and .255)
    const parts = localIp.split('.')
    const prefix = parts.slice(0, 3).join('.')
    const ownLast = parseInt(parts[3], 10)

    // Ports to probe — configured port + the default range
    const configuredPort = parseInt(settingsService.get('embeddedServerPort') || '3030', 10)
    const ports = [...new Set([configuredPort, 3030, 3031, 3032])]

    /**
     * Probe a single host:port. Resolves to the URL string if a Kinetix POS
     * server is detected, or null if not reachable within the timeout.
     */
    function probe(host: string, port: number): Promise<string | null> {
      return new Promise((resolve) => {
        const url = `http://${host}:${port}/sync/status`
        const req = get(url, { timeout: 400 }, (res) => {
          // Any 2xx from /sync/status is good enough — collect body to confirm
          let body = ''
          res.on('data', (chunk: Buffer) => { body += chunk.toString() })
          res.on('end', () => {
            try {
              const json = JSON.parse(body) as Record<string, unknown>
              // Kinetix POS servers return { ok: true, mode: 'server' }
              if (json.ok === true) {
                resolve(`http://${host}:${port}`)
              } else {
                resolve(null)
              }
            } catch {
              resolve(null)
            }
          })
        })
        req.on('error', () => resolve(null))
        req.on('timeout', () => { req.destroy(); resolve(null) })
      })
    }

    // 3. Build all probes — skip our own IP to avoid discovering ourselves
    const probes: Promise<string | null>[] = []
    for (let last = 1; last <= 254; last++) {
      if (last === ownLast) continue
      const host = `${prefix}.${last}`
      for (const port of ports) {
        probes.push(probe(host, port))
      }
    }

    const results = await Promise.all(probes)
    return [...new Set(results.filter((r): r is string => r !== null))]
  })

  // ── File-based sync (terminal side) ──────────────────────────────────────

  ipcMain.handle(IPC.FILE_SYNC_GET_STATE, () => getFileSyncState())

  ipcMain.handle(IPC.FILE_SYNC_RUN_NOW, async () => {
    const sharePath = settingsService.get('syncSharePath')?.trim() ?? ''
    if (!sharePath) return { ok: false, error: 'No share path configured' }
    await runFileSync(sharePath)
    return { ok: true }
  })

  ipcMain.handle(IPC.FILE_SYNC_START, (_e, intervalSeconds?: number) => {
    const sharePath = settingsService.get('syncSharePath')?.trim() ?? ''
    if (!sharePath) return { ok: false, error: 'No share path configured' }
    startFileSyncLoop(sharePath, intervalSeconds ?? 30)
    return { ok: true }
  })

  ipcMain.handle(IPC.FILE_SYNC_STOP, () => {
    stopFileSyncLoop()
    return { ok: true }
  })

  ipcMain.handle(IPC.FILE_SYNC_TEST_PATH, (_e, sharePath: string) =>
    testSharePath(sharePath)
  )

  ipcMain.handle(IPC.FILE_SYNC_GET_LOCAL_SHARE_PATH, () =>
    getDefaultLocalSharePath(app.getPath('userData'))
  )

  // Staff — get single member by ID
  ipcMain.handle(IPC.STAFF_GET, (_e, id: string) => staffService.get(id))

}
