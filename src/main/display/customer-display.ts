import { BrowserWindow, screen } from 'electron'
import { sendReceiptEmail, sendInvoiceEmail } from '../services/email.service'
import { join } from 'path'
import * as http from 'http'
import { is } from '@electron-toolkit/utils'
import { getLanIp } from '../lib/network'

// ─── Types ────────────────────────────────────────────────────────────────────

import type { DisplayData } from '../../shared/display-types'
export type { DisplayData, DisplayItem } from '../../shared/display-types'

// ─── Module-level singletons ──────────────────────────────────────────────────

let displayWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let httpServer: http.Server | null = null
let lastData: DisplayData = { state: 'idle', storeName: 'POS System' }
const sseClients = new Set<http.ServerResponse>()

/** Cached logo base64 — attached to every pushData call so all clients render it. */
let cachedLogo = ''

/**
 * Register the main renderer window so the HTTP server can PULL the current
 * cart state via executeJavaScript.  Call this once from index.ts after the
 * main window is created.
 *
 * The pull runs every 800 ms and is the reliable fallback when the IPC push
 * from DisplaySyncBridge fails for any reason.
 */
export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!isHttpServerRunning()) return          // don't bother when server is off
    try {
      const json = await mainWindow.webContents.executeJavaScript(
        'typeof window.__getDisplayData === "function" ? window.__getDisplayData() : null'
      ) as string | null
      if (json) pushData(JSON.parse(json))
    } catch {
      /* renderer not ready — ignore */
    }
  }, 800)
}

/**
 * Set the store logo. Call whenever the logo is uploaded or a display surface opens.
 * The logo will be included in all future pushData calls automatically.
 */
export function setDisplayLogo(logoBase64: string): void {
  cachedLogo = logoBase64 ?? ''
}

/**
 * Return the last-pushed display state. Used by the customer-display renderer
 * to hydrate on mount (solves the timing race where pushData fires before
 * the React useEffect has a chance to register the ipcRenderer listener).
 */
export function getLastData(): DisplayData {
  return lastData
}

/**
 * Immediately pulls the current cart state from the renderer via
 * executeJavaScript and calls pushData so lastData (and all SSE clients)
 * receive a fresh snapshot.  Call this when the HTTP server starts and
 * whenever a new SSE client connects to avoid stale idle state.
 */
export async function forcePushCurrentState(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const json = await mainWindow.webContents.executeJavaScript(
      'typeof window.__getDisplayData === "function" ? window.__getDisplayData() : null'
    ) as string | null
    if (json) pushData(JSON.parse(json))
  } catch {
    /* renderer not ready — ignore */
  }
}

// ─── Electron second-screen window ───────────────────────────────────────────

/**
 * Opens (or focuses) the customer-facing Electron window.
 * Prefers the secondary display; falls back to primary.
 */
