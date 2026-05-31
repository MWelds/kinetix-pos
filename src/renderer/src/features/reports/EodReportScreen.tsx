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

interface TerminalSummary {
  terminalId: string
  terminalName: string
  orderCount: number
  totalRevenue: number
  totalDiscount: number
  paymentRows: { method: string; count: number; total: number }[]
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
  payments: { method: string; count: number; total: number }[],
  primarySymbol: string
): string {
  const fmt = (n: number) => `${primarySymbol}${Math.abs(n).toFixed(2)}`
  const now = new Date().toLocaleString()

  const terminalRows = terminals.length >= 2
    ? terminals.map((t) => `
        <div style="margin-bottom:10px;padding-bottom:6px;border-bottom:1px dashed #ccc">
          <div style="font-weight:bold;font-size:12px;margin-bottom:3px">&#9632; ${esc(t.terminalName)}</div>
          <div style="display:flex;justify-content:space-between"><span>Orders</span><span>${t.orderCount}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:bold"><span>Revenue</span><span>${fmt(t.totalRevenue)}</span></div>
          ${t.paymentRows.map((p) =>
            `<div style="display:flex;justify-content:space-between;color:#555;font-size:11px;padding-left:8px">
              <span>&#8627; ${esc(METHOD_LABELS[p.method] ?? p.method)} &times;${p.count}</span>
              <span>${fmt(p.total)}</span>
            </div>`
          ).join('')}
          ${t.totalDiscount > 0
            ? `<div style="display:flex;justify-content:space-between;color:#b45309;font-size:11px;padding-left:8px"><span>&#8627; Discounts</span><span>-${fmt(t.totalDiscount)}</span></div>`
            : ''}
        </div>
      `).join('')
    : ''

  const paymentRows = payments.map((p) =>
    `<div style="display:flex;justify-content:space-between">
      <span>${esc(METHOD_LABELS[p.method] ?? p.method)} &times;${p.count}</span>
      <span>${fmt(p.total)}</span>
    </div>`
  ).join('')

  return `<!DOCTYPE html><html><head><style>
    body { font-family: monospace; font-size: 12px; width: 280px; margin: 0 auto; }
    h2 { text-align: center; font-size: 14px; margin: 8px 0 2px; }
    .sub { text-align: center; font-size: 11px; color: #555; margin-bottom: 6px; }
    hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
    .section-label { font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 5px; }
    .total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; margin-top: 4px; }
  </style></head><body>
    <h2>${esc(storeName)}</h2>
    <div class="sub">END OF DAY REPORT</div>
    <div class="sub">${esc(dateLabel)}</div>
    <div class="sub" style="font-size:10px">${esc(now)}</div>
    <hr/>
    ${terminals.length >= 2 ? `<div class="section-label">By Register</div>${terminalRows}<hr/>` : ''}
    <div class="section-label">Payment Summary</div>
    ${paymentRows}
    <hr/>
    <div style="display:flex;justify-content:space-between"><span>Total Orders</span><span>${totalOrders}</span></div>
    <div class="total-row"><span>TOTAL REVENUE</span><span>${fmt(totalRevenue)}</span></div>
    <hr/>
    <div style="text-align:center;font-size:10px;color:#777;margin-top:6px">End of Day &mdash; ${esc(dateLabel)}</div>
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
  const [payments, setPayments] = useState<{ method: string; count: number; total: number }[]>([])
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
      const payTyped = pay as { method: string; count: number; total: number }[]
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
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
              <Sun size={18} className="text-amber-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">End of Day Report</h1>
              <p className="text-xs text-gray-500">{dateLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={eodDate}
              onChange={(e) => setEodDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={load}
              title="Refresh"
              className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600 transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <Button
              icon={<Printer size={14} />}
              onClick={handlePrint}
              loading={printing}
              disabled={loading || totalOrders === 0}
            >
              Print Report
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? <PageSpinner /> : (
          <>
            {/* Day totals banner */}
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl p-6 text-white">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
                Combined Day Total
              </p>
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Total Orders</p>
                  <p className="text-3xl font-bold">{totalOrders}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Net Revenue</p>
                  <p className="text-3xl font-bold text-emerald-400">{fmt(totalRevenue)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Discounts Given</p>
                  <p className="text-3xl font-bold text-amber-400">{fmt(totalDiscount)}</p>
                </div>
              </div>

              {payments.length > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-700 grid grid-cols-2 gap-2">
                  {payments.map((p) => (
                    <div key={p.method} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-gray-300">
                        {p.method === 'cash' ? <DollarSign size={12} /> : <CreditCard size={12} />}
                        {METHOD_LABELS[p.method] ?? p.method}
                        <span className="text-gray-500 text-xs">×{p.count}</span>
                      </span>
                      <span className="font-semibold">{fmt(p.total)}</span>
                    </div>
                  ))}
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
                          <div key={p.method} className="flex justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-gray-500">
                              {p.method === 'cash' ? <DollarSign size={11} /> : <CreditCard size={11} />}
                              {METHOD_LABELS[p.method] ?? p.method}
                              <span className="text-gray-400 text-xs">×{p.count}</span>
                            </span>
                            <span className="font-medium text-gray-700">{fmt(p.total)}</span>
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

            {/* Payment method table */}
            {payments.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <TrendingUp size={15} className="text-emerald-600" />
                  <h2 className="text-sm font-semibold text-gray-700">Payment Method Breakdown</h2>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Method', 'Transactions', 'Total'].map((h) => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {payments.map((p) => (
                      <tr key={p.method} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-800">
                          <span className="flex items-center gap-2">
                            {p.method === 'cash'
                              ? <DollarSign size={13} className="text-gray-400" />
                              : <CreditCard size={13} className="text-gray-400" />}
                            {METHOD_LABELS[p.method] ?? p.method}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{p.count}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900">{fmt(p.total)}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">Total</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-700">
                        {payments.reduce((s, p) => s + p.count, 0)}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">{fmt(totalRevenue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
