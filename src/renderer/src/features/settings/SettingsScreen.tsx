import React, { useState, useEffect, useRef, useCallback } from 'react'
import QRCode from 'qrcode'
import { Save, RefreshCw, ArrowLeftRight, Monitor, Wifi, WifiOff, ExternalLink, FolderOpen, Plus, Edit2, Trash2, Check, X, ImageIcon, Upload, Link2, Link2Off, AlertCircle, RotateCcw } from 'lucide-react'
import { api } from '../../lib/api'
import { Input, Textarea, Button } from '../../components/ui'
import { useUiStore } from '../../stores/ui.store'
import { useCartStore } from '../../stores/cart.store'
import { useLogoStore } from '../../stores/logo.store'
import { useCurrencyStore } from '../../stores/currency.store'
import type { Category } from '../../types'
import {
  CURRENCIES,
  convertAmount,
  DEFAULT_KYD_TO_USD,
  type CurrencyCode
} from '../../lib/currency'

/** Renders a QR code for a URL onto a canvas element using the `qrcode` package. */
function QrCode({ url, size = 160 }: { url: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !url) return
    QRCode.toCanvas(canvasRef.current, url, {
      width: size,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    }).catch(() => { /* render failure -- canvas stays blank */ })
  }, [url, size])

  return <canvas ref={canvasRef} width={size} height={size} className="rounded-lg" />
}

// Toggle switch primitive
function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          checked ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      {label && <span className="text-sm text-gray-700">{label}</span>}
    </label>
  )
}


// ─── Category preset colours (shared with ProductsScreen) ────────────────────
const PRESET_COLORS = [
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#06b6d4', '#64748b', '#1e293b'
]

