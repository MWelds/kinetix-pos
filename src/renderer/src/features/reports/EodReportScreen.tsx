import React, { useState, useEffect } from 'react'
import { Sun, Printer, RefreshCw, TrendingUp, DollarSign, CreditCard, Monitor } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, PageSpinner } from '../../components/ui'
import { useCurrencyStore } from '../../stores/currency.store'
import { CURRENCIES } from '../../lib/currency'
import { startOfDay, endOfDay, toISODate } from '../../lib/dates'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', store_credit: 'Store Credit',
  gift_card: 'Gift Card', layaway: 'Layaway',
}

interface PaymentRow {
  method: string
  currency: string
  count: number
  /** Accounting total in store (primary) currency */
  total: number
  /** Sum of original amounts tendered in this currency (what customers actually handed over) */
  originalTotal: number
}

interface TerminalSummary {
  terminalId: string
  terminalName: string
  orderCount: number
  totalRevenue: number
  totalDiscount: number
  paymentRows: PaymentRow[]
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildEodReceiptHtml(
  storeName: string,
  dateLabel: string,
  terminals: TerminalSummary[],
  totalRevenue: number,
  totalOrders: number,
  payments: PaymentRow[],
  primarySymbol: string
): string {
  const fmt = (n: number) => `${primarySymbol}${Math.abs(n).toFixed(2)}`
  const now = new Date().toLocaleString()

  // Per-currency totals from payments
  const byCur = new Map<string, number>()
  for (const p of payments) byCur.set(p.currency, (byCur.get(p.currency) ?? 0) + p.originalTotal)
  const currencyTotals = Array.from(byCur.entries())
    .map(([cur, total]) => {
      const sym = esc(CURRENCIES[cur]?.symbol ?? cur)
      return `<div class="row bold"><span>${esc(cur)}</span><span>${sym}${total.toFixed(2)}</span></div>`
    }).join('')

  const terminalRows = terminals.length >= 2
    ? terminals.map((t) => `
        <div style="margin-bottom:6px">
          <div class="bold">${esc(t.terminalName)}</div>
          <div class="row"><span class="label">Orders</span><span>${t.orderCount}</span></div>
          <div class="row bold"><span>Revenue</span><span>${fmt(t.totalRevenue)}</span></div>
          ${t.paymentRows.map((p) => {
            const sym = esc(CURRENCIES[p.currency]?.symbol ?? p.currency)
            return `<div class="row"><span class="label" style="padding-left:8px">&#8627; ${esc(METHOD_LABELS[p.method] ?? p.method)} (${esc(p.currency)}) &times;${p.count}</span><span>${sym}${p.originalTotal.toFixed(2)}</span></div>`
          }).join('')}
        </div>`).join('')
    : ''

  const paymentRows = payments.map((p) => {
    const sym = esc(CURRENCIES[p.currency]?.symbol ?? p.currency)
    return `<div class="row"><span>${esc(METHOD_LABELS[p.method] ?? p.method)} (${esc(p.currency)}) &times;${p.count}</span><span>${sym}${p.originalTotal.toFixed(2)}</span></div>`
  }).join('')

  return `<!DOCTYPE html><html><head><style>
    body { font-family: monospace; font-size: 12px; width: 280px; margin: 0 auto; }
    h2 { text-align: center; font-size: 15px; font-weight: bold; margin: 8px 0 2px; }
    .center { text-align: center; }
    .meta { text-align: center; font-size: 10px; color: #777; margin-bottom: 3px; }
    hr { border: none; border-top: 1px dashed #bbb; margin: 7px 0; }
    .section { font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: .08em; color: #444; margin: 4px 0 3px; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }
    .label { color: #666; }
    .bold { font-weight: bold; }
    .big { font-size: 14px; font-weight: bold; }
  </style></head><body>
    <h2>${esc(storeName)}</h2>
    <div class="meta">END OF DAY &bull; ${esc(dateLabel)}</div>
    <div class="meta">${esc(now)}</div>
    <hr/>
    <div class="row"><span class="label">Orders</span><span>${totalOrders}</span></div>
    <div class="row big"><span>Net Revenue</span><span>${fmt(totalRevenue)}</span></div>
    ${terminals.length >= 2 ? `<hr/><div class="section">By Register</div>${terminalRows}<div class="row bold"><span>Combined</span><span>${fmt(totalRevenue)}</span></div>` : ''}
    <hr/>
    <div class="section">Payments</div>
    ${paymentRows}
    <hr/>
    ${currencyTotals}
    <div class="center meta" style="margin-top:6px">End of Day &mdash; ${esc(dateLabel)}</div>
  </body></html>`
}

export function EodReportScreen() {
  const { fmtRaw, currency: primaryCurrency } = useCurrencyStore()
  const primarySym = CURRENCIES[primaryCurrency]?.symbol ?? primaryCurrency

  const [eodDate, setEodDate] = useState(() => toISODate(new Date()))
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [storeName, setStoreName] = useState('My Store')

  const [terminals, setTerminals] = useState<TerminalSummary[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [totalOrders, setTotalOrders] = useState(0)
  const [totalDiscount, setTotalDiscount] = useState(0)

  useEffect(() => {
    api.settings.get('storeName').then((n) => { if (n) setStoreName(n) }).catch(() => {})
  }, [])

  async function load() {
    setLoading(true)
    try {
      // Parse the date at noon local time to avoid timezone edge cases
      const d = new Date(eodDate + 'T12:00:00')
      const from = toISODate(startOfDay(d))
      const to = toISODate(endOfDay(d))
      const [eod, pay, summary] = await Promise.all([
        api.reports.eodByTerminal(from, to),
        api.reports.paymentBreakdown(from, to),
        api.reports.salesSummary(from, to),
      ])
      const eodTyped = eod as { terminals: TerminalSummary[] }
      const summaryTyped = summary as { orderCount: number; totalRevenue: number; totalDiscount: number }
      const payTyped = pay as PaymentRow[]
      setTerminals(eodTyped.terminals ?? [])
      setPayments(payTyped)
      setTotalRevenue(summaryTyped.totalRevenue)
      setTotalOrders(summaryTyped.orderCount)
      setTotalDiscount(summaryTyped.totalDiscount)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [eodDate])

  async function handlePrint() {
    setPrinting(true)
    try {
      const dateLabel = new Date(eodDate + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })
      const html = buildEodReceiptHtml(
        storeName, dateLabel, terminals, totalRevenue, totalOrders, payments, primarySym
      )
      const result = await api.receipt.print(html)
      if (!result?.success) throw new Error('Printer returned failure')
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : 'Unknown error'}. Check printer in Settings.`)
    } finally {
      setPrinting(false)
    }
  }

  const fmt = (n: number) => fmtRaw(n)
  const isMultiTerminal = terminals.length >= 2
  const dateLabel = new Date(eodDate + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  })

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", background: '#f0f4f8' }}>
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
              <Sun size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">End of Day Report</h1>
              <p className="text-xs text-slate-400 font-medium mt-0.5">{dateLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={eodDate}
              onChange={(e) => setEodDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white text-slate-700"
            />
            <button
              onClick={load}
              title="Refresh"
              className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-500 transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <Button
              icon={<Printer size={14} />}
              onClick={handlePrint}
              loading={printing}
              disabled={loading || totalOrders === 0}
              className="bg-amber-500 hover:bg-amber-600 text-white border-0"
            >
              Print Report
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {loading ? <PageSpinner /> : (
          <>
            {/* Day totals banner */}
            <div className="rounded-2xl overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0f2744 60%, #162d4a 100%)' }}>
              <div className="px-6 pt-5 pb-4">
                <p className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-4">Combined Day Total</p>
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className="text-xs text-blue-300 font-medium mb-1 uppercase tracking-wide">Total Orders</p>
                    <p className="text-4xl font-black text-white">{totalOrders}</p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-300 font-medium mb-1 uppercase tracking-wide">Net Revenue</p>
                    <p className="text-4xl font-black text-emerald-400">{fmt(totalRevenue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-blue-300 font-medium mb-1 uppercase tracking-wide">Discounts Given</p>
                    <p className="text-4xl font-black text-amber-400">{fmt(totalDiscount)}</p>
                  </div>
                </div>
              </div>

              {payments.length > 0 && (
                <div className="mx-6 mb-5 mt-2 rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <p className="text-[10px] font-bold text-blue-300 uppercase tracking-widest mb-3">Payment Breakdown</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {payments.map((p) => (
                      <div key={`${p.method}|${p.currency}`} className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-slate-300 text-sm">
                          {p.method === 'cash' ? <DollarSign size={11} /> : <CreditCard size={11} />}
                          <span className="font-medium">{METHOD_LABELS[p.method] ?? p.method}</span>
                          <span className="text-[10px] font-bold text-blue-400 bg-blue-900/40 px-1.5 py-0.5 rounded">{p.currency}</span>
                          <span className="text-slate-500 text-xs">×{p.count}</span>
                        </span>
                        <span className="font-bold text-white text-sm">
                          {CURRENCIES[p.currency]?.symbol ?? p.currency}{p.originalTotal.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {totalOrders === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
                <Sun size={36} className="text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 font-medium">No sales for this day</p>
                <p className="text-gray-400 text-sm mt-1">Select a different date or check that orders have been synced.</p>
              </div>
            )}

            {/* Per-register breakdown — only when 2+ terminals */}
            {isMultiTerminal && (
              <div>
                <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Monitor size={14} className="text-indigo-500" /> Sales by Register
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  {terminals.map((t) => (
                    <div key={t.terminalId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Monitor size={14} className="text-indigo-500" />
                          <span className="text-sm font-semibold text-gray-900">{t.terminalName}</span>
                        </div>
                        <span className="text-sm font-bold text-indigo-700">{fmt(t.totalRevenue)}</span>
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Orders</span>
                          <span className="font-medium text-gray-900">{t.orderCount}</span>
                        </div>
                        {t.paymentRows.map((p) => (
                          <div key={`${p.method}|${p.currency}`} className="flex justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-gray-500">
                              {p.method === 'cash' ? <DollarSign size={11} /> : <CreditCard size={11} />}
                              {METHOD_LABELS[p.method] ?? p.method}
                              <span className="text-gray-400 text-xs font-semibold">{p.currency}</span>
                              <span className="text-gray-400 text-xs">×{p.count}</span>
                            </span>
                            <span className="font-medium text-gray-700">
                              {CURRENCIES[p.currency]?.symbol ?? p.currency}{p.originalTotal.toFixed(2)}
                            </span>
                          </div>
                        ))}
                        {t.totalDiscount > 0 && (
                          <div className="flex justify-between text-sm border-t border-gray-100 pt-2">
                            <span className="text-amber-600">Discounts</span>
                            <span className="font-medium text-amber-600">-{fmt(t.totalDiscount)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 bg-gray-900 rounded-xl px-5 py-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">All Registers Combined</span>
                  <span className="text-lg font-bold text-white">{fmt(totalRevenue)}</span>
                </div>
              </div>
            )}

            {/* Payment method table — simplified */}
            {payments.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-slate-100">
                <div className="px-5 py-3.5 flex items-center gap-2 border-b border-slate-100" style={{ background: 'linear-gradient(to right, #f8fafc, #f1f5f9)' }}>
                  <TrendingUp size={15} className="text-emerald-600" />
                  <h2 className="text-sm font-bold text-slate-700 tracking-tight">Payment Breakdown</h2>
                </div>
                <table className="w-full">
                  <thead>
                    <tr style={{ backg