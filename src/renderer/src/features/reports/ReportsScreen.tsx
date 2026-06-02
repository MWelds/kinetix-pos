import React, { useState, useEffect, useRef } from 'react'
import { BarChart3, TrendingUp, Download, RefreshCw, Cloud, ChevronDown, Check, AlertCircle, Monitor } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, PageSpinner } from '../../components/ui'
import { useCurrencyStore, } from '../../stores/currency.store'
import { CURRENCIES } from '../../lib/currency'
import { startOfDay, endOfDay, toISODate } from '../../lib/dates'
import type { SalesSummary } from '../../types'

type DatePreset = 'today' | 'week' | 'month'

function getDateRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date()
  const to = toISODate(endOfDay(now))
  if (preset === 'today') return { from: toISODate(startOfDay(now)), to }
  if (preset === 'week') {
    const from = new Date(now)
    from.setDate(from.getDate() - 6)
    return { from: toISODate(startOfDay(from)), to }
  }
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: toISODate(startOfDay(from)), to }
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface ExportOption {
  label: string
  description: string
  fn: () => Promise<void>
}

export function ReportsScreen() {
  const fmtRaw = useCurrencyStore((s) => s.fmtRaw)
  const [preset, setPreset] = useState<DatePreset>('today')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [byProduct, setByProduct] = useState<{ productName: string; quantity: number; revenue: number }[]>([])
  const [byStaff, setByStaff] = useState<{ name: string; orderCount: number; revenue: number }[]>([])
  const [byTerminal, setByTerminal] = useState<{ terminalId: string; orderCount: number; revenue: number }[]>([])
  const [payments, setPayments] = useState<{ method: string; currency: string; count: number; total: number; originalTotal: number }[]>([])

  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  const [qboConnected, setQboConnected] = useState(false)
  const [qboCompany, setQboCompany] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    api.qbo.status().then((s) => {
      setQboConnected(s.connected)
      setQboCompany(s.companyName ?? null)
    }).catch(() => {})
  }, [])

  async function load() {
    setLoading(true)
    const { from, to } = getDateRange(preset)
    try {
      const [s, p, st, pay, term] = await Promise.all([
        api.reports.salesSummary(from, to),
        api.reports.salesByProduct(from, to),
        api.reports.salesByStaff(from, to),
        api.reports.paymentBreakdown(from, to),
        api.reports.salesByTerminal(from, to)
      ])
      setSummary(s)
      setByProduct(p as typeof byProduct)
      setByStaff(st as typeof byStaff)
      setPayments(pay as typeof payments)
      setByTerminal(term as typeof byTerminal)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [preset])

  const { from, to } = getDateRange(preset)
  const presetLabel = preset === 'today' ? 'today' : preset === 'week' ? 'this-week' : 'this-month'

  const exportOptions: ExportOption[] = [
    {
      label: 'Sales Summary CSV',
      description: 'Product-level sales for the selected period',
      fn: async () => {
        const rows = [
          ['Product', 'Units Sold', 'Revenue'],
          ...byProduct.map((p) => [p.productName, String(p.quantity), p.revenue.toFixed(2)])
        ]
        downloadFile(rows.map((r) => r.join(',')).join('\n'), `sales-summary-${presetLabel}.csv`, 'text/csv')
      }
    },
    {
      label: 'Transactions CSV',
      description: 'Full transaction detail, one row per line item',
      fn: async () => {
        const csv = await api.accounting.transactionsCsv(from, to)
        downloadFile(csv, `transactions-${presetLabel}.csv`, 'text/csv')
      }
    },
    {
      label: 'Daily Summary CSV',
      description: 'Revenue totals grouped by day',
      fn: async () => {
        const csv = await api.accounting.dailySummaryCsv(from, to)
        downloadFile(csv, `daily-summary-${presetLabel}.csv`, 'text/csv')
      }
    },
    {
      label: 'QuickBooks IIF',
      description: 'Import into QuickBooks Desktop (IIF format)',
      fn: async () => {
        const iif = await api.accounting.iif(from, to)
        downloadFile(iif, `transactions-${presetLabel}.iif`, 'text/plain')
      }
    }
  ]

  async function handleExport(option: ExportOption) {
    setExportOpen(false)
    setExporting(true)
    try { await option.fn() }
    catch (err) {
      setSyncMessage({ type: 'error', text: `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}` })
      setTimeout(() => setSyncMessage(null), 4000)
    } finally { setExporting(false) }
  }

  async function handleQboSync() {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const [salesResult, custResult] = await Promise.all([api.qbo.syncSales(), api.qbo.syncCustomers()])
      const salesCount = (salesResult as { synced?: number }).synced ?? 0
      const custCount = (custResult as { synced?: number }).synced ?? 0
      setSyncMessage({ type: 'success', text: `Synced ${salesCount} sale(s) and ${custCount} customer(s) to QuickBooks.` })
      setTimeout(() => setSyncMessage(null), 5000)
    } catch (err) {
      setSyncMessage({ type: 'error', text: `Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}` })
      setTimeout(() => setSyncMessage(null), 5000)
    } finally { setSyncing(false) }
  }

  function terminalLabel(id: string): string {
    if (!id || id === 'unknown') return 'Unknown Register'
    if (/^[0-9a-f-]{36}$/i.test(id)) return `Register ${id.slice(0, 8).toUpperCase()}`
    return id
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg overflow-hidden border border-gray-300">
              {(['today', 'week', 'month'] as DatePreset[]).map((p) => (
                <button key={p} onClick={() => setPreset(p)}
                  className={`px-4 py-2 text-sm font-medium capitalize ${preset === p ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                  {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
                </button>
              ))}
            </div>

            {qboConnected && (
              <button
                onClick={handleQboSync}
                disabled={syncing}
                title={`Sync to QuickBooks${qboCompany ? ` (${qboCompany})` : ''}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-green-50 border border-green-300 text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
              >
                {syncing ? <RefreshCw size={14} className="animate-spin" /> : <Cloud size={14} />}
                {syncing ? 'Syncing…' : 'Sync to QBO'}
              </button>
            )}

            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen((o) => !o)}
                disabled={exporting}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                Export
                <ChevronDown size={12} className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
              </button>
              {exportOpen && (
                <div className="absolute right-0 mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
                  {exportOptions.map((opt) => (
                    <button key={opt.label} onClick={() => handleExport(opt)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors">
                      <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {syncMessage && (
          <div className={`mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
            syncMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {syncMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
            {syncMessage.text}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? <PageSpinner /> : (
          <>
            {summary && (
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Orders', value: summary.orderCount, color: 'blue' },
                  { label: 'Revenue', value: fmtRaw(summary.totalRevenue), color: 'emerald' },
                  { label: 'Avg Order', value: fmtRaw(summary.averageOrderValue), color: 'purple' },
                  { label: 'Discounts', value: fmtRaw(summary.totalDiscount), color: 'amber' }
                ].map((card) => (
                  <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{card.label}</p>
                    <p className={`text-2xl font-bold mt-1 text-${card.color}-600`}>{card.value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <BarChart3 size={16} className="text-blue-600" />
                  <h2 className="text-sm font-semibold text-gray-700">Top Products</h2>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50"><tr>
                    {['Product', 'Units', 'Revenue'].map(h => <th key={h} className="px-4 py-2 text-left text-xs text-gray-500">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {byProduct.slice(0, 10).map((p) => (
                      <tr key={p.productName} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm text-gray-800">{p.productName}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{p.quantity}</td>
                        <td className="px-4 py-2 text-sm font-medium">{fmtRaw(p.revenue)}</td>
                      </tr>
                    ))}
                    {!byProduct.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-sm">No sales</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <TrendingUp size={16} className="text-emerald-600" />
                  <h2 className="text-sm font-semibold text-gray-700">Payment Methods</h2>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">Method</th>
                    <th className="px-4 py-2 text-center text-xs text-gray-500">Txns</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">Received</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {payments.map((p) => (
                      <tr key={`${p.method}|${p.currency}`} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="text-sm text-gray-800 capitalize font-medium">{p.method.replace(/_/g, ' ')}</span>
                            <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{p.currency}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-500 text-center">{p.count}</td>
                        <td className="px-4 py-2.5 text-sm font-bold text-gray-900 text-right">
                          {CURRENCIES[p.currency]?.symbol ?? p.currency}{p.originalTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {!payments.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-sm">No payments</td></tr>}
                  </tbody>
                  {payments.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td className="px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide" colSpan={2}>Total</td>
                        <td className="px-4 py-2.5 text-right">
                          {(() => {
                            const byCur = new Map<string, number>()
                            for (const p of payments) byCur.set(p.currency, (byCur.get(p.currency) ?? 0) + p.originalTotal)
                            return Array.from(byCur.entries()).map(([cur, total]) => (
                              <div key={cur} className="text-sm font-bold text-gray-900">
                                {CURRENCIES[cur]?.symbol ?? cur}{total.toFixed(2)}
                                <span className="text-[10px] text-gray-400 ml-1">{cur}</span>
                              </div>
                            ))
                          })()}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-700">Sales by Staff</h2>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50"><tr>
                    {['Staff', 'Orders', 'Revenue'].map(h => <th key={h} className="px-4 py-2 text-left text-xs text-gray-500">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {byStaff.map((s) => (
                      <tr key={s.name} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-800">{s.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{s.orderCount}</td>
                        <td className="px-4 py-2 text-sm font-medium">{fmtRaw(s.revenue)}</td>
                      </tr>
                    ))}
                    {!byStaff.length && <tr><td colSpan={