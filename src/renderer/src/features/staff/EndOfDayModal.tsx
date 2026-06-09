import React, { useState, useEffect } from 'react'
import {
  Sun, DollarSign, CreditCard, Printer, CheckCircle,
  AlertTriangle, X, ChevronRight, ChevronLeft, TrendingUp, ShoppingBag, LogOut, Truck,
  Monitor
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../stores/auth.store'
import { formatCurrency, CURRENCIES } from '../../lib/currency'
import { useCurrencyStore } from '../../stores/currency.store'
import { Button } from '../../components/ui'
import { startOfDay, toISODate } from '../../lib/dates'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../constants'
import type { VendorPayable } from '../../types'

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
  /** Raw payment breakdown from the DB, grouped by method + currency */
  paymentRows: { method: string; currency: string; count: number; total: number; originalTotal: number; changeTotal: number }[]
}

interface TerminalSummary {
  terminalId: string
  terminalName: string
  orderCount: number
  totalRevenue: number
  totalDiscount: number
  paymentRows: { method: string; currency: string; count: number; total: number; originalTotal: number; changeTotal: number }[]
}

/** One cash-count entry per method × currency that the cashier fills in */
interface CountEntry {
  method: string
  /** Currency code, e.g. 'USD', 'KYD', 'EUR' — driven by Settings */
  currency: string
  label: string
  counted: string
  /** Expected amount from actual sales (primary currency, since all DB amounts are in primary) */
  expectedPrimary: number
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  store_credit: 'Store Credit',
  gift_card: 'Gift Card',
  layaway: 'Layaway',
}

interface CurrencyConfig {
  primary: string
  secondary: string
  rate: number
}

/** Get the display symbol for a currency code */
function currencySymbol(code: string): string {
  return CURRENCIES[code]?.symbol ?? code
}

