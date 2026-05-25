import React, { useState, useEffect } from 'react'
import {
  Sun, DollarSign, CreditCard, Printer, CheckCircle,
  AlertTriangle, X, ChevronRight, ChevronLeft, TrendingUp, ShoppingBag, LogOut
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../stores/auth.store'
import { formatCurrency } from '../../lib/currency'
import { useCurrencyStore } from '../../stores/currency.store'
import { Button } from '../../components/ui'
import { startOfDay, toISODate } from '../../lib/dates'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../constants'

interface Props {
  isOpen: boolean
  onClose: () => void
}

type Step = 'cash' | 'summary' | 'confirm'

interface DaySummary {
  orderCount: number
  totalRevenue: number
  totalDiscount: number
  averageOrderValue: number
  /** Raw payment breakdown from the DB */
  paymentRows: { method: string; count: number; total: number }[]
}

/** One cash-count entry per method × currency that the cashier fills in */
interface CountEntry {
  method: string
  currency: 'USD' | 'KYD'
  label: string
  counted: string
  /** Expected amount from actual sales (USD, since all DB amounts are USD) */
  expectedUSD: number
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  store_credit: 'Store Credit',
  gift_card: 'Gift Card',
  layaway: 'Layaway',
}

const KYD_TO_USD_DEFAULT = 1.2

/** Receipt-style HTML for the end-of-day print */
function buildEodReceiptHtml(
  storeName: string,
  summary: DaySummary,
  entries: CountEntry[],
  openedAt: string,
  kydRate: number,
  closingNote?: string
): string {
  const now = new Date().toLocaleString()
  const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`

  const countedUSD = entries.reduce((s, e) => {
    const val = parseFloat(e.counted) || 0
    return s + (e.currency === 'KYD' ? val / kydRate : val)
  }, 0)
  const expectedUSD = entries.reduce((s, e) => s + e.expectedUSD, 0)
  const variance = countedUSD - expectedUSD

  const entryRows = entries
    .map((e) => {
      const val = parseFloat(e.counted) || 0
      return `<div class="row"><span class="label">${e.label} (${e.currency})</span><span>${e.currency === 'KYD' ? 'KYD' : '$'}${val.toFixed(2)}</span></div>`
    })
    .join('')

  return `<!DOCTYPE html><html><head><style>
    body { font-family: monospace; font-size: 12px; width: 280px; margin: 0 auto; }
    h2 { text-align: center; font-size: 14px; margin: 8px 0 4px; }
    .sub { text-align: center; font-size: 11px; color: #555; margin-bottom: 12px; }
    hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; margin: 3px 0; }
    .label { color: #555; }
    .total { font-weight: bold; font-size: 13px; }
    .variance { color: ${variance >= 0 ? 'green' : 'red'}; }
    .center { text-align: center; }
  </style></head><body>
    <h2>${storeName}</h2>
    <div class="sub">END OF DAY REPORT</div>
    <div class="sub">${now}</div>
    <hr/>
    <div class="row"><span class="label">Shift opened</span><span>${new Date(openedAt).toLocaleTimeString()}</span></div>
    <div class="row"><span class="label">Orders</span><span>${summary.orderCount}</span></div>
    <hr/>
    <div class="row"><span class="label">Discounts</span><span>-${fmt(summary.totalDiscount)}</span></div>
    <div class="row total"><span>NET REVENUE</span><span>${fmt(summary.totalRevenue)}</span></div>
    <hr/>
    <div class="sub" style="text-align:left;font-weight:bold;margin-bottom:4px">CASH COUNT</div>
    ${entryRows}
    <hr/>
    <div class="row"><span class="label">Expected</span><span>${fmt(expectedUSD)}</span></div>
    <div class="row"><span class="label">Counted</span><span>${fmt(countedUSD)}</span></div>
    <div class="row variance"><span>Variance</span><span>${variance >= 0 ? '+' : ''}${fmt(variance)}</span></div>
    <hr/>
    ${closingNote ? `<hr/><div style="font-size:11px;color:#555;word-break:break-word"><strong>Note:</strong> ${closingNote}</div>` : ''}
    <div class="center" style="margin-top:8px; font-size:11px; color:#777">Shift closed — have a great evening!</div>
  </body></html>`
}

export function EndOfDayModal({ isOpen, onClose }: Props) {
  const { staff, shift, logout } = useAuthStore()
  const { kydToUsdRate } = useCurrencyStore()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('cash')
  const [summary, setSummary] = useState<DaySummary | null>(null)
  const [entries, setEntries] = useState<CountEntry[]>([])
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [closing, setClosing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [storeName, setStoreName] = useState('Kinetix POS')
  const [enabledMethods, setEnabledMethods] = useState<string[]>(['cash', 'card'])
  /** Optional free-text note attached to this shift close */
  const [closingNote, setClosingNote] = useState('')

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setStep('cash')
      setSummary(null)
      setEntries([])
      setClosingNote('')
    }
  }, [isOpen])

  // Load store settings when opened
  useEffect(() => {
    if (!isOpen) return
    api.settings.getAll().then((s) => {
      if (s.storeName) setStoreName(s.storeName)
      if (s.enabledPaymentMethods) {
        try {
          const methods = JSON.parse(s.enabledPaymentMethods) as string[]
          setEnabledMethods(methods)
        } catch { /* use default */ }
      }
    }).catch(() => {})
  }, [isOpen])

  /** Build the count-entry rows based on enabled methods × currencies */
  function buildEntries(paymentRows: { method: string; total: number }[]): CountEntry[] {
    const rows: CountEntry[] = []
    const physicalMethods = enabledMethods.filter((m) => ['cash', 'card'].includes(m))
    // Also include store_credit / gift_card / layaway as USD-only totals
    const otherMethods = enabledMethods.filter((m) => !['cash', 'card'].includes(m))

    for (const method of physicalMethods) {
      const expectedUSD = paymentRows.find((r) => r.method === method)?.total ?? 0
      // USD entry
      rows.push({
        method,
        currency: 'USD',
        label: `${METHOD_LABELS[method] ?? method} (USD)`,
        counted: '',
        expectedUSD: expectedUSD,
      })
      // KYD entry — share the same expected total since DB stores USD; cashier enters what they see
      rows.push({
        method,
        currency: 'KYD',
        label: `${METHOD_LABELS[method] ?? method} (KYD)`,
        counted: '',
        expectedUSD: 0, // KYD counted is converted on reconciliation
      })
    }

    for (const method of otherMethods) {
      const expectedUSD = paymentRows.find((r) => r.method === method)?.total ?? 0
      rows.push({
        method,
        currency: 'USD',
        label: METHOD_LABELS[method] ?? method,
        counted: '',
        expectedUSD,
      })
    }

    return rows
  }

  async function loadSummary() {
    setLoadingSummary(true)
    try {
      const now = new Date()
      const from = toISODate(startOfDay(now))
      const to = now.toISOString()
      const [sales, payments] = await Promise.all([
        api.reports.salesSummary(from, to),
        api.reports.paymentBreakdown(from, to)
      ])
      const payArr = payments as { method: string; count: number; total: number }[]
      const s = sales as { orderCount: number; totalRevenue: number; totalDiscount: number; averageOrderValue: number }
      const daySummary: DaySummary = {
        orderCount: s.orderCount,
        totalRevenue: s.totalRevenue,
        totalDiscount: s.totalDiscount,
        averageOrderValue: s.averageOrderValue,
        paymentRows: payArr,
      }
      setSummary(daySummary)
      setEntries(buildEntries(payArr))
    } finally {
      setLoadingSummary(false)
    }
  }

  async function handleNextFromCash() {
    await loadSummary()
    setStep('summary')
  }

  function updateEntry(index: number, counted: string) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, counted } : e)))
  }

  /** Total counted in USD (KYD entries converted) */
  const totalCountedUSD = entries.reduce((s, e) => {
    const val = parseFloat(e.counted) || 0
    return s + (e.currency === 'KYD' ? val / (kydToUsdRate || KYD_TO_USD_DEFAULT) : val)
  }, 0)

  const totalExpectedUSD = summary
    ? summary.paymentRows.reduce((s, r) => s + r.total, 0)
    : 0

  const variance = totalCountedUSD - totalExpectedUSD
  const variancePositive = variance >= 0

  async function handlePrint() {
    if (!summary) return
    setPrinting(true)
    try {
      const openedAt = shift?.openedAt ?? new Date().toISOString()
      const html = buildEodReceiptHtml(storeName, summary, entries, openedAt, kydToUsdRate || KYD_TO_USD_DEFAULT, closingNote || undefined)
      const result = await api.receipt.print(html)
      if (!result?.success) throw new Error('Print returned failure')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      alert(`Print failed: ${msg}. Make sure a printer is configured in Settings.`)
    } finally {
      setPrinting(false)
    }
  }

  async function handleCloseDay() {
    setClosing(true)
    try {
      if (shift) {
        const cashCount = entries
          .map((e) => `${e.label}: ${e.counted || '0'}`)
          .join(', ')
        const notesParts = [
          `EOD close. Variance: ${variancePositive ? '+' : ''}$${Math.abs(variance).toFixed(2)}.`,
          cashCount,
          closingNote ? `Note: ${closingNote}` : ''
        ].filter(Boolean)
        await api.shifts.close(shift.id, totalCountedUSD, notesParts.join(' '))
      }
      logout()
      navigate(ROUTES.LOGIN)
      onClose()
    } finally {
      setClosing(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-6 py-5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <Sun size={18} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">End of Day</h2>
                <p className="text-gray-400 text-xs">
                  {staff?.firstName} {staff?.lastName} &middot; {new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-2 mt-4">
            {(['cash', 'summary', 'confirm'] as Step[]).map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-2 text-xs font-medium ${step === s ? 'text-white' : step === 'confirm' || (step === 'summary' && i === 0) ? 'text-emerald-400' : 'text-gray-600'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === s ? 'bg-amber-500 text-white' : step === 'confirm' || (step === 'summary' && i === 0) ? 'bg-emerald-500 text-white' : 'bg-gray-700 text-gray-500'}`}>
                    {(step === 'confirm' || (step === 'summary' && i === 0)) ? '✓' : i + 1}
                  </div>
                  <span className="hidden sm:inline">{s === 'cash' ? 'Cash Count' : s === 'summary' ? 'Day Summary' : 'Close & Sign Out'}</span>
                </div>
                {i < 2 && <div className="flex-1 h-px bg-gray-700" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="p-6 overflow-y-auto flex-1">

          {/* ── Step 1: Cash Count per method × currency ── */}
          {step === 'cash' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Count your drawer</h3>
                <p className="text-xs text-gray-500">Enter the physical amount for each payment type and currency. Leave blank if none collected.</p>
              </div>

              {shift && (
                <div className="bg-gray-50 rounded-xl p-4 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Shift opened</span>
                    <span className="font-medium text-gray-900">{new Date(shift.openedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              )}

              {/* We show entry fields after summary loads, or show placeholder rows up front */}
              {entries.length === 0 ? (
                /* Before loading, show input rows based on enabled methods */
                <div className="space-y-3">
                  {enabledMethods.filter((m) => ['cash', 'card'].includes(m)).flatMap((method) =>
                    (['USD', 'KYD'] as const).map((cur) => (
                      <div key={`${method}-${cur}`} className="flex items-center gap-3">
                        <div className="w-28 shrink-0">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${cur === 'USD' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                            {cur === 'USD' ? <DollarSign size={11} /> : <span className="text-[10px]">CI$</span>}
                            {METHOD_LABELS[method]} {cur}
                          </span>
                        </div>
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{cur === 'KYD' ? 'CI$' : '$'}</span>
                          <input
                            type="number" min="0" step="0.01" placeholder="0.00"
                            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    ))
                  )}
                  {enabledMethods.filter((m) => !['cash', 'card'].includes(m)).map((method) => (
                    <div key={method} className="flex items-center gap-3">
                      <div className="w-28 shrink-0">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700">
                          {METHOD_LABELS[method] ?? method}
                        </span>
                      </div>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input
                          type="number" min="0" step="0.01" placeholder="0.00"
                          className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {entries.map((entry, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-28 shrink-0">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          entry.currency === 'USD' ? 'bg-blue-50 text-blue-700' :
                          entry.currency === 'KYD' ? 'bg-emerald-50 text-emerald-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {entry.currency === 'USD' ? <DollarSign size={11} /> : entry.currency === 'KYD' ? <span className="text-[10px]">CI$</span> : null}
                          {entry.label}
                        </span>
                      </div>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                          {entry.currency === 'KYD' ? 'CI$' : '$'}
                        </span>
                        <input
                          type="number" min="0" step="0.01" placeholder="0.00"
                          value={entry.counted}
                          onChange={(e) => updateEntry(i, e.target.value)}
                          className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="w-20 text-right shrink-0">
                        <p className="text-[10px] text-gray-400">Expected</p>
                        <p className="text-xs font-semibold text-gray-600">${entry.expectedUSD.toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={handleNextFromCash} loading={loadingSummary} icon={<ChevronRight size={14} />}>
                  View Day Summary
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 2: Day Summary ── */}
          {step === 'summary' && summary && (
            <div className="space-y-5">
              <h3 className="text-sm font-semibold text-gray-900">Today's performance</h3>

              {/* KPI row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Orders', value: String(summary.orderCount), icon: <ShoppingBag size={14} />, color: 'blue' },
                  { label: 'Revenue', value: formatCurrency(summary.totalRevenue), icon: <TrendingUp size={14} />, color: 'emerald' },
                  { label: 'Avg Order', value: formatCurrency(summary.averageOrderValue), icon: <DollarSign size={14} />, color: 'purple' }
                ].map((k) => (
                  <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className={`text-${k.color}-500 flex justify-center mb-1`}>{k.icon}</div>
                    <p className="text-lg font-bold text-gray-900">{k.value}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">{k.label}</p>
                  </div>
                ))}
              </div>

              {/* Payment breakdown from DB */}
              {summary.paymentRows.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sales by Payment Method</p>
                  {summary.paymentRows.map((row) => (
                    <div key={row.method} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-gray-600">
                        {row.method === 'cash' ? <DollarSign size={13} /> : <CreditCard size={13} />}
                        {METHOD_LABELS[row.method] ?? row.method}
                        <span className="text-xs text-gray-400">×{row.count}</span>
                      </span>
                      <span className="font-medium text-gray-900">{formatCurrency(row.total)}</span>
                    </div>
                  ))}
                  {summary.totalDiscount > 0 && (
                    <div className="flex items-center justify-between text-sm border-t border-gray-200 pt-2 mt-2">
                      <span className="text-gray-500">Discounts given</span>
                      <span className="text-amber-600 font-medium">-{formatCurrency(summary.totalDiscount)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Cash count summary */}
              <div className={`rounded-xl p-4 border ${variancePositive ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center gap-2 mb-3">
                  {variancePositive
                    ? <CheckCircle size={14} className="text-emerald-600" />
                    : <AlertTriangle size={14} className="text-red-600" />}
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Reconciliation</p>
                </div>
                <div className="space-y-1 text-sm mb-3">
                  {entries.map((e, i) => {
                    const val = parseFloat(e.counted) || 0
                    return val > 0 ? (
                      <div key={i} className="flex justify-between text-gray-600">
                        <span>{e.label}</span>
                        <span>{e.currency === 'KYD' ? 'CI$' : '$'}{val.toFixed(2)}</span>
                      </div>
                    ) : null
                  })}
                </div>
                <div className="space-y-1 text-sm border-t border-gray-200 pt-2">
                  <div className="flex justify-between text-gray-600">
                    <span>Expected (USD)</span><span>${totalExpectedUSD.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Counted (USD equiv.)</span><span>${totalCountedUSD.toFixed(2)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold pt-1 border-t ${variancePositive ? 'border-emerald-200 text-emerald-700' : 'border-red-200 text-red-700'}`}>
                    <span>Variance</span>
                    <span>{variancePositive ? '+' : ''}${variance.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button onClick={() => setStep('cash')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
                  <ChevronLeft size={14} /> Back
                </button>
                <div className="flex gap-2">
                  <Button variant="secondary" icon={<Printer size={14} />} onClick={handlePrint} loading={printing}>
                    Print Report
                  </Button>
                  <Button icon={<ChevronRight size={14} />} onClick={() => setStep('confirm')}>
                    Continue
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Confirm & Close ── */}
          {step === 'confirm' && (
            <div className="space-y-5">
              <div className="text-center py-2">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                  <Sun size={28} className="text-amber-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Ready to close?</h3>
                <p className="text-sm text-gray-500 mt-1">
                  This will close the shift and sign you out of the register.
                </p>
              </div>

              {summary && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Total orders today</span><span className="font-medium text-gray-900">{summary.orderCount}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Net revenue</span><span className="font-medium text-gray-900">{formatCurrency(summary.totalRevenue)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Total counted (USD equiv.)</span><span className="font-medium text-gray-900">${totalCountedUSD.toFixed(2)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold pt-2 border-t border-gray-200 ${variancePositive ? 'text-emerald-600' : 'text-red-600'}`}>
                    <span>Cash variance</span>
                    <span>{variancePositive ? '+' : ''}${variance.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {!variancePositive && Math.abs(variance) > 1 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>Drawer is short by ${Math.abs(variance).toFixed(2)}. This will be recorded in the shift report.</span>
                </div>
              )}

              {/* Closing note */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Shift Note <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={closingNote}
                  onChange={(e) => setClosingNote(e.target.value)}
                  placeholder="e.g. Busy evening, printer jam at 7pm, left $200 float in drawer…"
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button onClick={() => setStep('summary')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
                  <ChevronLeft size={14} /> Back
                </button>
                <Button
                  onClick={handleCloseDay}
                  loading={closing}
                  icon={<LogOut size={14} />}
                  className="bg-red-600 hover:bg-red-700 text-white border-red-600"
                >
                  End Day & Sign Out
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