function ColorDot({ color, selected, onClick }: { color: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${selected ? 'border-gray-800 scale-110' : 'border-transparent'}`}
      style={{ backgroundColor: color }}
    />
  )
}

// ─── Receipt preview (live, scaled) ─────────────────────────────────────────

interface ReceiptPreviewProps {
  template: string
  showLogo: boolean
  footer: string
  storeName: string
  logoBase64: string
  primaryColor?: string
  accentColor?: string
  fontFamily?: string
  headerMessage?: string
  customField1?: string
  customField2?: string
  customField3?: string
}

const PREVIEW_FONT_MAP: Record<string, string> = {
  system: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  mono:   `'Courier New', Courier, monospace`,
  serif:  `Georgia, 'Times New Roman', serif`,
}

function ReceiptPreviewPane({
  template, showLogo, footer, storeName, logoBase64,
  primaryColor = '#1e293b', accentColor = '#3b82f6', fontFamily = 'system',
  headerMessage = '', customField1 = '', customField2 = '', customField3 = '',
}: ReceiptPreviewProps) {
  const logo = showLogo && logoBase64
    ? <img src={logoBase64} alt="logo" style={{ maxWidth: 80, maxHeight: 40, objectFit: 'contain', marginBottom: 6 }} />
    : null

  const fontStack = PREVIEW_FONT_MAP[fontFamily] ?? PREVIEW_FONT_MAP.system
  const customLines = [customField1, customField2, customField3].filter(Boolean)

  const ITEMS = [
    { name: 'Product A', qty: 2, price: '$12.00' },
    { name: 'Product B', qty: 1, price: '$8.50' },
    { name: 'Product C', qty: 3, price: '$27.00' },
  ]

  let inner: React.ReactNode

  if (template === 'modern') {
    inner = (
      <div style={{ fontFamily: fontStack, width: 280, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
        {/* Header */}
        <div style={{ background: primaryColor, padding: '16px 18px', textAlign: 'center' }}>
          {logo && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>{logo}</div>}
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{storeName || 'My Store'}</div>
          {headerMessage && <div style={{ color: 'rgba(255,255,255,0.80)', fontSize: 11, marginTop: 2, fontStyle: 'italic' }}>{headerMessage}</div>}
          <div style={{ color: 'rgba(255,255,255,0.60)', fontSize: 11, marginTop: 2 }}>Order #1042 · Today</div>
        </div>
        {/* Items */}
        <div style={{ padding: '10px 18px' }}>
          {ITEMS.map((item) => (
            <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#334155' }}>{item.qty}x {item.name}</span>
              <span style={{ color: '#0f172a', fontWeight: 600 }}>{item.price}</span>
            </div>
          ))}
        </div>
        {/* Total */}
        <div style={{ margin: '0 18px', borderTop: `2px solid ${primaryColor}`, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14, color: primaryColor }}>
          <span>Total</span><span>$47.50</span>
        </div>
        {/* Payment */}
        <div style={{ background: '#f0fdf4', margin: '10px 18px', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: accentColor }}>
          ✓ Cash — $50.00 · Change $2.50
        </div>
        {/* Footer */}
        {footer && <div style={{ textAlign: 'center', padding: '4px 18px', fontSize: 11, color: '#64748b' }}>{footer}</div>}
        {customLines.map((f, i) => <div key={i} style={{ textAlign: 'center', fontSize: 10, color: '#94a3b8', paddingBottom: i === customLines.length - 1 ? 12 : 0 }}>{f}</div>)}
      </div>
    )
  } else if (template === 'minimal') {
    inner = (
      <div style={{ fontFamily: fontStack, width: 260, background: '#fff', padding: '14px 16px', fontSize: 11, lineHeight: 1.5, color: '#111' }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{storeName || 'My Store'}</div>
        {headerMessage && <div style={{ textAlign: 'center', fontSize: 10, color: '#555', marginBottom: 8, fontStyle: 'italic' }}>{headerMessage}</div>}
        <div>{'─'.repeat(34)}</div>
        {ITEMS.map((item) => (
          <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{item.qty}x {item.name}</span><span>{item.price}</span>
          </div>
        ))}
        <div>{'─'.repeat(34)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
          <span>TOTAL</span><span>$47.50</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
          <span>CASH</span><span>$50.00</span>
        </div>
        {footer && <div style={{ textAlign: 'center', marginTop: 8, color: '#555' }}>{footer}</div>}
        {customLines.map((f, i) => <div key={i} style={{ textAlign: 'center', color: '#999', fontSize: 10 }}>{f}</div>)}
      </div>
    )
  } else {
    // Classic
    inner = (
      <div style={{ fontFamily: fontStack, width: 270, background: '#fff', padding: '14px 16px', fontSize: 11, lineHeight: 1.6, color: '#111' }}>
        {logo && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>{logo}</div>}
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: primaryColor }}>{storeName || 'MY STORE'}</div>
        {headerMessage && <div style={{ textAlign: 'center', fontSize: 10, color: '#555', fontStyle: 'italic' }}>{headerMessage}</div>}
        <div style={{ textAlign: 'center', color: '#555', fontSize: 10 }}>123 Main Street</div>
        <div style={{ margin: '6px 0', borderTop: '1px dashed #999' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555' }}>
          <span>Order #1042</span><span>Today 12:30 PM</span>
        </div>
        <div style={{ margin: '4px 0', borderTop: '1px dashed #999' }} />
        {ITEMS.map((item) => (
          <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{item.qty}x {item.name}</span><span>{item.price}</span>
          </div>
        ))}
        <div style={{ margin: '4px 0', borderTop: '1px dashed #999' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: primaryColor }}>
          <span>TOTAL</span><span>$47.50</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>CASH</span><span>$50.00</span>
        </div>
        <div style={{ margin: '6px 0', borderTop: '1px dashed #999' }} />
        {footer && <div style={{ textAlign: 'center', color: '#555' }}>{footer}</div>}
        {customLines.map((f, i) => <div key={i} style={{ textAlign: 'center', color: '#999', fontSize: 10 }}>{f}</div>)}
        <div style={{ textAlign: 'center', marginTop: 4, fontSize: 10, color: '#999' }}>*** THANK YOU ***</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: 280, overflow: 'hidden', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 12 }}>
      <div style={{ transform: 'scale(0.82)', transformOrigin: 'top center', pointerEvents: 'none' }}>
        {inner}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 32, background: 'linear-gradient(to bottom, transparent, #f8fafc)', borderRadius: '0 0 10px 10px' }} />
      <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#94a3b8', fontFamily: 'sans-serif' }}>Preview</div>
    </div>
  )
}

// ─── Invoice preview (live, scaled) ─────────────────────────────────────────

interface InvoicePreviewProps {
  showLogo: boolean
  footer: string
  storeName: string
  storeAddress: string
  logoBase64: string
  primaryColor?: string
  headerMessage?: string
  customField1?: string
  customField2?: string
  customField3?: string
}

function InvoicePreviewPane({
  showLogo, footer, storeName, storeAddress, logoBase64,
  primaryColor = '#1e293b', headerMessage = '',
  customField1 = '', customField2 = '', customField3 = '',
}: InvoicePreviewProps) {
  const logo = showLogo && logoBase64
    ? <img src={logoBase64} alt="logo" style={{ maxWidth: 80, maxHeight: 40, objectFit: 'contain' }} />
    : <div style={{ width: 80, height: 40, background: '#e2e8f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8' }}>LOGO</div>

  const ITEMS = [
    { name: 'Product A', qty: 2, unit: '$6.00', total: '$12.00' },
    { name: 'Product B', qty: 1, unit: '$8.50', total: '$8.50' },
    { name: 'Product C', qty: 3, unit: '$9.00', total: '$27.00' },
  ]
  const customLines = [customField1, customField2, customField3].filter(Boolean)

  return (
    <div style={{ position: 'relative', width: '100%', height: 340, overflow: 'hidden', background: '#f1f5f9', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 12 }}>
      <div style={{ transform: 'scale(0.60)', transformOrigin: 'top center', pointerEvents: 'none', width: 595 }}>
        {/* A4 invoice mock */}
        <div style={{ background: '#fff', padding: '32px 40px', fontFamily: 'sans-serif', color: '#1e293b', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', borderRadius: 4 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
            <div>
              {logo}
              <div style={{ marginTop: 8, fontWeight: 700, fontSize: 16 }}>{storeName || 'My Store'}</div>
              {headerMessage && <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', marginTop: 2 }}>{headerMessage}</div>}
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{storeAddress || '123 Main Street'}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Tel: (555) 000-0000</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: primaryColor, letterSpacing: -0.5 }}>INVOICE</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>#INV-1042</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Date: Today</div>
              <div style={{ marginTop: 8, display: 'inline-block', border: '2px solid #16a34a', color: '#16a34a', borderRadius: 4, padding: '2px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>PAID</div>
            </div>
          </div>
          {/* Bill To */}
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Bill To</div>
            <div style={{ fontWeight: 600 }}>John Smith</div>
            <div style={{ color: '#64748b' }}>john@example.com · (555) 111-2222</div>
          </div>
          {/* Items table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
            <thead>
              <tr style={{ background: primaryColor, color: '#fff' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Item</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Qty</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Unit</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {ITEMS.map((item, i) => (
                <tr key={item.name} style={{ background: i % 2 === 0 ? '#f8fafc' : '#fff' }}>
                  <td style={{ padding: '7px 12px' }}>{item.name}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{item.unit}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600 }}>{item.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 220, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#64748b' }}>
                <span>Subtotal</span><span>$47.50</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#64748b' }}>
                <span>Tax (10%)</span><span>$4.75</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: `2px solid ${primaryColor}`, fontWeight: 700, fontSize: 14, color: primaryColor }}>
                <span>Total</span><span>$52.25</span>
              </div>
            </div>
          </div>
          {/* Footer */}
          {(footer || customLines.length > 0) && (
            <div style={{ marginTop: 24, padding: '12px 16px', background: '#f8fafc', borderRadius: 8, fontSize: 11, color: '#64748b', textAlign: 'center' }}>
              {footer}
              {customLines.map((f, i) => <div key={i} style={{ marginTop: 4 }}>{f}</div>)}
            </div>
          )}
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, background: 'linear-gradient(to bottom, transparent, #f1f5f9)', borderRadius: '0 0 10px 10px' }} />
      <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#94a3b8', fontFamily: 'sans-serif' }}>Preview</div>
    </div>
  )
}


// ─── Sync Server Section ──────────────────────────────────────────────────────

function SyncServerSection({
  settings,
  field,
  onSave,
  showToast
}: {
  settings: Record<string, string>
  field: (key: string) => (v: string) => void
  onSave: () => Promise<void>
  showToast: (msg: string, type?: string) => void
}) {
  const [syncState, setSyncState] = useState<{ status: string; lastSyncAt: string | null; error: string | null } | null>(null)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const enabled = settings.syncEnabled === 'true'

  useEffect(() => {
    api.sync.getState().then(setSyncState).catch(() => {})
    const unsub = api.sync.onStateChange((s: unknown) => setSyncState(s as typeof syncState))
    return unsub
  }, [])

  async function handleToggleEnabled(val: boolean) {
    field('syncEnabled')(val ? 'true' : 'false')
    // Save immediately then start/stop the loop
    await api.settings.set('syncEnabled', val ? 'true' : 'false')
    if (val) {
      const interval = parseInt(settings.syncIntervalSeconds || '30', 10)
      await api.sync.start(interval)
      showToast('Sync enabled — connecting to server…', 'info')
    } else {
      await api.sync.stop()
      showToast('Sync disabled', 'info')
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    try {
      const result = await api.sync.testConnection(
        settings.syncUrl?.trim() ?? '',
        ''
      )
      showToast(result.message, result.ok ? 'success' : 'error')
    } finally {
      setTesting(false)
    }
  }

  async function handleSyncNow() {
    setSyncing(true)
    try {
      await api.sync.runNow()
      showToast('Sync complete', 'success')
    } catch {
      showToast('Sync failed — check error below', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const statusColor =
    syncState?.status === 'synced'   ? 'text-green-600'  :
    syncState?.status === 'syncing'  ? 'text-blue-600'   :
    syncState?.status === 'error'    ? 'text-red-600'    :
    syncState?.status === 'disabled' ? 'text-gray-400'   : 'text-gray-500'

  const statusLabel =
    syncState?.status === 'synced'   ? `Synced${syncState.lastSyncAt ? ` · ${new Date(syncState.lastSyncAt).toLocaleTimeString()}` : ''}` :
    syncState?.status === 'syncing'  ? 'Syncing…'  :
    syncState?.status === 'error'    ? 'Error'     :
    syncState?.status === 'disabled' ? 'Disabled'  : 'Idle'

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <ArrowLeftRight size={16} className="text-blue-600" />
          Multi-Terminal Sync Server
        </h2>
        <div className="flex items-center gap-3">
          {syncState && (
            <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
          )}
          <Toggle checked={enabled} onChange={handleToggleEnabled} />
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-5">
        Point all POS terminals at a central Kinetix POS Sync Server. Each terminal works
        fully offline and syncs products, inventory, orders, customers, and staff whenever
        the network is available.
      </p>

      <div className="space-y-4">
        <Input
          label="Server URL"
          value={settings.syncUrl ?? ''}
          onChange={field('syncUrl')}
          placeholder="http://192.168.1.100:3030"
        />
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 w-32">Sync interval</label>
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={settings.syncIntervalSeconds ?? '30'}
            onChange={(e) => field('syncIntervalSeconds')(e.target.value)}
          >
            <option value="15">Every 15 seconds</option>
            <option value="30">Every 30 seconds</option>
            <option value="60">Every minute</option>
            <option value="300">Every 5 minutes</option>
          </select>
        </div>
      </div>

      {syncState?.status === 'error' && syncState.error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {syncState.error}
        </div>
      )}

      <div className="mt-5 flex gap-3">
        <Button variant="secondary" onClick={handleTestConnection} disabled={testing || !settings.syncUrl}>
          {testing ? 'Testing…' : 'Test Connection'}
        </Button>
        {enabled && (
          <Button variant="secondary" onClick={handleSyncNow} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        )}
        <Button onClick={onSave}>Save</Button>
      </div>

      {settings.terminalId && (
        <p className="mt-4 text-xs text-gray-400">Terminal ID: {settings.terminalId}</p>
      )}

      {/* Embedded server API key — only visible when this machine runs the sync server */}    </section>
  )
}

// ─── Hardware / Printers Section ─────────────────────────────────────────────

interface PrinterInfo { name: string; displayName: string; isDefault: boolean }

function PrinterSection({
  settings,
  onSave,
  showToast
}: {
  settings: Record<string, string>
  onSave: (patches: Record<string, string>) => Promise<void>
  showToast: (msg: string, type?: string) => void
}) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [loading, setLoading] = useState(true)

  const [receiptPrinter, setReceiptPrinter] = useState(settings.receiptPrinterName ?? '')
  const [invoicePrinter, setInvoicePrinter] = useState(settings.invoicePrinterName ?? '')
  const [tagPrinter, setTagPrinter] = useState(settings.tagPrinterName ?? '')

  useEffect(() => {
    loadPrinters()
  }, [])

  // Keep local state in sync if parent settings reload
  useEffect(() => {
    setReceiptPrinter(settings.receiptPrinterName ?? '')
    setInvoicePrinter(settings.invoicePrinterName ?? '')
    setTagPrinter(settings.tagPrinterName ?? '')
  }, [settings.receiptPrinterName, settings.invoicePrinterName, settings.tagPrinterName])

  async function loadPrinters() {
    setLoading(true)
    try {
      const list = await api.printers.list()
      setPrinters(list)
    } catch {
      setPrinters([])
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      await onSave({
        receiptPrinterName: receiptPrinter,
        invoicePrinterName: invoicePrinter,
        tagPrinterName: tagPrinter,
      })
      showToast('Printer settings saved', 'success')
    } catch {
      showToast('Failed to save printer settings', 'error')
    }
  }

  const DIALOG_OPTION = '-- System print dialog --'

  function PrinterSelect({
    label,
    description,
    value,
    onChange
  }: {
    label: string
    description: string
    value: string
    onChange: (v: string) => void
  }) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-0.5">{label}</label>
        <p className="text-xs text-gray-400 mb-1.5">{description}</p>
        <div className="flex items-center gap-2">
          <select
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            value={value}
            onChange={(e) => onChange(e.target.value === DIALOG_OPTION ? '' : e.target.value)}
            disabled={loading}
          >
            <option value="">{loading ? 'Loading printers…' : DIALOG_OPTION}</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName}{p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-gray-900">Hardware / Printers</h2>
        <button
          onClick={loadPrinters}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors px-2 py-1 rounded-lg hover:bg-blue-50"
          title="Refresh printer list"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-5">
        Choose which Windows printer handles each document type. When no printer is selected the
        Windows print dialog opens and you choose manually each time.
      </p>

      <div className="space-y-5">
        <PrinterSelect
          label="Receipt Printer"
          description="Used when printing receipts and end-of-day reports"
          value={receiptPrinter}
          onChange={setReceiptPrinter}
        />
        <PrinterSelect
          label="Invoice Printer"
          description="Used when printing A4 invoices from the Orders screen"
          value={invoicePrinter}
          onChange={setInvoicePrinter}
        />
        <PrinterSelect
          label="Price Tag Printer"
          description="Used when printing product price tags from the Products screen"
          value={tagPrinter}
          onChange={setTagPrinter}
        />
      </div>

      <div className="mt-5 pt-4 border-t border-gray-100">
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Save Printer Settings
        </button>
        {(receiptPrinter || invoicePrinter || tagPrinter) && (
          <p className="mt-2 text-xs text-gray-400">
            Jobs will print silently to the selected printer — no dialog will appear.
          </p>
        )}
      </div>
    </section>
  )
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Local converter state
  const [convFrom, setConvFrom] = useState<CurrencyCode>('USD')
  const [convInput, setConvInput] = useState('')

  // Peripherals state
  const [displayWindowOpen, setDisplayWindowOpen] = useState(false)
  const [networkRunning, setNetworkRunning] = useState(false)
  const [networkPort, setNetworkPort] = useState('3031')
  const [localIp, setLocalIp] = useState('127.0.0.1')
  const [displayLoading, setDisplayLoading] = useState(false)
  const [networkLoading, setNetworkLoading] = useState(false)

  // QuickBooks Online state
  const [qboStatus, setQboStatus] = useState<{
    connected: boolean; companyName: string | null; lastSyncAt: string | null; sandbox: boolean
  } | null>(null)
  const [qboConnecting, setQboConnecting] = useState(false)
  const [qboSyncing, setQboSyncing] = useState(false)
  const [qboError, setQboError] = useState<string | null>(null)
  const [emailTesting, setEmailTesting] = useState(false)
  const [emailTestResult, setEmailTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Categories state
  const [categories, setCategories] = useState<Category[]>([])
  const [catEditId, setCatEditId] = useState<string | null>(null)
  const [catEditName, setCatEditName] = useState('')
  const [catEditColor, setCatEditColor] = useState(PRESET_COLORS[0])
  const [catAdding, setCatAdding] = useState(false)
  const [catNewName, setCatNewName] = useState('')
  const [catNewColor, setCatNewColor] = useState(PRESET_COLORS[0])
  const [catSaving, setCatSaving] = useState(false)

  const showToast = useUiStore((s) => s.showToast)

  // Live store references
  const setTaxEnabled = useCartStore((s) => s.setTaxEnabled)
  const setTaxRate = useCartStore((s) => s.setTaxRate)
  const setCurrency = useCurrencyStore((s) => s.setCurrency)
  const setKydToUsdRate = useCurrencyStore((s) => s.setKydToUsdRate)
  const logoBase64 = useLogoStore((s) => s.logoBase64)
  const setLogo = useLogoStore((s) => s.setLogo)

  useEffect(() => {
    api.settings.getAll().then((s) => {
      setSettings({
        taxEnabled: 'true',
        currency: 'USD',
        kydToUsdRate: String(DEFAULT_KYD_TO_USD),
        enabledPaymentMethods: JSON.stringify(['cash','card','store_credit','gift_card','layaway']),
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
        displayBgColor: '#0f172a',
        displayBgImage: '',
        terminalName: 'Terminal 1',
        emailPort: '587',
        emailSecure: 'false',
        emailFromName: 'Kinetix POS',
        ...s
      })
      setLoading(false)
    })

    // Load display status
    api.display.status().then((s) => {
      setDisplayWindowOpen(s.windowOpen)
      setNetworkRunning(s.networkRunning)
      setLocalIp(s.localIp)
    }).catch(() => { /* display API unavailable */ })

    // Load categories
    api.categories.list().then(setCategories).catch(() => {})

    // Load QBO status
    api.qbo.status().then(setQboStatus).catch(() => {})
  }, [])

  const handleToggleDisplayWindow = useCallback(async () => {
    setDisplayLoading(true)
    try {
      if (displayWindowOpen) {
        await api.display.close()
        setDisplayWindowOpen(false)
        showToast('Customer display closed', 'success')
      } else {
        await api.display.open()
        setDisplayWindowOpen(true)
        showToast('Customer display opened', 'success')
      }
    } catch {
      showToast('Failed to toggle customer display', 'error')
    } finally {
      setDisplayLoading(false)
    }
  }, [displayWindowOpen, showToast])

  const handleToggleNetwork = useCallback(async () => {
    setNetworkLoading(true)
    try {
      const port = parseInt(networkPort, 10) || 3030
      if (networkRunning) {
        await api.display.networkStop()
        setNetworkRunning(false)
        showToast('Network display stopped', 'success')
      } else {
        const result = await api.display.networkStart(port)
        setNetworkRunning(true)
        setLocalIp(result.ip)
        showToast(`Network display started on port ${result.port}`, 'success')
      }
    } catch {
      showToast('Failed to toggle network display', 'error')
    } finally {
      setNetworkLoading(false)
    }
  }, [networkRunning, networkPort, showToast])

  async function handleEmailTest() {
    setEmailTesting(true)
    setEmailTestResult(null)
    try {
      const result = await api.email.testConnection({
        host: settings.emailHost ?? '',
        port: parseInt(settings.emailPort ?? '587', 10),
        secure: (settings.emailSecure ?? 'false') === 'true',
        user: settings.emailUser ?? '',
        password: settings.emailPassword ?? '',
        fromName: settings.emailFromName ?? 'Kinetix POS',
        fromAddress: settings.emailFromAddress ?? '',
      })
      setEmailTestResult({ ok: result.success, msg: result.success ? 'Connection successful!' : (result.error ?? 'Connection failed') })
    } catch {
      setEmailTestResult({ ok: false, msg: 'Test failed — check your settings' })
    } finally {
      setEmailTesting(false)
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500 * 1024) { showToast('Logo must be under 500 KB', 'error'); return }
    const reader = new FileReader()
    reader.onload = async () => {
      const b64 = reader.result as string
      await api.settings.set('logoBase64', b64)
      // Keep local settings state in sync so handleSave() doesn't overwrite the new logo
      setSettings((s) => ({ ...s, logoBase64: b64 }))
      setLogo(b64)
      showToast('Logo saved', 'success')
    }
    reader.readAsDataURL(file)
  }

  async function handleLogoRemove() {
    await api.settings.set('logoBase64', '')
    // Keep local settings state in sync so handleSave() doesn't accidentally restore the old logo
    setSettings((s) => ({ ...s, logoBase64: '' }))
    setLogo(null)
    showToast('Logo removed', 'success')
  }

  async function handleQboConnect() {
    setQboConnecting(true)
    setQboError(null)
    try {
      // Auto-save QBO credentials to DB before starting auth so the service
      // can read them. This prevents "Client ID not configured" errors when
      // the user hasn't clicked Save Changes yet.
      await Promise.all([
        api.settings.set('qboClientId',     settings.qboClientId     ?? ''),
        api.settings.set('qboClientSecret', settings.qboClientSecret ?? ''),
        api.settings.set('qboSandbox',      settings.qboSandbox      ?? 'false'),
      ])

      const result = await api.qbo.startAuth()
      if (result.success) {
        showToast(`Connected to QuickBooks${result.companyName ? `: ${result.companyName}` : ''}`, 'success')
        setQboStatus(await api.qbo.status())
      } else {
        setQboError(result.error ?? 'Connection failed')
      }
    } catch (err) {
      setQboError(String(err))
    } finally {
      setQboConnecting(false)
    }
  }

  async function handleQboDisconnect() {
    if (!confirm('Disconnect from QuickBooks? This will clear stored tokens.')) return
    await api.qbo.disconnect()
    setQboStatus(await api.qbo.status())
    showToast('Disconnected from QuickBooks', 'success')
  }

  async function handleQboSync() {
    setQboSyncing(true)
    setQboError(null)
    try {
      const [salesResult, custResult] = await Promise.all([
        api.qbo.syncSales(),
        api.qbo.syncCustomers()
      ])
      const total = salesResult.synced + custResult.synced
      const failed = salesResult.failed + custResult.failed
      showToast(
        `Synced ${total} records to QuickBooks${failed > 0 ? ` (${failed} failed)` : ''}`,
        failed > 0 ? 'error' : 'success'
      )
      if (failed > 0) {
        setQboError([...salesResult.errors, ...custResult.errors].slice(0, 3).join('\n'))
      }
      setQboStatus(await api.qbo.status())
    } catch (err) {
      setQboError(String(err))
    } finally {
      setQboSyncing(false)
    }
  }

  async function loadCategories() {
    api.categories.list().then(setCategories).catch(() => {})
  }

  async function handleCatAdd() {
    if (!catNewName.trim()) return
    setCatSaving(true)
    try {
      await api.categories.create({ name: catNewName.trim(), color: catNewColor })
      setCatNewName('')
      setCatNewColor(PRESET_COLORS[0])
      setCatAdding(false)
      showToast('Category added', 'success')
      await loadCategories()
    } finally { setCatSaving(false) }
  }

  async function handleCatUpdate() {
    if (!catEditId || !catEditName.trim()) return
    setCatSaving(true)
    try {
      await api.categories.update(catEditId, { name: catEditName.trim(), color: catEditColor })
      setCatEditId(null)
      showToast('Category updated', 'success')
      await loadCategories()
    } finally { setCatSaving(false) }
  }

  async function handleCatDelete(cat: Category) {
    if (!confirm(`Delete category "${cat.name}"? Products will become uncategorised.`)) return
    await api.categories.delete(cat.id)
    showToast('Category deleted', 'success')
    await loadCategories()
  }

  async function handleSave() {
    setSaving(true)
    try {
      await Promise.all(Object.entries(settings).map(([k, v]) => api.settings.set(k, v)))
      setTaxEnabled(settings.taxEnabled === 'true')
      setTaxRate(parseFloat(settings.taxRate) || 0.08)
      setCurrency((settings.currency as CurrencyCode) || 'USD')
      setKydToUsdRate(parseFloat(settings.kydToUsdRate) || DEFAULT_KYD_TO_USD)
      showToast('Settings saved', 'success')
    } catch (err) {
      showToast(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  /** Save a specific set of key/value pairs immediately (used by sub-sections with their own Save button). */
  async function savePatches(patches: Record<string, string>) {
    await Promise.all(Object.entries(patches).map(([k, v]) => api.settings.set(k, v)))
    setSettings((s) => ({ ...s, ...patches }))
  }

  function field(key: string) {
    return (eOrValue: React.ChangeEvent<HTMLInputElement> | string) => {
      const value = typeof eOrValue === 'string' ? eOrValue : eOrValue.target.value
      setSettings((s) => ({ ...s, [key]: value }))
    }
  }

  function setBool(key: string, val: boolean) {
    setSettings((s) => ({ ...s, [key]: String(val) }))
  }

  // Derived converter values
  const rate = parseFloat(settings.kydToUsdRate) || DEFAULT_KYD_TO_USD
  const convAmount = parseFloat(convInput) || 0
  const convTo: CurrencyCode = convFrom === 'USD' ? 'KYD' : 'USD'
  const convResult = convertAmount(convAmount, convFrom, convTo, rate)

  if (loading) return null

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <Button icon={<Save size={16} />} onClick={handleSave} loading={saving}>
          Save Changes
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">

        {/* Store Logo */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <ImageIcon size={16} className="text-blue-500" /> Store Logo
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Shown on the login screen, sidebar, customer display, and printed receipts. PNG or JPG, max 500 KB.
          </p>
          <div className="flex items-start gap-5">
            {/* Preview */}
            <div className="w-32 h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 shrink-0 overflow-hidden">
              {logoBase64 ? (
                <img src={logoBase64} alt="Logo preview" className="max-w-full max-h-full object-contain p-1" />
              ) : (
                <ImageIcon size={28} className="text-gray-300" />
              )}
            </div>
            {/* Controls */}
            <div className="flex flex-col gap-2">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="sr-only"
                  onChange={handleLogoUpload}
                />
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors cursor-pointer">
                  <Upload size={14} /> Upload Logo
                </span>
              </label>
              {logoBase64 && (
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  className="text-xs text-red-500 hover:text-red-700 text-left"
                >
                  Remove logo
                </button>
              )}
              <p className="text-xs text-gray-400">Recommended: PNG with transparent background, at least 200px wide.</p>
            </div>
          </div>
        </section>

        {/* Store Information */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Store Information</h2>
          <div className="space-y-4">
            <Input label="Store Name" value={settings.storeName ?? ''} onChange={field('storeName')} />
            <Input label="Address" value={settings.storeAddress ?? ''} onChange={field('storeAddress')} />
            <Input label="Phone" value={settings.storePhone ?? ''} onChange={field('storePhone')} />
            <Input label="Terminal Name (e.g. Terminal 1, Register A)" value={settings.terminalName ?? ''} onChange={field('terminalName')} placeholder="Terminal 1" />
          </div>
        </section>

        {/* Tax Settings */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Tax Settings</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-gray-800">Enable Tax</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  When off, no tax is charged on any sale. Can also be toggled per-sale in the cart.
                </p>
              </div>
              <Toggle
                checked={settings.taxEnabled === 'true'}
                onChange={(v) => setBool('taxEnabled', v)}
              />
            </div>
            <div className={`grid grid-cols-2 gap-4 transition-opacity ${settings.taxEnabled === 'true' ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <Input
                label="Tax Rate (e.g. 0.08 = 8%)"
                value={settings.taxRate ?? ''}
                onChange={field('taxRate')}
                type="number"
                step="0.001"
                min="0"
                max="1"
              />
              <Input
                label="Tax Name (e.g. Sales Tax, VAT)"
                value={settings.taxName ?? ''}
                onChange={field('taxName')}
              />
            </div>
          </div>
        </section>

        {/* Payment Methods */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Payment Methods</h2>
          <p className="text-xs text-gray-500 mb-4">Choose which payment methods appear on the checkout screen.</p>
          <div className="space-y-3">
            {([
              { key: 'cash',         label: 'Cash',         desc: 'Physical cash payments with change calculation' },
              { key: 'card',         label: 'Card',         desc: 'Credit / debit card (requires terminal)' },
              { key: 'store_credit', label: 'Store Credit', desc: 'Redeem customer store credit balance' },
              { key: 'gift_card',    label: 'Gift Card',    desc: 'Accept gift card codes as payment' },
              { key: 'layaway',      label: 'Layaway',      desc: 'Partial / hold payments for later pickup' },
            ] as { key: string; label: string; desc: string }[]).map(({ key, label, desc }) => {
              const enabled = (() => {
                try {
                  const stored = settings.enabledPaymentMethods
                  if (!stored) return true
                  return (JSON.parse(stored) as string[]).includes(key)
                } catch { return true }
              })()
              function toggleMethod(on: boolean) {
                const current: string[] = (() => {
                  try { return JSON.parse(settings.enabledPaymentMethods ?? '[]') as string[] }
                  catch { return ['cash','card','store_credit','gift_card','layaway'] }
                })()
                const next = on ? [...new Set([...current, key])] : current.filter((m) => m !== key)
                // Always keep at least one method enabled
                if (next.length === 0) return
                setSettings((prev) => ({ ...prev, enabledPaymentMethods: JSON.stringify(next) }))
              }
              return (
                <div key={key} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                  <Toggle checked={enabled} onChange={toggleMethod} />
                </div>
              )
            })}
          </div>
        </section>

        {/* Currency */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Currency</h2>
          <p className="text-xs text-gray-500 mb-4">
            Choose the default display currency. All product prices will be shown in this currency.
          </p>

          {/* Currency selector */}
          <div className="flex gap-3 mb-5">
            {(Object.values(CURRENCIES)).map((cur) => (
              <button
                key={cur.code}
                onClick={() => setSettings((s) => ({ ...s, currency: cur.code }))}
                className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                  settings.currency === cur.code
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="text-xl mb-0.5">{cur.symbol}</div>
                <div>{cur.code}</div>
                <div className="text-xs font-normal text-gray-500 mt-0.5">{cur.name}</div>
              </button>
            ))}
          </div>

          {/* KYD exchange rate */}
          <div className="space-y-1 mb-5">
            <Input
              label="KYD to USD rate (1 KYD = ? USD)"
              value={settings.kydToUsdRate ?? String(DEFAULT_KYD_TO_USD)}
              onChange={field('kydToUsdRate')}
              type="number"
              step="0.0001"
              min="0.01"
            />
            <p className="text-xs text-gray-400">
              The official Cayman Islands peg is <strong>1 KYD = 1.20 USD</strong> (fixed since 1974).
              Only change this if you're using a different rate.
            </p>
            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, kydToUsdRate: String(DEFAULT_KYD_TO_USD) }))}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <RefreshCw size={11} /> Reset to official rate (1.20)
            </button>
          </div>

          {/* Live currency converter */}
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <ArrowLeftRight size={13} /> Currency Converter
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">{CURRENCIES[convFrom].name}</label>
                <div className="flex">
                  <span className="bg-white border border-r-0 border-gray-300 rounded-l-lg px-3 py-2 text-sm text-gray-600 flex items-center">
                    {CURRENCIES[convFrom].symbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={convInput}
                    onChange={(e) => setConvInput(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 border border-gray-300 rounded-r-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setConvFrom((f) => (f === 'USD' ? 'KYD' : 'USD'))}
                className="mt-5 p-2 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-600 transition-colors"
                title="Swap currencies"
              >
                <ArrowLeftRight size={16} />
              </button>

              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">{CURRENCIES[convTo].name}</label>
                <div className="flex">
                  <span className="bg-white border border-r-0 border-gray-300 rounded-l-lg px-3 py-2 text-sm text-gray-600 flex items-center">
                    {CURRENCIES[convTo].symbol}
                  </span>
                  <div className="flex-1 border border-gray-300 rounded-r-lg px-3 py-2 text-sm bg-gray-100 text-gray-800 font-semibold min-h-[44px] flex items-center">
                    {convAmount > 0 ? convResult.toFixed(2) : '-'}
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Rate: 1 KYD = {rate.toFixed(4)} USD | 1 USD = {(1 / rate).toFixed(4)} KYD
            </p>
          </div>
        </section>

        {/* Receipts */}
        {/* Receipt Templates */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Receipt Templates</h2>
          <p className="text-xs text-gray-500 mb-4">Choose how printed receipts look.</p>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Template Style</p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { key: 'classic', label: 'Classic', desc: 'Monospace thermal-style' },
                  { key: 'modern',  label: 'Modern',  desc: 'Clean with header banner' },
                  { key: 'minimal', label: 'Minimal', desc: 'Ultra-compact, items only' },
                ] as { key: string; label: string; desc: string }[]).map(({ key, label, desc }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSettings((p) => ({ ...p, receiptTemplate: key }))}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      (settings.receiptTemplate ?? 'classic') === key
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${(settings.receiptTemplate ?? 'classic') === key ? 'text-blue-700' : 'text-gray-800'}`}>{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>
            {/* Colors & Branding */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Colors &amp; Branding</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">Brand Color</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.receiptPrimaryColor ?? '#1e293b'}
                      onChange={(e) => setSettings((p) => ({ ...p, receiptPrimaryColor: e.target.value }))}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                      title="Brand / header color"
                    />
                    <div className="flex flex-wrap gap-1">
                      {PRESET_COLORS.slice(0, 6).map((c) => (
                        <ColorDot key={c} color={c} selected={(settings.receiptPrimaryColor ?? '#1e293b') === c} onClick={() => setSettings((p) => ({ ...p, receiptPrimaryColor: c }))} />
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">Accent Color</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.receiptAccentColor ?? '#3b82f6'}
                      onChange={(e) => setSettings((p) => ({ ...p, receiptAccentColor: e.target.value }))}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                      title="Accent color for discounts and highlights"
                    />
                    <div className="flex flex-wrap gap-1">
                      {PRESET_COLORS.slice(6, 12).map((c) => (
                        <ColorDot key={c} color={c} selected={(settings.receiptAccentColor ?? '#3b82f6') === c} onClick={() => setSettings((p) => ({ ...p, receiptAccentColor: c }))} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Font Style */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Font Style</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: 'system', label: 'System', sample: 'Aa' },
                  { key: 'mono',   label: 'Monospace', sample: 'Aa' },
                  { key: 'serif',  label: 'Serif', sample: 'Aa' },
                ] as { key: string; label: string; sample: string }[]).map(({ key, label, sample }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSettings((p) => ({ ...p, receiptFontFamily: key }))}
                    className={`text-center p-2 rounded-lg border-2 transition-all ${
                      (settings.receiptFontFamily ?? 'system') === key
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span style={{
                      fontFamily: key === 'mono' ? "'Courier New', monospace" : key === 'serif' ? "Georgia, serif" : 'sans-serif',
                      fontSize: 16, display: 'block', marginBottom: 2,
                      color: (settings.receiptFontFamily ?? 'system') === key ? '#1d4ed8' : '#374151'
                    }}>{sample}</span>
                    <span className={`text-xs ${(settings.receiptFontFamily ?? 'system') === key ? 'text-blue-700 font-semibold' : 'text-gray-500'}`}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* Layout & Sections */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Layout &amp; Sections</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Show Logo on Receipt</p>
                    <p className="text-xs text-gray-500 mt-0.5">Prints the store logo at the top of every receipt</p>
                  </div>
                  <Toggle checked={(settings.receiptShowLogo ?? 'true') === 'true'} onChange={(v) => setBool('receiptShowLogo', v)} />
                </div>
                <div className="flex items-center justify-between py-1">
                  <p className="text-sm font-medium text-gray-800">Show Tax Line</p>
                  <Toggle checked={(settings.receiptShowTaxLine ?? 'true') === 'true'} onChange={(v) => setBool('receiptShowTaxLine', v)} />
                </div>
                <div className="flex items-center justify-between py-1">
                  <p className="text-sm font-medium text-gray-800">Show Discount Line</p>
                  <Toggle checked={(settings.receiptShowDiscountLine ?? 'true') === 'true'} onChange={(v) => setBool('receiptShowDiscountLine', v)} />
                </div>
                <div className="flex items-center justify-between py-1">
                  <p className="text-sm font-medium text-gray-800">Show Order Notes</p>
                  <Toggle checked={(settings.receiptShowNotes ?? 'true') === 'true'} onChange={(v) => setBool('receiptShowNotes', v)} />
                </div>
              </div>
            </div>
            {/* Header & Footer */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Header &amp; Footer Content</p>
              <div className="space-y-3">
                <Textarea label="Header Tagline (optional)" value={settings.receiptHeaderMessage ?? ''} onChange={(e) => field('receiptHeaderMessage')(e.target.value)} placeholder="Your tagline or slogan" rows={2} />
                <Textarea label="Footer Text" value={settings.receiptFooterText ?? ''} onChange={(e) => field('receiptFooterText')(e.target.value)} placeholder="Thank you for your business!" rows={2} />
              </div>
            </div>
            {/* Custom Fields */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Custom Fields</p>
              <p className="text-xs text-gray-500 mb-3">Extra lines printed in the footer — website, loyalty message, social handles, etc.</p>
              <div className="space-y-2">
                <Input label="Custom Line 1" value={settings.receiptCustomField1 ?? ''} onChange={field('receiptCustomField1')} placeholder="e.g. www.mystore.com" />
                <Input label="Custom Line 2" value={settings.receiptCustomField2 ?? ''} onChange={field('receiptCustomField2')} placeholder="e.g. Follow us @mystore" />
                <Input label="Custom Line 3" value={settings.receiptCustomField3 ?? ''} onChange={field('receiptCustomField3')} placeholder="e.g. Earn points with every purchase!" />
              </div>
            </div>
            {/* Live preview */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Live Preview</p>
              <ReceiptPreviewPane
                template={settings.receiptTemplate ?? 'classic'}
                showLogo={(settings.receiptShowLogo ?? 'true') === 'true'}
                footer={settings.receiptFooterText ?? ''}
                storeName={settings.storeName ?? ''}
                logoBase64={logoBase64 ?? ''}
                primaryColor={settings.receiptPrimaryColor ?? '#1e293b'}
                accentColor={settings.receiptAccentColor ?? '#3b82f6'}
                fontFamily={settings.receiptFontFamily ?? 'system'}
                headerMessage={settings.receiptHeaderMessage ?? ''}
                customField1={settings.receiptCustomField1 ?? ''}
                customField2={settings.receiptCustomField2 ?? ''}
                customField3={settings.receiptCustomField3 ?? ''}
              />
            </div>
          </div>
        </section>

        {/* Invoice Settings */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Invoice Settings</h2>
          <p className="text-xs text-gray-500 mb-4">Invoices are formal A4 documents printed from the Orders screen.</p>
          <div className="space-y-4">
            {/* Colors & Branding */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Colors &amp; Branding</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">Brand Color</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.invoicePrimaryColor ?? '#1e293b'}
                      onChange={(e) => setSettings((p) => ({ ...p, invoicePrimaryColor: e.target.value }))}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                      title="Invoice header and accent color"
                    />
                    <div className="flex flex-wrap gap-1">
                      {PRESET_COLORS.slice(0, 6).map((c) => (
                        <ColorDot key={c} color={c} selected={(settings.invoicePrimaryColor ?? '#1e293b') === c} onClick={() => setSettings((p) => ({ ...p, invoicePrimaryColor: c }))} />
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">Accent Color</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.invoiceAccentColor ?? '#10b981'}
                      onChange={(e) => setSettings((p) => ({ ...p, invoiceAccentColor: e.target.value }))}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                      title="Discount highlight color"
                    />
                    <div className="flex flex-wrap gap-1">
                      {PRESET_COLORS.slice(6, 12).map((c) => (
                        <ColorDot key={c} color={c} selected={(settings.invoiceAccentColor ?? '#10b981') === c} onClick={() => setSettings((p) => ({ ...p, invoiceAccentColor: c }))} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Layout & Sections */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Layout &amp; Sections</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Show Logo on Invoice</p>
                    <p className="text-xs text-gray-500 mt-0.5">Prints the store logo in the invoice header</p>
                  </div>
                  <Toggle checked={(settings.invoiceShowLogo ?? 'true') === 'true'} onChange={(v) => setBool('invoiceShowLogo', v)} />
                </div>
                <div className="flex items-center justify-between py-1">
                  <p className="text-sm font-medium text-gray-800">Show Tax Line</p>
                  <Toggle checked={(settings.invoiceShowTaxLine ?? 'true') === 'true'} onChange={(v) => setBool('invoiceShowTaxLine', v)} />
                </div>
                <div className="flex items-center justify-between py-1">
                  <p className="text-sm font-medium text-gray-800">Show Discount Line</p>
                  <Toggle checked={(settings.invoiceShowDiscountLine ?? 'true') === 'true'} onChange={(v) => setBool('invoiceShowDiscountLine', v)} />
                </div>
              </div>
            </div>
            {/* Header & Footer */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Header &amp; Footer Content</p>
              <div className="space-y-3">
                <Textarea label="Header Tagline (optional)" value={settings.invoiceHeaderMessage ?? ''} onChange={(e) => field('invoiceHeaderMessage')(e.target.value)} placeholder="e.g. Your trusted local supplier" rows={2} />
                <Textarea label="Footer / Payment Terms" value={settings.invoiceFooterText ?? ''} onChange={(e) => field('invoiceFooterText')(e.target.value)} placeholder="Payment due on receipt. Thank you!" rows={2} />
              </div>
            </div>
            {/* Custom Fields */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Custom Fields</p>
              <p className="text-xs text-gray-500 mb-3">Extra lines in the invoice footer — bank details, return policy, website, etc.</p>
              <div className="space-y-2">
                <Input label="Custom Line 1" value={settings.invoiceCustomField1 ?? ''} onChange={field('invoiceCustomField1')} placeholder="e.g. Bank: CIBC · Acc: 0012345" />
                <Input label="Custom Line 2" value={settings.invoiceCustomField2 ?? ''} onChange={field('invoiceCustomField2')} placeholder="e.g. Returns accepted within 14 days" />
                <Input label="Custom Line 3" value={settings.invoiceCustomField3 ?? ''} onChange={field('invoiceCustomField3')} placeholder="e.g. www.mystore.com" />
              </div>
            </div>
            {/* Live preview */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Live Preview</p>
              <InvoicePreviewPane
                showLogo={(settings.invoiceShowLogo ?? 'true') === 'true'}
                footer={settings.invoiceFooterText ?? ''}
                storeName={settings.storeName ?? ''}
                storeAddress={settings.storeAddress ?? ''}
                logoBase64={logoBase64 ?? ''}
                primaryColor={settings.invoicePrimaryColor ?? '#1e293b'}
                headerMessage={settings.invoiceHeaderMessage ?? ''}
                customField1={settings.invoiceCustomField1 ?? ''}
                customField2={settings.invoiceCustomField2 ?? ''}
                customField3={settings.invoiceCustomField3 ?? ''}
              />
            </div>
          </div>
        </section>

        <PrinterSection
          settings={settings}
          onSave={savePatches}
          showToast={showToast}
        />

        {/* Loyalty */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Loyalty Program</h2>
          <Input
            label="Points earned per dollar spent"
            value={settings.loyaltyPointsPerDollar ?? ''}
            onChange={field('loyaltyPointsPerDollar')}
            type="number"
            min="0"
          />
        </section>

        {/* Email Settings */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Email Settings</h2>
          <p className="text-xs text-gray-500 mb-4">
            Configure SMTP to email receipts and invoices to customers. Works with Gmail, Outlook, SendGrid, or any SMTP server.
          </p>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="SMTP Host" value={settings.emailHost ?? ''} onChange={field('emailHost')} placeholder="smtp.gmail.com" />
              <Input label="Port" value={settings.emailPort ?? '587'} onChange={field('emailPort')} type="number" placeholder="587" />
            </div>
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-gray-800">Use SSL / TLS</p>
                <p className="text-xs text-gray-500 mt-0.5">Enable for port 465 (SSL). Leave off for 587 (STARTTLS).</p>
              </div>
              <Toggle
                checked={(settings.emailSecure ?? 'false') === 'true'}
                onChange={(v) => {
                  setBool('emailSecure', v)
                  // Auto-set the standard port when toggling SSL
                  setSettings((s) => ({ ...s, emailPort: v ? '465' : '587' }))
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Username / Email" value={settings.emailUser ?? ''} onChange={field('emailUser')} placeholder="you@example.com" />
              <Input label="Password / App Password" type="password" value={settings.emailPassword ?? ''} onChange={field('emailPassword')} placeholder="••••••••" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="From Name" value={settings.emailFromName ?? ''} onChange={field('emailFromName')} placeholder="Kinetix POS" />
              <Input label="From Address" value={settings.emailFromAddress ?? ''} onChange={field('emailFromAddress')} placeholder="noreply@yourstore.com" />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleEmailTest}
                disabled={emailTesting || !settings.emailHost || !settings.emailUser}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {emailTesting ? 'Testing…' : 'Test Connection'}
              </button>
              {emailTestResult && (
                <span className={`text-sm font-medium ${emailTestResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                  {emailTestResult.ok ? '\u2713' : '\u2717'} {emailTestResult.msg}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              For Gmail: use an <a href="https://myaccount.google.com/apppasswords" className="text-blue-500 underline" target="_blank" rel="noreferrer">App Password</a> with 2FA enabled.
            </p>
          </div>
        </section>

        {/* Multi-Terminal Sync Server */}
        <SyncServerSection settings={settings} field={field} onSave={handleSave} showToast={showToast} />

        {/* Admin Web Dashboard */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Monitor size={16} className="text-gray-500" /> Web Dashboard
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Set a PIN to log in to the browser-based admin dashboard (<code className="text-blue-600">http://&lt;this-machine&gt;:3030</code>).
            Only applies when this machine is running as a <strong>Sync Server</strong>.
          </p>
          <div className="max-w-xs">
            <Input
              label="Dashboard Admin PIN"
              type="password"
              value={settings.dashboardAdminPin ?? ''}
              onChange={field('dashboardAdminPin')}
              placeholder="Set a PIN to secure the dashboard"
              maxLength={8}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Minimum 4 digits. You can also grant dashboard access per-staff-member in the Staff screen.
            </p>
          </div>
        </section>

        {/* System */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <RotateCcw size={16} className="text-gray-500" /> System
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Re-run the initial setup wizard to change this machine's role (Standalone, Sync Server, or Terminal).
          </p>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('This will re-open the setup wizard on next launch. Continue?')) return
              await api.setup.reset()
              showToast('Setup wizard will appear on next launch.', 'info')
            }}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <RotateCcw size={14} /> Re-run Setup Wizard
          </button>
        </section>

        {/* QuickBooks / Accounting Sync — hidden until QBO troubleshooting is complete */}
        {false && <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Link2 size={16} className="text-emerald-600" /> Accounting Sync
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            Connect to QuickBooks Online to automatically sync completed sales, customers, and daily summaries.
            You will need a <strong>Client ID</strong> and <strong>Client Secret</strong> from your QBO developer app at{' '}
            <a href="https://developer.intuit.com" className="text-blue-600 underline" target="_blank" rel="noreferrer">developer.intuit.com</a>.
          </p>

          {/* Credentials (always visible so user can update them) */}
          <div className="space-y-3 mb-5">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="QBO Client ID"
                value={settings.qboClientId ?? ''}
                onChange={field('qboClientId')}
                placeholder="Your QBO app Client ID"
              />
              <Input
                label="QBO Client Secret"
                type="password"
                value={settings.qboClientSecret ?? ''}
                onChange={field('qboClientSecret')}
                placeholder="Your QBO app Client Secret"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.qboSandbox === 'true'}
                  onChange={(e) => setSettings((s) => ({ ...s, qboSandbox: String(e.target.checked) }))}
                  className="w-4 h-4 rounded"
                />
                Use QuickBooks Sandbox (for testing)
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Enter your Client ID and Secret from developer.intuit.com, then click Connect.
            </p>
          </div>

          {/* Connection status */}
          {qboStatus?.connected ? (
            <div className="flex items-start justify-between p-4 bg-emerald-50 border border-emerald-200 rounded-xl mb-4">
              <div>
                <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                  <Link2 size={14} />
                  Connected: {qboStatus.companyName ?? 'QuickBooks'}
                  {qboStatus.sandbox && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Sandbox</span>}
                </div>
                {qboStatus.lastSyncAt && (
                  <p className="text-xs text-emerald-600 mt-1">
                    Last sync: {new Date(qboStatus.lastSyncAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={handleQboSync}
                  loading={qboSyncing}
                  icon={<RefreshCw size={13} />}
                >
                  Sync Now
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Link2Off size={13} />}
                  onClick={handleQboDisconnect}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <Button
              icon={<Link2 size={14} />}
              onClick={handleQboConnect}
              loading={qboConnecting}
              disabled={!settings.qboClientId || !settings.qboClientSecret}
              className="mb-4"
            >
              Connect to QuickBooks Online
            </Button>
          )}

          {qboError && (
            <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-3">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-sans">{qboError}</pre>
            </div>
          )}
        </section>}

        {/* Categories */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <FolderOpen size={16} className="text-blue-500" /> Categories
            </h2>
            {!catAdding && (
              <button
                type="button"
                onClick={() => { setCatAdding(true); setCatEditId(null) }}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
              >
                <Plus size={13} /> Add
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">Organise products into categories for easier browsing.</p>

          <div className="space-y-2">
            {categories.map((cat) => (
              <div key={cat.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                {catEditId === cat.id ? (
                  <div className="space-y-2">
                    <input
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={catEditName}
                      onChange={(e) => setCatEditName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleCatUpdate()}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_COLORS.map((c) => (
                        <ColorDot key={c} color={c} selected={catEditColor === c} onClick={() => setCatEditColor(c)} />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleCatUpdate} loading={catSaving} icon={<Check size={12} />}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setCatEditId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => { setCatEditId(cat.id); setCatEditName(cat.name); setCatEditColor(cat.color); setCatAdding(false) }}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded"
                        aria-label="Edit"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCatDelete(cat)}
                        className="p-1 text-gray-400 hover:text-red-500 rounded"
                        aria-label="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {catAdding && (
              <div className="border border-blue-200 rounded-xl p-3 bg-blue-50 space-y-2">
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Category name"
                  value={catNewName}
                  onChange={(e) => setCatNewName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCatAdd()}
                />
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <ColorDot key={c} color={c} selected={catNewColor === c} onClick={() => setCatNewColor(c)} />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCatAdd} loading={catSaving} icon={<Check size={12} />}>Add</Button>
                  <Button size="sm" variant="ghost" onClick={() => setCatAdding(false)} icon={<X size={12} />}>Cancel</Button>
                </div>
              </div>
            )}

            {categories.length === 0 && !catAdding && (
              <p className="text-sm text-gray-400 text-center py-4">No categories yet — add one above.</p>
            )}
          </div>
        </section>

        {/* Peripherals */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Peripherals</h2>
          <p className="text-xs text-gray-500 mb-5">
            Customer-facing displays show cart contents and totals in real time.
          </p>

          {/* Display Appearance */}
          <div className="mb-6 pb-5 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-3">Display Appearance</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Background Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={settings.displayBgColor ?? '#0f172a'} onChange={(e) => setSettings((p) => ({ ...p, displayBgColor: e.target.value }))} className="h-10 w-16 cursor-pointer rounded border border-gray-300" />
                  <input type="text" value={settings.displayBgColor ?? '#0f172a'} onChange={(e) => setSettings((p) => ({ ...p, displayBgColor: e.target.value }))} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-32 font-mono" placeholder="#0f172a" />
                  <button type="button" onClick={() => setSettings((p) => ({ ...p, displayBgColor: '#0f172a' }))} className="text-xs text-gray-500 hover:text-gray-700 underline">Reset</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Background Image</label>
                <p className="text-xs text-gray-500 mb-2">Shown behind content on the customer display. Max 2 MB.</p>
                {settings.displayBgImage ? (
                  <div className="flex items-center gap-3">
                    <img src={settings.displayBgImage} alt="Display BG" className="h-16 w-28 object-cover rounded-lg border border-gray-200" />
                    <button type="button" onClick={() => { setSettings((p) => ({ ...p, displayBgImage: '' })); api.settings.set('displayBgImage', '').catch(() => {}) }} className="text-xs text-red-500 hover:text-red-700 underline">Remove</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 border border-gray-300 transition-colors">Upload Image</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 2 * 1024 * 1024) { showToast('Image too large (max 2 MB)', 'error'); return }
                      const reader = new FileReader()
                      reader.onload = (ev) => {
                        const b64 = ev.target?.result as string
                        setSettings((p) => ({ ...p, displayBgImage: b64 }))
                        api.settings.set('displayBgImage', b64).catch(() => {})
                      }
                      reader.readAsDataURL(file)
                    }} />
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Second-screen Electron window */}
          <div className="flex items-start justify-between py-3 border-b border-gray-100 mb-3">
            <div className="flex items-start gap-3">
              <Monitor size={18} className="text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-800">Second Screen Display</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Opens a fullscreen customer-facing window on a connected second monitor.
                </p>
                {displayWindowOpen && (
                  <span className="inline-flex items-center gap-1 mt-1 text-xs text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                    Display window is open
                  </span>
                )}
              </div>
            </div>
            <Button
              variant={displayWindowOpen ? 'secondary' : 'primary'}
              size="sm"
              onClick={handleToggleDisplayWindow}
              loading={displayLoading}
              className="shrink-0"
            >
              {displayWindowOpen ? 'Close Display' : 'Open Display'}
            </Button>
          </div>

          {/* Network display */}
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                {networkRunning
                  ? <Wifi size={18} className="text-blue-500 mt-0.5 shrink-0" />
                  : <WifiOff size={18} className="text-gray-400 mt-0.5 shrink-0" />
                }
                <div>
                  <p className="text-sm font-medium text-gray-800">Network Display</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Serves a display page over Wi-Fi — open on any tablet, iPad, or price pole
                    connected to the same network.
                  </p>
                  {networkRunning && (
                    <span className="inline-flex items-center gap-1 mt-1 text-xs text-emerald-600 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      Running on port {networkPort}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant={networkRunning ? 'secondary' : 'primary'}
                size="sm"
                onClick={handleToggleNetwork}
                loading={networkLoading}
                className="shrink-0"
              >
                {networkRunning ? 'Stop' : 'Start'}
              </Button>
            </div>

            {!networkRunning && (
              <div className="ml-7 max-w-[160px]">
                <Input
                  label="Port"
                  type="number"
                  min="1024"
                  max="65535"
                  value={networkPort}
                  onChange={(e) => setNetworkPort(e.target.value)}
                  placeholder="3031"
                />
              </div>
            )}

            {networkRunning && (
              <div className="ml-7 bg-gray-50 border border-gray-200 rounded-xl p-4 flex gap-5 items-start">
                <QrCode url={`http://${localIp}:${networkPort}`} size={128} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 mb-1">Display URL</p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-1.5 flex-1 truncate">
                      http://{localIp}:{networkPort}
                    </code>
                    <a
                      href={`http://${localIp}:${networkPort}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500"
                      title="Open in browser"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Scan the QR code from any device on the same Wi-Fi network.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    The page auto-updates with every cart change — no app install needed.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