/** Escape a string for safe insertion into HTML context */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Receipt-style HTML for the end-of-day print */
function buildEodReceiptHtml(
  storeName: string,
  summary: DaySummary,
  entries: CountEntry[],
  openedAt: string,
  cfg: CurrencyConfig,
  vendorPayables: VendorPayable[],
  terminals: TerminalSummary[],
  closingNote?: string,
  openingFloat?: number,
  closingFloatAmt?: number
): string {
  const now = new Date().toLocaleString()
  const primarySym = currencySymbol(cfg.primary)
  const fmt = (n: number) => `${primarySym}${Math.abs(n).toFixed(2)}`

  // Convert entry amount from its currency to primary using the same rate.
  const entryToPrimary = (amount: number, currency: string) => {
    if (currency === cfg.primary) return amount
    return cfg.rate > 0 ? amount / cfg.rate : amount
  }

  // Convert all counted amounts to primary for reconciliation
  const countedPrimary = entries.reduce((s, e) => {
    const val = parseFloat(e.counted) || 0
    return s + entryToPrimary(val, e.currency)
  }, 0)

  // Use the same rate conversion so matched individual amounts produce zero variance
  const expectedPrimary = entries.reduce((s, e) => {
    return s + entryToPrimary(e.expectedPrimary, e.currency)
  }, 0)
  const variance = countedPrimary - expectedPrimary

  // Reconciliation rows: one per entry, expected vs counted side by side
  const recoRows = entries.map((e) => {
    const counted = parseFloat(e.counted) || 0
    const sym = esc(currencySymbol(e.currency))
    const diff = counted - e.expectedPrimary
    const diffStr = Math.abs(diff) >= 0.01
      ? ` <span style="color:${diff >= 0 ? 'green' : 'red'}">(${diff > 0 ? '+' : ''}${sym}${diff.toFixed(2)})</span>`
      : ''
    return `<div class="row">
      <span class="label">${esc(e.label)}</span>
      <span>${sym}${e.expectedPrimary.toFixed(2)} &rarr; ${sym}${counted.toFixed(2)}${diffStr}</span>
    </div>`
  }).join('')

  // Currency totals (cash drawer)
  const currencies = [...new Set(entries.map((e) => e.currency))]
  const currencyTotals = currencies.map((cur) => {
    const sym = esc(currencySymbol(cur))
    const counted = entries.filter((e) => e.currency === cur).reduce((s, e) => s + (parseFloat(e.counted) || 0), 0)
    return `<div class="row bold"><span>${esc(cur)} Cash Counted</span><span>${sym}${counted.toFixed(2)}</span></div>`
  }).join('')

  // Sales breakdown by currency and method
  const allCurrencies = [...new Set(summary.paymentRows.map((r) => r.currency))]
  const salesByCurrency = allCurrencies.map((cur) => {
    const sym = esc(currencySymbol(cur))
    const cashTotal = summary.paymentRows.filter((r) => r.method === 'cash' && r.currency === cur).reduce((s, r) => s + r.originalTotal, 0)
    const cardTotal = summary.paymentRows.filter((r) => r.method === 'card' && r.currency === cur).reduce((s, r) => s + r.originalTotal, 0)
    const total = summary.paymentRows.filter((r) => r.currency === cur).reduce((s, r) => s + r.originalTotal, 0)
    return `
      <div class="section">${esc(cur)} Sales</div>
      <div class="row"><span class="label">Cash</span><span>${sym}${cashTotal.toFixed(2)}</span></div>
      <div class="row"><span class="label">Card</span><span>${sym}${cardTotal.toFixed(2)}</span></div>
      <div class="row bold"><span>Total ${esc(cur)}</span><span>${sym}${total.toFixed(2)}</span></div>`
  }).join('<hr/>')

  const totalVendorCogs = vendorPayables.reduce((s, v) => s + v.cogsToday, 0)
  const vendorSection = vendorPayables.length > 0
    ? `<hr/><div class="section">VENDOR PAYABLES</div>
       ${vendorPayables.map((v) =>
         `<div class="row"><span class="label">${esc(v.vendorName)}</span><span>${fmt(v.cogsToday)}</span></div>`
       ).join('')}
       <div class="row bold"><span>Total COGS</span><span>${fmt(totalVendorCogs)}</span></div>`
    : ''

  const terminalSection = terminals.length >= 2
    ? `<hr/><div class="section">BY REGISTER</div>
       ${terminals.map((t) => `
         <div style="margin-bottom:6px">
           <div class="bold">${esc(t.terminalName)}</div>
           <div class="row"><span class="label">Orders</span><span>${t.orderCount}</span></div>
           <div class="row"><span class="label">Revenue</span><span>${fmt(t.totalRevenue)}</span></div>
           ${t.paymentRows.map((p) => {
             const sym = esc(currencySymbol(p.currency))
             return `<div class="row"><span class="label" style="padding-left:8px">&#8627; ${esc(METHOD_LABELS[p.method] ?? p.method)} (${esc(p.currency)}) &times;${p.count}</span><span>${sym}${p.originalTotal.toFixed(2)}</span></div>`
           }).join('')}
         </div>`).join('')}
       <div class="row bold"><span>Combined</span><span>${fmt(summary.totalRevenue)}</span></div>`
    : ''

  return `<!DOCTYPE html><html><head><style>
    body { font-family: monospace; font-size: 12px; width: 280px; margin: 0 auto; }
    h2 { text-align: center; font-size: 15px; font-weight: bold; margin: 8px 0 2px; }
    .center { text-align: center; }
    .meta { text-align: center; font-size: 10px; color: #777; margin-bottom: 4px; }
    hr { border: none; border-top: 1px dashed #bbb; margin: 7px 0; }
    .section { font-weight: bold; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #444; margin: 4px 0 3px; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; font-size: 12px; }
    .label { color: #666; }
    .bold { font-weight: bold; }
    .big { font-size: 14px; font-weight: bold; }
    .variance { font-weight: bold; color: ${variance >= 0 ? 'green' : 'red'}; }
  </style></head><body>
    <h2>${esc(storeName)}</h2>
    <div class="meta">END OF DAY &bull; ${esc(now)}</div>
    <div class="meta">Shift opened ${new Date(openedAt).toLocaleTimeString()}</div>
    <hr/>
    <div class="row"><span class="label">Orders</span><span>${summary.orderCount}</span></div>
    ${summary.totalDiscount > 0 ? `<div class="row"><span class="label">Discounts</span><span>-${fmt(summary.totalDiscount)}</span></div>` : ''}
    <div class="row big"><span>Net Revenue</span><span>${fmt(summary.totalRevenue)}</span></div>
    <hr/>
    ${salesByCurrency}
    ${terminalSection}
    <hr/>
    <div class="section">Reconciliation &mdash; Expected &rarr; Counted</div>
    ${recoRows}
    <hr/>
    ${currencyTotals}
    <div class="row variance"><span>Variance</span><span>${variance >= 0 ? '+' : ''}${fmt(variance)}</span></div>
    ${vendorSection}
    ${(closingFloatAmt != null && closingFloatAmt >= 0) ? `
    <hr/>
    <div class="section">Cash Reconciliation</div>
    ${openingFloat != null && openingFloat > 0 ? `<div class="row"><span class="label">Opening float</span><span>${fmt(openingFloat)}</span></div>` : ''}
    <div class="row"><span class="label">Float left in drawer</span><span>${fmt(closingFloatAmt)}</span></div>
    <div class="row bold"><span>Cash to Deposit</span><span>${fmt(Math.max(0, countedPrimary - closingFloatAmt))}</span></div>
    ` : ''}
    ${closingNote ? `<hr/><div style="font-size:11px;color:#555;word-break:break-word"><strong>Note:</strong> ${esc(closingNote)}</div>` : ''}
    <hr/>
    <div class="center meta">Have a great evening!</div>
  </body></html>`
}