export function openDisplayWindow(): void {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.focus()
    return
  }

  const allDisplays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  const secondary = allDisplays.find((d) => d.id !== primaryId)
  const target = secondary ?? screen.getPrimaryDisplay()
  const bounds = target.bounds

  displayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fullscreen: !!secondary,   // go fullscreen only on a real second screen
    frame: false,
    alwaysOnTop: false,
    title: 'Customer Display',
    webPreferences: {
      // electron-vite bundles main into out/main/index.js so __dirname = out/main/
      // Preload is at out/preload/index.js → one level up, not two
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Load the same renderer bundle but at the /customer-display route
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    displayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/customer-display`)
  } else {
    // Renderer HTML is at out/renderer/index.html → one level up from out/main/
    displayWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: '/customer-display'
    })
  }

  displayWindow.on('closed', () => {
    displayWindow = null
  })

  // Push current state once the window is ready
  displayWindow.webContents.once('did-finish-load', () => {
    pushData(lastData)
  })
}

/** Closes the customer-facing Electron window. */
export function closeDisplayWindow(): void {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.close()
  }
  displayWindow = null
}

/** Returns true if the second-screen Electron window is currently open. */
export function isDisplayWindowOpen(): boolean {
  return !!displayWindow && !displayWindow.isDestroyed()
}

// ─── Network display (HTTP + SSE) ────────────────────────────────────────────

/**
 * Starts the HTTP server that serves:
 *   GET /          → self-contained HTML page (for iPad / price pole)
 *   GET /state     → current state as JSON snapshot
 *   GET /events    → Server-Sent Events stream
 */
export function startHttpServer(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (httpServer?.listening) {
      resolve()
      return
    }

    httpServer = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', `http://localhost`).pathname

      // CORS — allow any device on the same network
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET')

      if (pathname === '/events') {
        handleSseRequest(req, res)
        return
      }

      if (pathname === '/state') {
        // Serve cached lastData synchronously — no async, no hanging requests.
        // The 800ms pull loop in setMainWindow() keeps lastData fresh independently.
        // logoBase64 is stripped so iOS Safari doesn't choke on a 200KB payload every 800ms.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { logoBase64: _logo, ...stateForPoll } = lastData as unknown as Record<string, unknown>
        const body = JSON.stringify(stateForPoll)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache'
        })
        res.end(body)
        return
      }

      if (pathname === '/view') {
        // Returns a pre-rendered HTML fragment of the current display state.
        // The client sets innerHTML directly — no client-side JSON parsing or render logic.
        const frag = renderFragment(lastData)
        const body = frag
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache'
        })
        res.end(body)
        return
      }

      if (pathname === '/logo') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          // Allow a short cache so repeated page loads don't re-fetch unnecessarily,
          // but still revalidate after 60 s in case the logo changes.
          'Cache-Control': 'max-age=60'
        })
        res.end(JSON.stringify({ logoBase64: cachedLogo }))
        return
      }

      // Debug endpoint — visit http://<ip>:<port>/debug to diagnose display issues.
      if (pathname === '/debug') {
        ;(async () => {
          let liveRendererState: string | null = null
          let rendererError: string | null = null
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              liveRendererState = await mainWindow.webContents.executeJavaScript(
                'typeof window.__getDisplayData === "function" ? window.__getDisplayData() : "__getDisplayData_not_set"'
              ) as string
            }
          } catch (e) {
            rendererError = String(e)
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          })
          res.end(JSON.stringify({
            lastDataState: lastData.state,
            lastDataItemCount: lastData.items?.length ?? 0,
            lastDataHasLogo: !!lastData.logoBase64,
            liveRendererState,
            rendererError,
            sseClientCount: sseClients.size,
            hasMainWindow: !!mainWindow && !mainWindow.isDestroyed(),
            timestamp: new Date().toISOString()
          }, null, 2))
        })()
        return
      }

      // Customer email submission from the network display page
      if (pathname === '/send-email' && req.method === 'POST') {
        handleEmailPost(req, res)
        return
      }

      // Default: self-contained display page
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache'
      })
      res.end(getDisplayHtml())
    })

    httpServer.on('error', reject)
    httpServer.listen(port, '0.0.0.0', () => resolve())
  })
}

/** Stops the HTTP server and disconnects all SSE clients. */
export function stopHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!httpServer) {
      resolve()
      return
    }

    for (const client of sseClients) {
      try { client.end() } catch { /* ignore already-closed */ }
    }
    sseClients.clear()

    httpServer.close(() => {
      httpServer = null
      resolve()
    })
  })
}

/** Returns true if the HTTP network server is currently listening. */
export function isHttpServerRunning(): boolean {
  return !!httpServer?.listening
}

/** Returns the first non-loopback IPv4 address of this machine. */
export function getLocalIp(): string {
  return getLanIp()
}

// ─── Data push ───────────────────────────────────────────────────────────────

/**
 * Pushes display data to every connected surface:
 *   • Electron second-screen window (via webContents.send)
 *   • All active SSE clients
 *
 * Also caches the data so late subscribers receive it immediately.
 */
export function pushData(data: DisplayData): void {
  // Attach cached logo so every client (Electron + network) can display it without a separate request
  const enriched: DisplayData = cachedLogo ? { ...data, logoBase64: cachedLogo } : data
  lastData = enriched
  console.log('[display] pushData state=%s items=%d sse=%d', data.state, data.items?.length ?? 0, sseClients.size)

  // Electron window
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.webContents.send('display:push', enriched)
  }

  // Network SSE clients
  const payload = `data: ${JSON.stringify(enriched)}\n\n`
  const dead: http.ServerResponse[] = []
  for (const client of sseClients) {
    try {
      client.write(payload)
    } catch {
      dead.push(client)
    }
  }
  for (const d of dead) sseClients.delete(d)
}

// ─── Internals ────────────────────────────────────────────────────────────────

