/**
 * QuickBooks Online sync service.
 *
 * OAuth2 flow:
 *   1. Call getAuthUrl() to build the authorization URL.
 *   2. Open the URL in the user's browser (main process uses shell.openExternal).
 *   3. Start a local HTTP server on CALLBACK_PORT to receive the redirect.
 *   4. Call exchangeCode(code, realmId) to swap the auth code for tokens.
 *   5. Tokens are stored in the settings table and refreshed automatically.
 *
 * Sandbox vs production is toggled via the 'qboSandbox' setting.
 */

import https from 'https'
import http from 'http'
import crypto from 'crypto'
import { URL } from 'url'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { eq, and, gte } from 'drizzle-orm'

// ─── Constants ────────────────────────────────────────────────────────────────

const CALLBACK_PORT = 8085
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/qbo-callback`
const AUTH_ENDPOINT = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const PROD_BASE = 'https://quickbooks.api.intuit.com'
const SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QboStatus {
  connected: boolean
  companyName: string | null
  realmId: string | null
  sandbox: boolean
  lastSyncAt: string | null
}

export interface QboSyncResult {
  synced: number
  failed: number
  errors: string[]
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getSetting(key: string): string | null {
  const db = getDatabase()
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()
  return row?.value ?? null
}

function setSetting(key: string, value: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.insert(schema.settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } })
    .run()
}

function getBaseUrl(): string {
  return getSetting('qboSandbox') === 'true' ? SANDBOX_BASE : PROD_BASE
}

function isTokenExpired(): boolean {
  const expiry = getSetting('qboTokenExpiry')
  if (!expiry) return true
  // Treat as expired 5 minutes early to avoid edge-case failures
  return Date.now() >= new Date(expiry).getTime() - 5 * 60 * 1000
}

/**
 * Make a JSON request using the built-in https module to avoid
 * bundling dependencies.
 */
function httpsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {})
      }
    }

    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode ?? 0, data: raw }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function refreshAccessToken(): Promise<void> {
  const clientId = getSetting('qboClientId')
  const clientSecret = getSetting('qboClientSecret')
  const refreshToken = getSetting('qboRefreshToken')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('QBO credentials not configured')
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`

  const resp = await new Promise<{ status: number; data: Record<string, string> }>((resolve, reject) => {
    const parsed = new URL(TOKEN_ENDPOINT)
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body).toString()
      }
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }) }
        catch { reject(new Error(`Token refresh failed: ${raw}`)) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })

  if (resp.status !== 200 || !resp.data.access_token) {
    throw new Error(`QBO token refresh failed: ${JSON.stringify(resp.data)}`)
  }

  const expiry = new Date(Date.now() + parseInt(resp.data.expires_in ?? '3600', 10) * 1000)
  setSetting('qboAccessToken', resp.data.access_token)
  if (resp.data.refresh_token) setSetting('qboRefreshToken', resp.data.refresh_token)
  setSetting('qboTokenExpiry', expiry.toISOString())
}

async function getValidToken(): Promise<string> {
  if (isTokenExpired()) await refreshAccessToken()
  const token = getSetting('qboAccessToken')
  if (!token) throw new Error('No QBO access token')
  return token
}

async function qboPost(path: string, body: unknown): Promise<unknown> {
  const token = await getValidToken()
  const realmId = getSetting('qboRealmId')
  if (!realmId) throw new Error('QBO not connected (no realmId)')
  const url = `${getBaseUrl()}/v3/company/${realmId}${path}?minorversion=65`
  const resp = await httpsRequest('POST', url, { Authorization: `Bearer ${token}` }, JSON.stringify(body))
  if (resp.status >= 400) throw new Error(`QBO API error ${resp.status}: ${JSON.stringify(resp.data)}`)
  return resp.data
}

// ─── OAuth callback server (one-shot) ────────────────────────────────────────

let callbackServer: http.Server | null = null

/**
 * Stores the CSRF state token generated during startAuth().
 * The callback server verifies the returned state matches before processing.
 */