/**
 * Build the count-entry rows for cash reconciliation only.
 *
 * Only CASH is included — card payments are processed electronically and are
 * never physically in the cash drawer, so comparing them to a counted amount
 * always produces a false "short" variance. Card totals are shown as
 * informational on the summary screen instead.
 */
function buildEntries(
  paymentRows: { method: string; currency: string; total: number; originalTotal: number; changeTotal: number }[],
  enabledMethods: string[],
  cfg: CurrencyConfig
): CountEntry[] {
  const rows: CountEntry[] = []

  // Sum store-currency totals for a method (primary rows)
  const totalFor = (method: string, currency: string) =>
    paymentRows.filter((r) => r.method === method && r.currency === currency).reduce((s, r) => s + r.total, 0)

  // Sum original amounts for a method+currency (what customers physically handed over)
  const originalTotalFor = (method: string, currency: string) =>
    paymentRows.filter((r) => r.method === method && r.currency === currency).reduce((s, r) => s + r.originalTotal, 0)

  // Sum change given for a method across ALL currencies.
  // changeGiven is always stored in primary (store) currency, so we sum it all to
  // reduce the primary-currency cash expected — regardless of what the customer paid in.
  const changeTotalForMethod = (method: string) =>
    paymentRows.filter((r) => r.method === method).reduce((s, r) => s + r.changeTotal, 0)

  // Only reconcile cash — it's the only thing physically in the drawer
  if (enabledMethods.includes('cash')) {
    // Net primary cash in drawer = tendered (primary) − all change given back (always primary currency)
    const primTendered = totalFor('cash', cfg.primary)
    const totalChange  = changeTotalForMethod('cash')
    const primExpected = primTendered - totalChange
    rows.push({
      method: 'cash',
      currency: cfg.primary,
      label: `Cash (${cfg.primary})`,
      counted: '',
      expectedPrimary: primExpected,
    })

    if (cfg.secondary) {
      // Secondary-currency cash: customers hand over foreign notes; change is always
      // returned in primary, so the physical secondary drawer = full amount tendered.
      const secOriginal = originalTotalFor('cash', cfg.secondary)
      rows.push({
        method: 'cash',
        currency: cfg.secondary,
        label: `Cash (${cfg.secondary})`,
        counted: '',
        expectedPrimary: secOriginal,
      })
    }
  }

  // Non-cash physical methods like store credit / gift cards that may have
  // a physical component (e.g. a gift card ledger to reconcile)
  const otherMethods = enabledMethods.filter((m) => m !== 'cash' && m !== 'card')
  for (const method of otherMethods) {
    const expectedPrimary = totalFor(method, cfg.primary)
    rows.push({
      method,
      currency: cfg.primary,
      label: METHOD_LABELS[method] ?? method,
      counted: '',
      expectedPrimary,
    })
  }

  return rows
}