const EMAIL_BODY_LIMIT = 10 * 1024 // 10 KB — email address + type field; no reason to be larger
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function handleEmailPost(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = ''
  let bodySize = 0
  req.on('data', (chunk: Buffer) => {
    bodySize += chunk.length
    if (bodySize > EMAIL_BODY_LIMIT) {
      req.destroy()
      return
    }
    body += chunk.toString()
  })
  req.on('end', async () => {
    try {
      const { to, type } = JSON.parse(body) as { to: string; type: 'receipt' | 'invoice' }
      if (!to || !EMAIL_RE.test(to)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'Invalid email address' }))
        return
      }
      if (!lastData.completedReceiptHtml || !lastData.orderNumber) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'No completed order available' }))
        return
      }
      const result = type === 'invoice'
        ? await sendInvoiceEmail(to, lastData.completedReceiptHtml, lastData.orderNumber)
        : await sendReceiptEmail(to, lastData.completedReceiptHtml, lastData.orderNumber)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: String(err) }))
    }
  })
}

function handleSseRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Disable Nagle's algorithm so each write() is delivered immediately without
  // waiting for the TCP buffer to fill — this is what makes SSE feel real-time.
  const socket = (res as unknown as { socket?: { setNoDelay?: (v: boolean) => void } }).socket
  socket?.setNoDelay?.(true)

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',   // disable Nginx proxy buffering if present
    'X-Content-Type-Options': 'nosniff'
  })
  // Flush the headers to the client immediately (important for some proxy setups)
  res.flushHeaders()

  // Send current state immediately so the page isn't blank on connect
  res.write(`data: ${JSON.stringify(lastData)}\n\n`)

  // Keep-alive heartbeat every 15 s (prevents proxies from closing the connection)
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n') } catch { /* client gone */ }
  }, 15_000)

  sseClients.add(res)

  // Immediately refresh state from the renderer so this client gets real data
  // rather than whatever lastData happened to be when it connected.
  forcePushCurrentState().catch(() => { /* renderer not ready — ignore */ })

  req.on('close', () => {
    clearInterval(heartbeat)
    sseClients.delete(res)
  })
}

// ─── Self-contained network display HTML ─────────────────────────────────────

/** Returns a single-file HTML page that connects to /events and renders the display. */
// ─── Server-side HTML fragment renderer ──────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmt(amount: unknown, symbol = '$'): string {
  return symbol + Number(amount ?? 0).toFixed(2)
}

/**
 * Renders the current display state as a self-contained HTML fragment.
 * The client sets main-area innerHTML directly — zero client-side render logic.
 */
function renderFragment(data: DisplayData): string {
  const sym = data.symbol ?? '$'

  if (!data || data.state === 'idle') {
    return `<div class="idle-icon">🛍️</div><div class="idle-title">Welcome!</div><div class="idle-sub">Please place your items on the counter</div>`
  }

  if (data.state === 'shopping') {
    const items = data.items ?? []
    const itemRows = items.map(item =>
      `<div class="item-row"><div class="item-name">${esc(item.name)}</div><div class="item-qty">× ${item.quantity}</div><div class="item-price">${fmt(item.lineTotal, sym)}</div></div>`
    ).join('')
    const discountRow = (data.discountAmount ?? 0) > 0
      ? `<div class="totals-row discount"><span>Discount</span><span>-${fmt(data.discountAmount, sym)}</span></div>` : ''
    const taxRow = (data.tax ?? 0) > 0
      ? `<div class="totals-row"><span>Tax</span><span>${fmt(data.tax, sym)}</span></div>` : ''
    const altRow = data.altTotal != null && data.altCurrency
      ? `<div class="totals-row alt"><span>≈ ${esc(data.altCurrency)}</span><span>${fmt(data.altTotal, data.altSymbol)}</span></div>` : ''
    const greeting = data.customer
      ? `<div class="customer-greeting">Welcome back, ${esc(data.customer)}! 👋</div>` : ''
    return `<div class="shopping-layout">${greeting}
      <div class="items-list">${itemRows || '<div style="padding:24px;text-align:center;color:var(--muted)">No items yet</div>'}</div>
      <div class="totals">
        <div class="totals-row"><span>Subtotal</span><span>${fmt(data.subtotal, sym)}</span></div>
        ${discountRow}${taxRow}
        <div class="totals-row total"><span>Total</span><span>${fmt(data.total, sym)}</span></div>
        ${altRow}
      </div></div>`
  }

  if (data.state === 'payment_processing') {
    return `<div class="payment-layout"><div class="spinner"></div><div style="font-size:32px;font-weight:700">Processing Payment</div><div class="payment-amount">${fmt(data.total, sym)}</div><div style="color:var(--muted);font-size:18px">Please follow the terminal prompts</div></div>`
  }

  if (data.state === 'complete') {
    const sym3 = data.changeSymbol ?? '$'
    const changeRow = (data.change ?? 0) > 0 ? `<div class="complete-change">Change: <strong>${fmt(data.change, sym3)}</strong></div>` : ''
    const loyaltyRow = (data.loyaltyEarned ?? 0) > 0 ? `<div class="loyalty-badge">🎁 +${data.loyaltyEarned} loyalty points earned!</div>` : ''
    const emailPanel = (data.completedReceiptHtml && data.orderNumber)
      ? `<div class="email-panel" id="email-panel">
          <div class="email-label">Get your receipt by email</div>
          <div class="email-type-toggle">
            <button class="email-type-btn active" id="btn-receipt" onclick="setEmailType('receipt')">Receipt</button>
            <button class="email-type-btn" id="btn-invoice" onclick="setEmailType('invoice')">Invoice</button>
          </div>
          <div class="email-row">
            <input id="email-input" class="email-input" type="email" placeholder="your@email.com" autocomplete="email"
              onkeydown="if(event.key==='Enter')submitEmail()"/>
            <button id="email-send" class="email-send-btn" onclick="submitEmail()">Send</button>
          </div>
          <div id="email-feedback" class="email-feedback"></div>
        </div>` : ''
    return `<div class="complete-layout"><div class="complete-check">✓</div><div class="complete-title">Thank You!</div>${changeRow}${loyaltyRow}${emailPanel}</div>`
  }

  return `<div class="idle-icon">🛍️</div><div class="idle-title">Welcome!</div><div class="idle-sub">Please place your items on the counter</div>`
}

function getDisplayHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Customer Display</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f172a; --surface: #1e293b; --border: #334155;
    --accent: #3b82f6; --accent-light: #60a5fa; --green: #10b981;
    --text: #f8fafc; --muted: #94a3b8; --radius: 12px;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; user-select: none; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 16px 28px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 16px; }
  .header-logo-img { height: 44px; max-width: 160px; object-fit: contain; }
  .header-name { font-size: 22px; font-weight: 800; color: var(--accent-light); letter-spacing: -0.5px; }
  .header-time { font-size: 16px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 48px; overflow: hidden; }
  .idle-icon { font-size: 72px; margin-bottom: 20px; opacity: 0.3; }
  .idle-title { font-size: 36px; font-weight: 700; color: var(--muted); text-align: center; }
  .idle-sub { font-size: 18px; color: var(--border); margin-top: 8px; text-align: center; }
  .shopping-layout { width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 20px; height: 100%; }
  .customer-greeting { font-size: 18px; color: var(--accent-light); font-weight: 600; text-align: center; }
  .items-list { flex: 1; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 0; }
  .item-row { display: flex; align-items: center; padding: 12px 20px; gap: 12px; border-bottom: 1px solid var(--border); }
  .item-row:last-child { border-bottom: none; }
  .item-name { flex: 1; font-size: 17px; font-weight: 500; }
  .item-qty { font-size: 15px; color: var(--muted); min-width: 40px; text-align: center; }
  .item-price { font-size: 17px; font-weight: 700; color: var(--accent-light); min-width: 80px; text-align: right; }
  .totals { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 24px; }
  .totals-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 16px; color: var(--muted); }
  .totals-row.discount { color: #34d399; }
  .totals-row.total { font-size: 26px; font-weight: 800; color: var(--text); border-top: 1px solid var(--border); padding-top: 14px; margin-top: 6px; }
  .totals-row.alt { font-size: 14px; color: var(--muted); padding-top: 2px; }
  .payment-layout { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 24px; }
  .spinner { width: 64px; height: 64px; border: 4px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  .payment-amount { font-size: 52px; font-weight: 900; color: var(--accent-light); }
  /* Complete */
  .complete-layout { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 20px; width: 100%; max-width: 480px; }
  .complete-check { width: 80px; height: 80px; border-radius: 50%; background: var(--green); display: flex; align-items: center; justify-content: center; font-size: 42px; animation: pop 0.3s cubic-bezier(0.34,1.56,0.64,1); }
  .complete-title { font-size: 36px; font-weight: 800; color: var(--green); }
  .complete-change { font-size: 26px; color: var(--muted); }
  .complete-change strong { color: var(--text); font-size: 30px; }
  .loyalty-badge { background: #7c3aed22; border: 1px solid #7c3aed66; color: #a78bfa; border-radius: 999px; padding: 8px 20px; font-size: 16px; font-weight: 600; }
  /* Email panel */
  .email-panel { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .email-label { font-size: 18px; font-weight: 600; color: var(--muted); text-align: center; }
  .email-type-toggle { display: flex; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
  .email-type-btn { flex: 1; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; background: var(--surface); color: var(--muted); transition: background 0.15s, color 0.15s; }
  .email-type-btn.active { background: var(--accent); color: #fff; }
  .email-row { display: flex; gap: 10px; }
  .email-input { flex: 1; background: #0f172a; border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; color: var(--text); font-size: 16px; outline: none; }
  .email-input:focus { border-color: var(--accent); }
  .email-send-btn { padding: 12px 20px; background: var(--accent); color: #fff; font-size: 16px; font-weight: 700; border: none; border-radius: 10px; cursor: pointer; white-space: nowrap; }
  .email-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .email-feedback { text-align: center; font-size: 14px; min-height: 20px; }
  .email-feedback.ok { color: #34d399; }
  .email-feedback.err { color: #f87171; }
  .email-sent { background: #10b98122; border: 1px solid #10b98144; border-radius: var(--radius); padding: 16px 24px; color: #34d399; font-size: 20px; font-weight: 700; text-align: center; }
  /* Footer */
  .footer { padding: 12px 28px; background: var(--surface); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .footer-text { font-size: 13px; color: var(--border); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
</style>
</head>
<body>
<header class="header">
  <div id="header-left" style="display:flex;align-items:center;gap:12px">
    <img id="logo-img" class="header-logo-img" src="" alt="" style="display:none"/>
    <div id="store-name" class="header-name">POS System</div>
  </div>
  <div class="header-time" id="clock"></div>
</header>
<main class="main" id="main-area"><div class="idle-icon">🛍️</div><div class="idle-title">Welcome!</div><div class="idle-sub">Please place your items on the counter</div></main>
<footer class="footer">
  <span class="footer-text">Thank you for shopping with us</span>
  <span id="dbg" style="position:fixed;bottom:4px;right:8px;font-size:10px;color:#334155;font-family:monospace"></span>
</footer>

<script>
(function () {
  'use strict';

  // Clock
  (function tick() {
    var el = document.getElementById('clock');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setTimeout(tick, 1000);
  }());

  // Logo
  fetch('/logo').then(function(r){return r.json();}).then(function(d){
    if (d.logoBase64) {
      var img = document.getElementById('logo-img');
      var nm = document.getElementById('store-name');
      if (img) { img.src = d.logoBase64; img.style.display = 'block'; }
      if (nm) nm.style.display = 'none';
    }
  }).catch(function(){});

  var area = document.getElementById('main-area');
  var dbgEl = document.getElementById('dbg');

  function poll() {
    fetch('/view?_t=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        if (area) area.innerHTML = html;
        if (dbgEl) dbgEl.textContent = new Date().toLocaleTimeString();
      })
      .catch(function(e) { if (dbgEl) dbgEl.textContent = 'ERR ' + new Date().toLocaleTimeString(); })
      .finally(function() { setTimeout(poll, 800); });
  }
  poll();

  window.setEmailType = function(type) {
    var rb = document.getElementById('btn-receipt'), ib = document.getElementById('btn-invoice');
    if (rb) rb.classList.toggle('active', type === 'receipt');
    if (ib) ib.classList.toggle('active', type === 'invoice');
    window._emailType = type;
  };
  window._emailType = 'receipt';

  window.submitEmail = function() {
    var input = document.getElementById('email-input');
    var btn = document.getElementById('email-send');
    var fb = document.getElementById('email-feedback');
    if (!input || !btn || !fb) return;
    var email = (input.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fb.textContent = 'Please enter a valid email address';
      fb.className = 'email-feedback err';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Sending\u2026';
    fb.textContent = '';
    fetch('/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, type: window._emailType || 'receipt' }) })
      .then(function(r){return r.json();})
      .then(function(result) {
        if (result.success) {
          var panel = document.getElementById('email-panel');
          if (panel) panel.outerHTML = '<div class="email-sent">\u2713 Email sent to ' + email.replace(/</g,'') + '</div>';
        } else {
          fb.textContent = result.error || 'Failed to send.';
          fb.className = 'email-feedback err';
          btn.disabled = false; btn.textContent = 'Send';
        }
      })
      .catch(function() {
        fb.textContent = 'Network error \u2014 please try again';
        fb.className = 'email-feedback err';
        btn.disabled = false; btn.textContent = 'Send';
      });
  };
}());
</script>
</body>
</html>`;
}