let pendingOAuthState: string | null = null

function startCallbackServer(
  onCode: (code: string, realmId: string, state: string) => void,
  onError: (err: string) => void
): void {
  if (callbackServer) { callbackServer.close(); callbackServer = null }

  callbackServer = http.createServer((req, res) => {
    if (!req.url?.startsWith('/qbo-callback')) { res.end(); return }

    const params = new URL(`http://localhost${req.url}`).searchParams
    const code = params.get('code')
    const realmId = params.get('realmId')
    const state = params.get('state')
    const error = params.get('error')

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2 style="color:${error ? 'red' : 'green'}">${error ? 'Connection failed' : 'Connected to QuickBooks!'}</h2>
        <p>${error ? error : 'You may close this tab and return to the POS.'}</p>
      </body></html>
    `)

    callbackServer?.close()
    callbackServer = null

    if (error || !code || !realmId) {
      onError(error ?? 'Missing code or realmId')
    } else {
      onCode(code, realmId, state ?? '')
    }
  })

  callbackServer.listen(CALLBACK_PORT)
}

// ─── Public service ───────────────────────────────────────────────────────────

export const qboService = {
  /** Get current connection status */
  getStatus(): QboStatus {
    return {
      connected: !!getSetting('qboAccessToken') && !!getSetting('qboRealmId'),
      companyName: getSetting('qboCompanyName'),
      realmId: getSetting('qboRealmId'),
      sandbox: getSetting('qboSandbox') === 'true',
      lastSyncAt: getSetting('qboLastSyncAt')
    }
  },

  /**
   * Build the QBO OAuth authorization URL and start the local callback server.
   * Returns the URL to open in the browser, plus a promise that resolves when
   * the user completes (or cancels) authorization.
   */
  startAuth(): {
    authUrl: string
    completion: Promise<{ success: boolean; companyName?: string; error?: string }>
  } {
    const clientId = getSetting('qboClientId')
    if (!clientId) throw new Error('QBO Client ID not configured in settings')

    const state = crypto.randomBytes(16).toString('hex')
    pendingOAuthState = state
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: 'com.intuit.quickbooks.accounting',
      response_type: 'code',
      state,
      access_type: 'offline'
    })
    const authUrl = `${AUTH_ENDPOINT}?${params}`

    const completion = new Promise<{ success: boolean; companyName?: string; error?: string }>(
      (resolve) => {
        startCallbackServer(
          async (code, realmId, returnedState) => {
            // Verify state to prevent CSRF attacks
            if (!pendingOAuthState || returnedState !== pendingOAuthState) {
              pendingOAuthState = null
              resolve({ success: false, error: 'OAuth state mismatch — possible CSRF attack' })
              return
            }
            pendingOAuthState = null
            try {
              await this.exchangeCode(code, realmId)
              const name = getSetting('qboCompanyName') ?? 'QuickBooks Company'
              resolve({ success: true, companyName: name })
            } catch (err) {
              resolve({ success: false, error: String(err) })
            }
          },
          (err) => { pendingOAuthState = null; resolve({ success: false, error: err }) }
        )
      }
    )

    return { authUrl, completion }
  },

  /** Exchange OAuth code for tokens and store them */
  async exchangeCode(code: string, realmId: string): Promise<void> {
    const clientId = getSetting('qboClientId')
    const clientSecret = getSetting('qboClientSecret')
    if (!clientId || !clientSecret) throw new Error('QBO credentials not configured')

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const body = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`

    const resp = await new Promise<{ status: number; data: Record<string, string> }>((resolve, reject) => {
      const parsed = new URL(TOKEN_ENDPOINT)
      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(body).toString()
        }
      }
      const req = https.request(options, (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }) }
          catch { reject(new Error(`Exchange failed: ${raw}`)) }
        })
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    if (resp.status !== 200 || !resp.data.access_token) {
      throw new Error(`QBO code exchange failed (${resp.status}): ${JSON.stringify(resp.data)}`)
    }

    const expiry = new Date(Date.now() + parseInt(resp.data.expires_in ?? '3600', 10) * 1000)
    setSetting('qboRealmId', realmId)
    setSetting('qboAccessToken', resp.data.access_token)
    setSetting('qboRefreshToken', resp.data.refresh_token ?? '')
    setSetting('qboTokenExpiry', expiry.toISOString())

    // Fetch company name
    try {
      const token = resp.data.access_token
      const infoResp = await httpsRequest(
        'GET',
        `${getBaseUrl()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`,
        { Authorization: `Bearer ${token}` }
      )
      const companyName =
        (infoResp.data as Record<string, Record<string, string>>)
          ?.CompanyInfo?.CompanyName ?? 'QuickBooks Company'
      setSetting('qboCompanyName', companyName)
    } catch {
      setSetting('qboCompanyName', 'QuickBooks Company')
    }
  },

  /** Disconnect and clear all stored tokens */
  disconnect(): void {
    pendingOAuthState = null
    for (const key of ['qboAccessToken', 'qboRefreshToken', 'qboTokenExpiry', 'qboRealmId', 'qboCompanyName', 'qboLastSyncAt']) {
      setSetting(key, '')
    }
  },

  /**
   * Sync all completed orders since the last sync to QBO as Sales Receipts.
   * Also syncs any new customers referenced by those orders.
   */
  async syncSales(): Promise<QboSyncResult> {
    const db = getDatabase()
    const result: QboSyncResult = { synced: 0, failed: 0, errors: [] }
    const lastSync = getSetting('qboLastSyncAt') ?? '1970-01-01T00:00:00.000Z'

    const orders = db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.status, 'completed'), gte(schema.orders.updatedAt, lastSync)))
      .all()

    for (const order of orders) {
      try {
        const items = db
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, order.id))
          .all()

        const payments = db
          .select()
          .from(schema.payments)
          .where(eq(schema.payments.orderId, order.id))
          .all()

        // Build QBO Sales Receipt payload (minimal, uses non-posting accounts)
        const lines = items.map((item, idx) => ({
          Id: String(idx + 1),
          LineNum: idx + 1,
          Description: `${item.productName}${item.variantName ? ` (${item.variantName})` : ''}`,
          Amount: item.lineTotal,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: {
            Qty: item.quantity,
            UnitPrice: item.unitPrice
          }
        }))

        const paymentMethod = payments[0]?.method ?? 'cash'
        const methodLabel = paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Credit Card' : 'Other'

        const receipt = {
          DocNumber: order.orderNumber,
          TxnDate: order.createdAt.split('T')[0],
          PrivateNote: order.notes ?? `POS sale via ${methodLabel}`,
          Line: lines,
          ...(order.total !== order.subtotal - order.discountAmount + order.taxAmount ? {} : {}),
          TotalAmt: order.total
        }

        await qboPost('/salesreceipt', { SalesReceipt: receipt })
        result.synced++
      } catch (err) {
        result.failed++
        result.errors.push(`Order ${order.orderNumber}: ${String(err)}`)
      }
    }

    setSetting('qboLastSyncAt', new Date().toISOString())
    return result
  },

  /**
   * Sync customer records to QBO.
   */
  async syncCustomers(): Promise<QboSyncResult> {
    const db = getDatabase()
    const result: QboSyncResult = { synced: 0, failed: 0, errors: [] }

    const customers = db.select().from(schema.customers).all()

    for (const customer of customers) {
      try {
        await qboPost('/customer', {
          Customer: {
            DisplayName: `${customer.firstName} ${customer.lastName}`,
            GivenName: customer.firstName,
            FamilyName: customer.lastName,
            PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
            PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
            Notes: customer.notes ?? undefined
          }
        })
        result.synced++
      } catch (err) {
        result.failed++
        result.errors.push(`Customer ${customer.firstName} ${customer.lastName}: ${String(err)}`)
      }
    }

    return result
  }
}