export function EndOfDayModal({ isOpen, onClose }: Props) {
  const { staff, shift, logout, setShift } = useAuthStore()
  const { currency: primaryCurrency, kydToUsdRate, altCurrency } = useCurrencyStore()
  const secondaryCurrency = altCurrency()
  const navigate = useNavigate()

  const currencyCfg: CurrencyConfig = {
    primary: primaryCurrency,
    secondary: secondaryCurrency,
    rate: kydToUsdRate || 1,
  }

  const [step, setStep] = useState<Step>('cash')
  const [summary, setSummary] = useState<DaySummary | null>(null)
  const [entries, setEntries] = useState<CountEntry[]>([])
  const [vendorPayables, setVendorPayables] = useState<VendorPayable[]>([])
  const [terminals, setTerminals] = useState<TerminalSummary[]>([])
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [closing, setClosing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [storeName, setStoreName] = useState('')
  const [enabledMethods, setEnabledMethods] = useState<string[]>(['cash', 'card'])
  /** Optional free-text note attached to this shift close */
  const [closingNote, setClosingNote] = useState('')
  /** Cash float to leave in the drawer for the next shift */
  const [closingFloat, setClosingFloat] = useState('')

  // Reset and load when opened
  useEffect(() => {
    if (!isOpen) return
    setStep('cash')
    setSummary(null)
    setEntries([])
    setVendorPayables([])
    setTerminals([])
    setClosingNote('')
    // Pre-fill closing float with the opening cash amount from this shift
    setClosingFloat(shift?.openingCash != null && shift.openingCash > 0 ? String(shift.openingCash) : '')

    // Load store settings first, then immediately load summary so the
    // cash-count inputs are real state-backed fields from the start.
    // This prevents typed values from being lost when advancing steps.
    api.settings.getAll().then((s) => {
      if (s.storeName) setStoreName(s.storeName)
      let methods = ['cash', 'card']
      if (s.enabledPaymentMethods) {
        try { methods = JSON.parse(s.enabledPaymentMethods) as string[] } catch { /* use default */ }
      }
      setEnabledMethods(methods)
      // Now load the day summary with the correct payment methods
      loadSummaryWithMethods(methods)
    }).catch(() => {})
  }, [isOpen])

  async function loadSummaryWithMethods(methods: string[]) {
    setLoadingSummary(true)
    try {
      const now = new Date()
      const from = toISODate(startOfDay(now))
      const to = now.toISOString()
      const [sales, payments, payables, eodTerminals] = await Promise.all([
        api.reports.salesSummary(from, to),
        api.reports.paymentBreakdown(from, to),
        api.reports.vendorPayables(from, to),
        api.reports.eodByTerminal(from, to)
      ])
      const payArr = payments as { method: string; currency: string; count: number; total: number; originalTotal: number }[]
      const s = sales as { orderCount: number; totalRevenue: number; totalDiscount: number; averageOrderValue: number }
      const daySummary: DaySummary = {
        orderCount: s.orderCount,
        totalRevenue: s.totalRevenue,
        totalDiscount: s.totalDiscount,
        averageOrderValue: s.averageOrderValue,
        paymentRows: payArr,
      }
      setSummary(daySummary)
      // Preserve any already-typed counted values if entries already exist
      setEntries((prev) => {
        const fresh = buildEntries(payArr, methods, currencyCfg)
        if (prev.length === 0) return fresh
        // Merge: keep counted values from current state, update expectedPrimary from DB
        return fresh.map((f) => {
          const existing = prev.find((p) => p.method === f.method && p.currency === f.currency)
          return existing ? { ...f, counted: existing.counted } : f
        })
      })
      setVendorPayables(payables)
      setTerminals(eodTerminals.terminals)
    } finally {
      setLoadingSummary(false)
    }
  }

  function handleNextFromCash() {
    // Summary is already loaded on open — just advance the step.
    // If for some reason it failed to load, try again.
    if (!summary) {
      loadSummaryWithMethods(enabledMethods).then(() => setStep('summary')).catch(() => {})
    } else {
      setStep('summary')
    }
  }

  function updateEntry(index: number, counted: string) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, counted } : e)))
  }

  /** Convert an amount from an entry's currency to primary, using the same rate as counted totals. */
  const toPrimary = (amount: number, currency: string) => {
    if (currency === primaryCurrency) return amount
    return currencyCfg.rate > 0 ? amount / currencyCfg.rate : amount
  }

  /** Total counted in primary currency (secondary entries converted via rate) */
  const totalCountedPrimary = entries.reduce((s, e) => {
    const val = parseFloat(e.counted) || 0
    return s + toPrimary(val, e.currency)
  }, 0)

  /**
   * Total expected in primary currency — uses the SAME rate conversion as counted
   * so that when individual amounts match, the totals also match and variance is 0.
   * Using the DB accounting totals directly would cause discrepancies because
   * the stored KYD amount uses the rate at checkout time (which may differ from
   * the current rate), causing a phantom variance when the cashier is correct.
   */
  const totalExpectedPrimary = entries.reduce((s, e) => {
    return s + toPrimary(e.expectedPrimary, e.currency)
  }, 0)

  const variance = totalCountedPrimary - totalExpectedPrimary
  const variancePositive = variance >= 0

  const closingFloatAmount = parseFloat(closingFloat) || 0
  /** Cash collected = total counted cash − float left in drawer */
  const cashOnlyCounted = entries
    .filter((e) => e.method === 'cash')
    .reduce((s, e) => s + (toPrimary(parseFloat(e.counted) || 0, e.currency)), 0)
  const cashToDeposit = Math.max(0, cashOnlyCounted - closingFloatAmount)

  const primarySym = currencySymbol(primaryCurrency)

  /** Whether to show the per-terminal breakdown (only meaningful when 2+ registers) */
  const isMultiTerminal = terminals.length >= 2

  async function handlePrint() {
    if (!summary) return
    setPrinting(true)
    try {
      const openedAt = shift?.openedAt ?? new Date().toISOString()
      const html = buildEodReceiptHtml(
        storeName, summary, entries, openedAt, currencyCfg,
        vendorPayables, terminals, closingNote || undefined,
        (shift?.openingCash as number) ?? 0,
        closingFloatAmount
      )
      const result = await api.receipt.print(html)
      if (!result?.success) throw new Error('Print returned failure')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      alert(`Print failed: ${msg}. Make sure a printer is configured in Settings.`)
    } finally {
      setPrinting(false)
    }
  }

  /** Build the shift close note shared by both close actions */
  function buildCloseNote(): string {
    const cashCount = entries.map((e) => `${e.label}: ${e.counted || '0'}`).join(', ')
    return [
      `EOD close. Variance: ${variancePositive ? '+' : ''}${primarySym}${Math.abs(variance).toFixed(2)}.`,
      cashCount,
      closingNote ? `Note: ${closingNote}` : ''
    ].filter(Boolean).join(' ')
  }

  /** Close shift AND sign the cashier out */
  async function handleCloseDay() {
    setClosing(true)
    try {
      if (shift) {
        await api.shifts.close(shift.id, totalCountedPrimary, buildCloseNote(), staff?.id)
      }
      logout()
      navigate(ROUTES.LOGIN)
      onClose()
    } finally {
      setClosing(false)
    }
  }

  /** Close shift but stay logged in (e.g. manager stays on POS after closing) */
  async function handleCloseShiftOnly() {
    setClosing(true)
    try {
      if (shift) {
        await api.shifts.close(shift.id, totalCountedPrimary, buildCloseNote(), staff?.id)
      }
      setShift(null)  // clear shift from auth store so UI reflects it as closed
      onClose()
    } finally {
      setClosing(false)
    }
  }

  /** Badge color class for a given currency code */
  function currencyBadgeClass(code: string): string {
    if (code === primaryCurrency) return 'bg-blue-50 text-blue-700'
    if (code === secondaryCurrency) return 'bg-emerald-50 text-emerald-700'
    return 'bg-gray-100 text-gray-700'
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
                <p className="text-slate-400 text-xs">
                  {staff?.firstName} {staff?.lastName} &middot; {new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-2 mt-4">
            {(['cash', 'summary', 'confirm'] as Step[]).map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-2 text-xs font-medium ${step === s ? 'text-white' : step === 'confirm' || (step === 'summary' && i === 0) ? 'text-emerald-400' : 'text-slate-600'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === s ? 'bg-amber-500 text-white' : step === 'confirm' || (step === 'summary' && i === 0) ? 'bg-emerald-500 text-white' : 'bg-gray-700 text-slate-500'}`}>
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
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Count your cash drawer</h3>
                <p className="text-xs text-gray-500">Enter the total cash in the drawer. Card payments are processed electronically and don't need to be counted.</p>
              </div>

              {shift && (
                <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1.5">
                  <div className="flex justify-between text-gray-600">
                    <span>Shift opened</span>
                    <span className="font-medium text-gray-900">{new Date(shift.openedAt).toLocaleTimeString()}</span>
                  </div>
                  {(shift.openingCash ?? 0) > 0 && (
                    <div className="flex justify-between text-gray-600">
                      <span>Opening float</span>
                      <span className="font-medium text-gray-900">{primarySym}{(shift.openingCash as number).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Before summary loads, show placeholder rows based on enabled methods */}
              {entries.length === 0 ? (
                <div className="space-y-3">
                  {enabledMethods.filter((m) => ['cash', 'card'].includes(m)).flatMap((method) => {
                    const currencies = secondaryCurrency
                      ? [primaryCurrency, secondaryCurrency]
                      : [primaryCurrency]
                    return currencies.map((cur) => (
                      <div key={`${method}-${cur}`} className="flex items-center gap-3">
                        <div className="w-28 shrink-0">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${currencyBadgeClass(cur)}`}>
                            <span className="text-[10px]">{currencySymbol(cur)}</span>
                            {METHOD_LABELS[method]} {cur}
                          </span>
                        </div>
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{currencySymbol(cur)}</span>
                          <input
                            type="number" min="0" step="0.01" placeholder="0.00"
                            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    ))
                  })}
                  {enabledMethods.filter((m) => !['cash', 'card'].includes(m)).map((method) => (
                    <div key={method} className="flex items-center gap-3">
                      <div className="w-28 shrink-0">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700">
                          {METHOD_LABELS[method] ?? method}
                        </span>
                      </div>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{primarySym}</span>
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
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${currencyBadgeClass(entry.currency)}`}>
                          <span className="text-[10px]">{currencySymbol(entry.currency)}</span>
                          {entry.label}
                        </span>
                      </div>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                          {currencySymbol(entry.currency)}
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
                        <p className="text-xs font-semibold text-gray-600">
                          {currencySymbol(entry.currency)}{entry.expectedPrimary.toFixed(2)}
                        </p>
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
              <h3 className="text-sm font-semibold text-gray-900">
                {isMultiTerminal ? 'Combined day performance — all registers' : "Today's performance"}
              </h3>

              {/* KPI row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Orders', value: String(summary.orderCount), icon: <ShoppingBag size={14} />, color: 'blue' },
                  { label: 'Revenue', value: formatCurrency(summary.totalRevenue, primaryCurrency), icon: <TrendingUp size={14} />, color: 'emerald' },
                  { label: 'Avg Order', value: formatCurrency(summary.averageOrderValue, primaryCurrency), icon: <DollarSign size={14} />, color: 'purple' }
                ].map((k) => (
                  <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className={`text-${k.color}-500 flex justify-center mb-1`}>{k.icon}</div>
                    <p className="text-lg font-bold text-gray-900">{k.value}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">{k.label}</p>
                  </div>
                ))}
              </div>

              {/* Multi-terminal per-register breakdown */}
              {isMultiTerminal && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Monitor size={12} /> Sales by Register
                  </p>
                  {terminals.map((t) => (
                    <div key={t.terminalId} className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Monitor size={13} className="text-indigo-500" />
                          <span className="text-sm font-semibold text-gray-900">{t.terminalName}</span>
                        </div>
                        <span className="text-sm font-bold text-indigo-700">{formatCurrency(t.totalRevenue, primaryCurrency)}</span>
                      </div>
                      <div className="space-y-1 text-xs text-gray-600">
                        <div className="flex justify-between">
                          <span>Orders</span>
                          <span className="font-medium">{t.orderCount}</span>
                        </div>
                        {t.paymentRows.map((p) => (
                          <div key={`${p.method}|${p.currency}`} className="flex justify-between">
                            <span className="flex items-center gap-1.5">
                              {p.method === 'cash' ? <DollarSign size={10} /> : <CreditCard size={10} />}
                              {METHOD_LABELS[p.method] ?? p.method}
                              <span className="text-gray-400 text-xs font-semibold">{p.currency}</span>
                              <span className="text-gray-400">×{p.count}</span>
                            </span>
                            <span>{formatCurrency(p.total, primaryCurrency)}</span>
                          </div>
                        ))}
                        {t.totalDiscount > 0 && (
                          <div className="flex justify-between text-amber-600 border-t border-indigo-100 pt-1 mt-1">
                            <span>Discounts</span>
                            <span>-{formatCurrency(t.totalDiscount, primaryCurrency)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Combined total bar */}
                  <div className="bg-gray-900 rounded-xl p-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">All Registers Combined</span>
                    <span className="text-base font-bold text-white">{formatCurrency(summary.totalRevenue, primaryCurrency)}</span>
                  </div>
                </div>
              )}

              {/* Payment breakdown — totals in both currencies */}
              {summary.paymentRows.length > 0 && (() => {
                const priSym = currencySymbol(primaryCurrency)
                const secSym = secondaryCurrency ? currencySymbol(secondaryCurrency) : null
                const sumBy = (method: string | null, currency: string) =>
                  summary.paymentRows
                    .filter((r) => (method ? r.method === method : true) && r.currency === currency)
                    .reduce((s, r) => s + r.originalTotal, 0)
                const rows = [
                  { label: 'Total Sales', icon: <TrendingUp size={13} />, bold: true },
                  { label: 'Cash',        icon: <DollarSign size={13} />,  bold: false },
                  { label: 'Card',        icon: <CreditCard size={13} />,  bold: false },
                ]
                const methodKey = (label: string) =>
                  label === 'Cash' ? 'cash' : label === 'Card' ? 'card' : null
                return (
                  <div className="bg-gray-50 rounded-xl overflow-hidden">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 pt-3 pb-2">
                      {isMultiTerminal ? 'Payment Totals — All Registers' : 'Sales by Payment Method'}
                    </p>
                    {/* Header */}
                    <div className="grid px-4 pb-1 border-b border-gray-200"
                      style={{ gridTemplateColumns: secSym ? '1fr auto auto' : '1fr auto' }}>
                      <span className="text-[10px] font-bold text-gray-400 uppercase"></span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase text-right w-24">{primaryCurrency}</span>
                      {secSym && <span className="text-[10px] font-bold text-gray-400 uppercase text-right w-24">{secondaryCurrency}</span>}
                    </div>
                    {rows.map(({ label, icon, bold }) => {
                      const mk = methodKey(label)
                      const priTotal = sumBy(mk, primaryCurrency)
                      const secTotal = secSym ? sumBy(mk, secondaryCurrency!) : 0
                      return (
                        <div key={label}
                          className={`grid px-4 py-2 text-sm border-b border-gray-100 last:border-0 ${bold ? 'bg-white font-semibold' : ''}`}
                          style={{ gridTemplateColumns: secSym ? '1fr auto auto' : '1fr auto' }}>
                          <span className={`flex items-center gap-2 ${bold ? 'text-gray-900' : 'text-gray-600'}`}>
                            {icon}{label}
                          </span>
                          <span className={`text-right w-24 ${bold ? 'text-gray-900' : 'text-gray-700'}`}>
                            {priSym}{priTotal.toFixed(2)}
                          </span>
                          {secSym && (
                            <span className={`text-right w-24 ${bold ? 'text-gray-900' : 'text-gray-700'}`}>
                              {secSym}{secTotal.toFixed(2)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                    {summary.totalDiscount > 0 && (
                      <div className="flex items-center justify-between text-sm px-4 py-2 border-t border-gray-200">
                        <span className="text-gray-500">Discounts given</span>
                        <span className="text-amber-600 font-medium">-{formatCurrency(summary.totalDiscount, primaryCurrency)}</span>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Vendor payables */}
              {vendorPayables.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <Truck size={14} className="text-orange-600" />
                    <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Vendor Payables — Today's COGS</p>
                  </div>
                  {vendorPayables.map((v) => (
                    <div key={v.vendorId} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{v.vendorName}</span>
                      <div className="text-right">
                        <span className="font-medium text-gray-900">{formatCurrency(v.cogsToday, primaryCurrency)}</span>
                        <span className="text-xs text-gray-400 ml-1.5">({v.unitsSold} units)</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between font-semibold pt-2 border-t border-orange-200 text-orange-800">
                    <span>Total Cost of Goods</span>
                    <span>{formatCurrency(vendorPayables.reduce((s, v) => s + v.cogsToday, 0), primaryCurrency)}</span>
                  </div>
                </div>
              )}

              {/* Cash count reconciliation — single compact table */}
              <div className={`rounded-xl border overflow-hidden ${variancePositive ? 'border-emerald-200' : 'border-red-200'}`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-4 py-2.5 ${variancePositive ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <div className="flex items-center gap-2">
                    {variancePositive
                      ? <CheckCircle size={13} className="text-emerald-600" />
                      : <AlertTriangle size={13} className="text-red-600" />}
                    <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Reconciliation</p>
                  </div>
                  <span className={`text-sm font-bold ${variancePositive ? 'text-emerald-700' : 'text-red-700'}`}>
                    Variance: {variancePositive ? '+' : ''}{primarySym}{variance.toFixed(2)}
                  </span>
                </div>

                {/* Table: one row per entry, Expected | Counted side-by-side */}
                <div className="bg-white">
                  {/* Column headers */}
                  <div className="grid grid-cols-3 px-4 py-1.5 border-b border-gray-100 bg-gray-50">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Method</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide text-right">Expected</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide text-right">Counted</span>
                  </div>
                  {entries.map((e, i) => {
                    const counted = parseFloat(e.counted) || 0
                    const diff = counted - e.expectedPrimary
                    const sym = currencySymbol(e.currency)
                    const rowMatch = Math.abs(diff) < 0.01
                    return (
                      <div key={i} className={`grid grid-cols-3 px-4 py-2 text-sm border-b border-gray-50 last:border-0 ${!rowMatch ? 'bg-red-50/40' : ''}`}>
                        <span className="text-gray-700 font-medium">{e.label}</span>
                        <span className="text-gray-500 text-right">{sym}{e.expectedPrimary.toFixed(2)}</span>
                        <span className={`text-right font-semibold ${rowMatch ? 'text-gray-800' : 'text-red-600'}`}>
                          {sym}{counted.toFixed(2)}
                          {!rowMatch && (
                            <span className="text-xs ml-1">({diff > 0 ? '+' : ''}{sym}{diff.toFixed(2)})</span>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Currency totals footer */}
                {(() => {
                  const currencies = [...new Set(entries.map((e) => e.currency))]
                  return (
                    <div className={`border-t px-4 py-3 flex gap-6 flex-wrap ${variancePositive ? 'border-emerald-100 bg-emerald-50/60' : 'border-red-100 bg-red-50/40'}`}>
                      {currencies.map((cur) => {
                        const sym = currencySymbol(cur)
                        const totalCounted = entries.filter((e) => e.currency === cur).reduce((s, e) => s + (parseFloat(e.counted) || 0), 0)
                        const totalExpected = entries.filter((e) => e.currency === cur).reduce((s, e) => s + e.expectedPrimary, 0)
                        return (
                          <div key={cur} className="flex items-baseline gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">{cur}</span>
                            <span className="text-sm font-bold text-gray-900">{sym}{totalCounted.toFixed(2)}</span>
                            {Math.abs(totalCounted - totalExpected) > 0.01 && (
                              <span className="text-xs text-red-500">(exp {sym}{totalExpected.toFixed(2)})</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
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
                  {isMultiTerminal && (
                    <div className="pb-2 mb-1 border-b border-gray-200">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">By Register</p>
                      {terminals.map((t) => (
                        <div key={t.terminalId} className="flex justify-between text-gray-600 text-xs mb-1">
                          <span className="flex items-center gap-1"><Monitor size={10} />{t.terminalName}</span>
                          <span className="font-medium">{formatCurrency(t.totalRevenue, primaryCurrency)} ({t.orderCount} orders)</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between text-gray-600">
                    <span>Total orders today</span>
                    <span className="font-medium text-gray-900">{summary.orderCount}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Net revenue {isMultiTerminal ? '(all registers)' : ''}</span>
                    <span className="font-medium text-gray-900">{formatCurrency(summary.totalRevenue, primaryCurrency)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Total counted ({primaryCurrency} equiv.)</span>
                    <span className="font-medium text-gray-900">{primarySym}{totalCountedPrimary.toFixed(2)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold pt-2 border-t border-gray-200 ${variancePositive ? 'text-emerald-600' : 'text-red-600'}`}>
                    <span>Cash variance</span>
                    <span>{variancePositive ? '+' : ''}{primarySym}{variance.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Closing float + cash to deposit */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-blue-800 mb-1.5">
                    Float to leave in drawer
                    <span className="text-blue-500 font-normal ml-1">(pre-filled from opening amount)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{primarySym}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={closingFloat}
                      onChange={(e) => setClosingFloat(e.target.value)}
                      className="w-full pl-8 pr-3 py-2.5 border border-blue-300 rounded-xl text-sm font-semibold text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-blue-200">
                  <div>
                    <p className="text-sm font-bold text-blue-900">Cash to Deposit</p>
                    <p className="text-xs text-blue-600">Cash counted − float</p>
                  </div>
                  <p className="text-xl font-bold text-blue-900">
                    {primarySym}{cashToDeposit.toFixed(2)}
                  </p>
                </div>
              </div>

              {!variancePositive && Math.abs(variance) > 1 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>Drawer is short by {primarySym}{Math.abs(variance).toFixed(2)}. This will be recorded in the shift report.</span>
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

              {/* Two close options */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleCloseShiftOnly}
                  disabled={closing}
                  className="flex flex-col items-center gap-2 px-4 py-4 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="w-10 h-10 rounded-full bg-amber-100 group-hover:bg-amber-200 flex items-center justify-center transition-colors">
                    <Sun size={18} className="text-amber-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-gray-900">Close Shift Only</p>
                    <p className="text-xs text-gray-500 mt-0.5">Stay logged in</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleCloseDay}
                  disabled={closing}
                  className="flex flex-col items-center gap-2 px-4 py-4 rounded-xl border-2 border-gray-200 hover:border-red-400 hover:bg-red-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="w-10 h-10 rounded-full bg-red-100 group-hover:bg-red-200 flex items-center justify-center transition-colors">
                    <LogOut size={18} className="text-red-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-gray-900">Close & Sign Out</p>
                    <p className="text-xs text-gray-500 mt-0.5">Return to login screen</p>
                  </div>
                </button>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button onClick={() => setStep('summary')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
                  <ChevronLeft size={14} /> Back
                </button>
                {closing && (
                  <span className="text-sm text-gray-400 animate-pulse">Closing shift…</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
