import React, { useState, useEffect } from 'react'
import {
  CreditCard, Banknote, Gift, Star, Clock, CheckCircle, Printer, Mail
} from 'lucide-react'
import { Modal, Button, Input, Badge } from '../../components/ui'
import { useCartStore } from '../../stores/cart.store'
import { useAuthStore } from '../../stores/auth.store'
import { useUiStore } from '../../stores/ui.store'
import { useCurrencyStore } from '../../stores/currency.store'
import { api } from '../../lib/api'
import { formatCurrency, convertAmount, CURRENCIES, round2, type CurrencyCode } from '../../lib/currency'
import type { PaymentMethod } from '../../types'

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  onComplete: (orderNumber: string) => void
}

interface PaymentLine {
  method: PaymentMethod
  currency: CurrencyCode
  amount: number
  /** Integer cents used for the numpad-style formatted amount input. */
  rawCents: number
  reference: string
  giftCardCode: string
}

interface ReceiptSnapshot {
  orderNumber: string
  items: { productName: string; variantName?: string; quantity: number; unitPrice: number; discountAmount: number }[]
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  payments: { method: PaymentMethod; amount: number; currency: CurrencyCode }[]
  change: number
  changeCurrency: CurrencyCode
  customerName?: string
  notes?: string
}

const METHODS: { method: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { method: 'cash',         label: 'Cash',         icon: <Banknote   size={18} /> },
  { method: 'card',         label: 'Card',         icon: <CreditCard size={18} /> },
  { method: 'store_credit', label: 'Store Credit', icon: <Star       size={18} /> },
  { method: 'gift_card',    label: 'Gift Card',    icon: <Gift       size={18} /> },
  { method: 'layaway',      label: 'Layaway',      icon: <Clock      size={18} /> },
]

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash', card: 'Card',
  store_credit: 'Store Credit', gift_card: 'Gift Card', layaway: 'Layaway',
}

const BILLS: Record<CurrencyCode, number[]> = {
  USD: [5, 10, 20, 50, 100],
  KYD: [5, 10, 25, 50, 100],
}

interface ReceiptConfig {
  template: string
  showLogo: boolean
  footer: string
  logoBase64: string
  /** Brand/header background color (hex). Default #1e293b */
  primaryColor: string
  /** Accent color used for discounts, highlights (hex). Default #3b82f6 */
  accentColor: string
  /** Font stack preset: 'system' | 'mono' | 'serif' */
  fontFamily: string
  showTaxLine: boolean
  showDiscountLine: boolean
  showNotes: boolean
  /** Tagline printed beneath store name */
  headerMessage: string
  customField1: string
  customField2: string
  customField3: string
}

/** Escape a string for safe interpolation into HTML. */
function esc(s: string | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Font stack lookup for configurable receipt fonts. */
const RECEIPT_FONT_MAP: Record<string, string> = {
  system: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  mono:   `'Courier New', Courier, monospace`,
  serif:  `Georgia, 'Times New Roman', serif`,
}

function buildReceiptHtml(
  snap: ReceiptSnapshot,
  storeName: string,
  cfg?: ReceiptConfig,
  storeAddress = '',
  storePhone = ''
): string {
  const template        = cfg?.template         ?? 'classic'
  const showLogo        = cfg?.showLogo         ?? false
  const footer          = cfg?.footer           ?? 'Thank you for your business!'
  const primaryColor    = cfg?.primaryColor     ?? '#1e293b'
  const accentColor     = cfg?.accentColor      ?? '#3b82f6'
  const fontStack       = RECEIPT_FONT_MAP[cfg?.fontFamily ?? 'system'] ?? RECEIPT_FONT_MAP.system
  const showTaxLine     = cfg?.showTaxLine      ?? true
  const showDiscountLine= cfg?.showDiscountLine ?? true
  const showNotes       = cfg?.showNotes        ?? true
  const headerMessage   = cfg?.headerMessage    ?? ''
  const customField1    = cfg?.customField1     ?? ''
  const customField2    = cfg?.customField2     ?? ''
  const customField3    = cfg?.customField3     ?? ''

  const logoHtml = showLogo && cfg?.logoBase64
    ? `<div style="text-align:center;margin-bottom:8px"><img src="${cfg.logoBase64}" style="max-height:60px;max-width:200px;object-fit:contain" alt="Logo"/></div>`
    : ''

  const sym = CURRENCIES[snap.payments[0]?.currency ?? 'USD']?.symbol ?? '$'
  const fmtR = (n: number) => `${sym}${Math.abs(n).toFixed(2)}`

  const lineItems = snap.items.map((i) => `
    <tr>
      <td>${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td>
      <td style="text-align:center">${i.quantity}</td>
      <td style="text-align:right">${fmtR(i.unitPrice)}</td>
      <td style="text-align:right">${i.discountAmount > 0 ? `-${fmtR(i.discountAmount)}` : ''}</td>
      <td style="text-align:right">${fmtR((i.unitPrice - i.discountAmount) * i.quantity)}</td>
    </tr>`).join('')

  const paymentLines = snap.payments.map((p) =>
    `<tr><td>${METHOD_LABELS[p.method]} (${p.currency})</td><td style="text-align:right">${CURRENCIES[p.currency].symbol}${p.amount.toFixed(2)}</td></tr>`
  ).join('')

  /** Extra lines from custom fields, rendered as centered footer paragraphs. */
  const customFooterLines = [customField1, customField2, customField3]
    .filter(Boolean)
    .map((f) => `<p class="footer" style="margin-top:4px">${esc(f)}</p>`)
    .join('')

  const classicHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt #${snap.orderNumber}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  @page{size:auto;margin:0}
  body{font-family:${fontStack};font-size:12px;width:300px;margin:0 auto;padding:12px}
  h1{font-size:16px;text-align:center;margin-bottom:4px;color:${primaryColor}}
  .center{text-align:center} .divider{border-top:1px dashed #000;margin:8px 0}
  table{width:100%;border-collapse:collapse} td{padding:2px 0;vertical-align:top}
  .total-row td{font-weight:bold;border-top:1px solid ${primaryColor};padding-top:4px;color:${primaryColor}}
  .discount-row td{color:${accentColor}}
  .meta{font-size:11px;color:#555} .footer{text-align:center;margin-top:12px;font-size:11px}
  @media print{body{width:100%;padding:6px}}
</style></head><body>
  ${logoHtml}
  <h1>${esc(storeName)}</h1>
  ${storeAddress ? `<p class="center meta">${esc(storeAddress)}</p>` : ''}
  ${storePhone   ? `<p class="center meta">${esc(storePhone)}</p>`   : ''}
  ${headerMessage ? `<p class="center meta" style="font-style:italic;margin-bottom:4px">${esc(headerMessage)}</p>` : ''}
  <p class="center meta">Order #${snap.orderNumber}</p>
  <p class="center meta">${new Date().toLocaleString()}</p>
  ${snap.customerName ? `<p class="center meta">Customer: ${esc(snap.customerName)}</p>` : ''}
  <div class="divider"></div>
  <table><thead><tr>
    <td><b>Item</b></td><td style="text-align:center"><b>Qty</b></td>
    <td style="text-align:right"><b>Price</b></td><td style="text-align:right"><b>Disc</b></td>
    <td style="text-align:right"><b>Line</b></td>
  </tr></thead><tbody>${lineItems}</tbody></table>
  <div class="divider"></div>
  <table>
    ${snap.taxAmount > 0 ? `<tr><td>Subtotal</td><td style="text-align:right">${fmtR(snap.subtotal)}</td></tr>` : ''}
    ${showDiscountLine && snap.discountAmount > 0 ? `<tr class="discount-row"><td>Discount</td><td style="text-align:right">-${fmtR(snap.discountAmount)}</td></tr>` : ''}
    ${showTaxLine && snap.taxAmount > 0 ? `<tr><td>Tax</td><td style="text-align:right">${fmtR(snap.taxAmount)}</td></tr>` : ''}
    <tr class="total-row"><td>TOTAL</td><td style="text-align:right">${fmtR(snap.total)}</td></tr>
  </table>
  <div class="divider"></div>
  <table>
    <tr><td colspan="2"><b>Payment</b></td></tr>
    ${paymentLines}
    ${snap.change > 0.01 ? `<tr><td>Change (${snap.changeCurrency})</td><td style="text-align:right">${CURRENCIES[snap.changeCurrency].symbol}${snap.change.toFixed(2)}</td></tr>` : ''}
  </table>
  ${showNotes && snap.notes ? `<div class="divider"></div><p>Note: ${esc(snap.notes)}</p>` : ''}
  <p class="footer">${esc(footer)}</p>
  ${customFooterLines}
</body></html>`

  if (template === 'modern') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt #${snap.orderNumber}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  @page{size:auto;margin:0}
  body{font-family:${fontStack};font-size:13px;width:380px;margin:0 auto;background:#fff}
  .header{background:${primaryColor};color:#fff;padding:20px 24px;text-align:center}
  .header h1{font-size:20px;font-weight:800}
  .header .tagline{font-size:13px;color:rgba(255,255,255,0.80);margin-top:2px;font-style:italic}
  .header .meta{font-size:12px;color:rgba(255,255,255,0.60);margin-top:4px}
  .body{padding:20px 24px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;padding:6px 0}
  td{padding:7px 0;font-size:13px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  td:last-child,th:last-child{text-align:right}
  .total-section{border-top:2px solid ${primaryColor};padding-top:12px;margin-top:4px}
  .total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#475569}
  .discount-row{color:${accentColor}}
  .grand-total{font-size:18px;font-weight:800;color:${primaryColor};margin-top:8px}
  .payment-section{background:#f8fafc;border-radius:8px;padding:12px 16px;margin-top:16px}
  .payment-row{display:flex;justify-content:space-between;font-size:13px;color:#475569;padding:3px 0}
  .footer{text-align:center;padding:16px 24px 4px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;margin-top:16px}
  .custom-fields{text-align:center;padding:4px 24px 16px;font-size:11px;color:#94a3b8}
  @media print{body{width:100%;margin:0}}
</style></head><body>
  <div class="header">
    ${cfg?.showLogo && cfg?.logoBase64 ? `<img src="${cfg.logoBase64}" style="max-height:50px;max-width:180px;object-fit:contain;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto" alt="Logo"/>` : ''}
    <h1>${esc(storeName)}</h1>
    ${storeAddress || storePhone ? `<div class="tagline">${[storeAddress, storePhone].filter(Boolean).map(esc).join(' &bull; ')}</div>` : ''}
    ${headerMessage ? `<div class="tagline" style="font-style:italic">${esc(headerMessage)}</div>` : ''}
    <div class="meta">Order #${snap.orderNumber} &bull; ${new Date().toLocaleString()}</div>
  </div>
  <div class="body">
    ${snap.customerName ? `<p style="font-size:12px;color:#64748b;margin-bottom:12px">Customer: ${esc(snap.customerName)}</p>` : ''}
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody>${snap.items.map((i) => `<tr><td>${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td><td>${i.quantity}</td><td>${fmtR((i.unitPrice - i.discountAmount) * i.quantity)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="total-section">
      <div class="total-row"><span>Subtotal</span><span>${fmtR(snap.subtotal)}</span></div>
      ${showDiscountLine && snap.discountAmount > 0 ? `<div class="total-row discount-row"><span>Discount</span><span>-${fmtR(snap.discountAmount)}</span></div>` : ''}
      ${showTaxLine && snap.taxAmount > 0 ? `<div class="total-row"><span>Tax</span><span>${fmtR(snap.taxAmount)}</span></div>` : ''}
      <div class="total-row grand-total"><span>Total</span><span>${fmtR(snap.total)}</span></div>
    </div>
    <div class="payment-section">
      ${snap.payments.map((p) => `<div class="payment-row"><span>${METHOD_LABELS[p.method]} (${p.currency})</span><span>${CURRENCIES[p.currency].symbol}${p.amount.toFixed(2)}</span></div>`).join('')}
      ${snap.change > 0.01 ? `<div class="payment-row" style="color:${accentColor}"><span>Change (${snap.changeCurrency})</span><span>${CURRENCIES[snap.changeCurrency].symbol}${snap.change.toFixed(2)}</span></div>` : ''}
    </div>
    ${showNotes && snap.notes ? `<p style="margin-top:12px;font-size:12px;color:#64748b">Note: ${esc(snap.notes)}</p>` : ''}
  </div>
  <div class="footer">${esc(footer)}</div>
  ${customField1 || customField2 || customField3
    ? `<div class="custom-fields">${[customField1, customField2, customField3].filter(Boolean).map((f) => `<div>${esc(f)}</div>`).join('')}</div>`
    : ''}
</body></html>`
  }

  if (template === 'minimal') {
    const customLines = [customField1, customField2, customField3].filter(Boolean).join('\n')
    const discountLine = showDiscountLine && snap.discountAmount > 0 ? `Discount: -${fmtR(snap.discountAmount)}\n` : ''
    const taxLine = showTaxLine && snap.taxAmount > 0 ? `Tax: ${fmtR(snap.taxAmount)}\n` : ''
    const notesLine = showNotes && snap.notes ? `Note: ${esc(snap.notes)}\n` : ''
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page{size:auto;margin:0}
      body{font-family:${fontStack};font-size:11px;width:260px;margin:0 auto;padding:8px}
      pre{white-space:pre-wrap;margin:0}
      @media print{body{width:100%;padding:4px}}
    </style></head><body>${logoHtml}<pre>${esc(storeName)}
${storeAddress ? esc(storeAddress) + '\n' : ''}${storePhone ? esc(storePhone) + '\n' : ''}${headerMessage ? esc(headerMessage) + '\n' : ''}#${snap.orderNumber} ${new Date().toLocaleDateString()}
${'\u2014'.repeat(0)}${'-'.repeat(32)}
${snap.items.map((i) => `${i.quantity}x ${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''} ${fmtR((i.unitPrice - i.discountAmount) * i.quantity)}`).join('\n')}
${'-'.repeat(32)}
${discountLine}${taxLine}TOTAL: ${fmtR(snap.total)}
${snap.payments.map((p) => `${METHOD_LABELS[p.method]}: ${CURRENCIES[p.currency].symbol}${p.amount.toFixed(2)}`).join('\n')}
${snap.change > 0.01 ? `Change: ${CURRENCIES[snap.changeCurrency].symbol}${snap.change.toFixed(2)}` : ''}
${notesLine}${esc(footer)}${customLines ? '\n' + customLines : ''}</pre></body></html>`
  }

  return classicHtml
}

export function PaymentModal({ isOpen, onClose, onComplete }: PaymentModalProps) {
  const { items, customer, notes, subtotal, discountAmount, taxAmount, total,
    discountType, discountValue, loyaltyPointsToRedeem, taxRate, taxEnabled, orderType,
    editingOrderId, editingOrderNumber, setEditingOrder } = useCartStore()
  const { staff, shift } = useAuthStore()
  const showToast = useUiStore((s) => s.showToast)
  const clearCart = useCartStore((s) => s.clearCart)
  const { fmtRaw, currency: storeCurrency, altCurrency, kydToUsdRate } = useCurrencyStore()

  const orderTotal = total()
  const showAlt = storeCurrency !== 'USD'
  const altCode = altCurrency()

  const [payments, setPayments] = useState<PaymentLine[]>([
    { method: 'cash', currency: storeCurrency, amount: orderTotal, rawCents: Math.round(orderTotal * 100), reference: '', giftCardCode: '' }
  ])
  const [processing, setProcessing] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [printReceipt, setPrintReceipt] = useState(true)
  const [receiptSnapshot, setReceiptSnapshot] = useState<ReceiptSnapshot | null>(null)
  const [printing, setPrinting] = useState(false)
  const [invoicePrinting, setInvoicePrinting] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  const [storeSettings, setStoreSettings] = useState<Record<string, string>>({})
  const [enabledMethods, setEnabledMethods] = useState<string[]>(['cash','card','store_credit','gift_card','layaway'])
  const [receiptConfig, setReceiptConfig] = useState<ReceiptConfig>({
    template: 'classic', showLogo: true, footer: 'Thank you for your business!', logoBase64: '',
    primaryColor: '#1e293b', accentColor: '#3b82f6', fontFamily: 'system',
    showTaxLine: true, showDiscountLine: true, showNotes: true,
    headerMessage: '', customField1: '', customField2: '', customField3: '',
  })

  useEffect(() => {
    if (isOpen) {
      setPayments([{ method: 'cash', currency: storeCurrency, amount: orderTotal, rawCents: Math.round(orderTotal * 100), reference: '', giftCardCode: '' }])
      setCompleted(false)
      setReceiptSnapshot(null)
      // Load which payment methods are enabled in Settings
      api.settings.get('enabledPaymentMethods').then((val) => {
        if (val) {
          try { setEnabledMethods(JSON.parse(val) as string[]) } catch { /* use default */ }
        }
      }).catch(() => {})
      api.settings.getAll().then((s) => {
        setStoreSettings(s)
        setReceiptConfig({
          template:          s.receiptTemplate          ?? 'classic',
          showLogo:          (s.receiptShowLogo          ?? 'true') === 'true',
          footer:            s.receiptFooterText         ?? 'Thank you for your business!',
          logoBase64:        s.logoBase64                ?? '',
          primaryColor:      s.receiptPrimaryColor       ?? '#1e293b',
          accentColor:       s.receiptAccentColor        ?? '#3b82f6',
          fontFamily:        s.receiptFontFamily         ?? 'system',
          showTaxLine:       (s.receiptShowTaxLine       ?? 'true') === 'true',
          showDiscountLine:  (s.receiptShowDiscountLine  ?? 'true') === 'true',
          showNotes:         (s.receiptShowNotes         ?? 'true') === 'true',
          headerMessage:     s.receiptHeaderMessage      ?? '',
          customField1:      s.receiptCustomField1       ?? '',
          customField2:      s.receiptCustomField2       ?? '',
          customField3:      s.receiptCustomField3       ?? '',
        })
      }).catch(() => {})
      // Reset email UI on each open
      setShowEmailInput(false)
      setEmailInput('')
    }
  }, [isOpen, orderTotal, storeCurrency])

  /**
   * Convert any payment-line amount to store currency (KYD/CI$).
   * All comparisons are done in store currency to avoid USD/KYD mixing errors.
   */
  function toStore(amount: number, pCurrency: CurrencyCode): number {
    return round2(convertAmount(amount, pCurrency, storeCurrency, kydToUsdRate))
  }

  /** Convert a store-currency amount to a payment line's display currency. */
  function fromStore(storeAmount: number, toCurrency: CurrencyCode): number {
    return round2(convertAmount(storeAmount, storeCurrency, toCurrency, kydToUsdRate))
  }

  // All totals in store currency (KYD/CI$) — orderTotal is already in KYD.
  const totalPaidStore = payments.reduce(
    (s, p) => s + toStore(parseFloat(String(p.amount)) || 0, p.currency), 0
  )
  const remainingStore  = Math.max(0, orderTotal - totalPaidStore)
  const changeStore     = Math.max(0, totalPaidStore - orderTotal)
  /** Change is always given back in the primary (store) currency, regardless of how the
   *  customer paid. E.g. customer pays in USD → change is returned in CI$. */
  const changeCurrency: CurrencyCode = storeCurrency
  const changeInCurrency = fromStore(changeStore, changeCurrency)

  function addPaymentLine() {
    const amt = fromStore(remainingStore, storeCurrency)
    setPayments((prev) => [
      ...prev,
      { method: 'cash', currency: storeCurrency, amount: amt, rawCents: Math.round(amt * 100), reference: '', giftCardCode: '' }
    ])
  }

  function updatePayment(index: number, updates: Partial<PaymentLine>) {
    setPayments((prev) => prev.map((p, i) => {
      if (i !== index) return p
      const merged = { ...p, ...updates }
      // When amount is set programmatically (quick buttons), sync rawCents automatically.
      if ('amount' in updates && !('rawCents' in updates)) {
        merged.rawCents = Math.round((updates.amount ?? 0) * 100)
      }
      return merged
    }))
  }

  function removePayment(index: number) {
    setPayments((prev) => prev.filter((_, i) => i !== index))
  }

  function handleCurrencyToggle(index: number) {
    setPayments((prev) => prev.map((p, i) => {
      if (i !== index) return p
      const newCurrency: CurrencyCode = p.currency === 'USD' ? 'KYD' : 'USD'
      const currentAmount = parseFloat(String(p.amount)) || 0
      const newAmount = round2(convertAmount(currentAmount, p.currency, newCurrency, kydToUsdRate))
      return { ...p, currency: newCurrency, amount: newAmount }
    }))
  }

  async function handleProcess() {
    if (remainingStore > 0.01) {
      showToast('Payment amount does not cover the total', 'warning')
      return
    }
    setProcessing(true)

    try { await api.display.update({ state: 'payment_processing' }) } catch { /* non-fatal */ }

    try {
      const mappedItems = items.map((item) => ({
        productId: item.productId, variantId: item.variantId,
        productName: item.productName, variantName: item.variantName,
        sku: item.sku, quantity: item.quantity,
        unitPrice: item.unitPrice, discountAmount: item.discountAmount,
        notes: item.notes
      }))

      const mappedPayments = payments.map((p) => ({
        method: p.method,
        amount: toStore(parseFloat(String(p.amount)) || 0, p.currency),
        reference: p.reference || undefined,
        changeGiven: p.method === 'cash' ? changeStore : undefined,
        giftCardCode: p.method === 'gift_card' ? p.giftCardCode : undefined,
      }))

      let result: { order: { id: string; orderNumber: string } }

      if (editingOrderId) {
        // ── Edit in-place: update the existing order, same order number ────────
        result = await api.orders.updateAndComplete({
          orderId: editingOrderId,
          customerId: customer?.id,
          staffId: staff?.id,
          shiftId: (shift as { id?: string })?.id,
          orderType,
          items: mappedItems,
          notes,
          manualDiscountType: discountType ?? undefined,
          manualDiscountValue: discountValue > 0 ? discountValue : undefined,
          loyaltyPointsRedeemed: loyaltyPointsToRedeem,
          taxRate: taxEnabled ? taxRate : 0,
          payments: mappedPayments,
        }) as typeof result
        // Clear editing state so next sale starts fresh
        setEditingOrder(null)
      } else {
        // ── Normal flow: create a new order then complete it ──────────────────
        const orderInput = {
          customerId: customer?.id,
          staffId: staff?.id,
          shiftId: (shift as { id?: string })?.id,
          orderType,
          items: mappedItems,
          notes,
          manualDiscountType: discountType ?? undefined,
          manualDiscountValue: discountValue > 0 ? discountValue : undefined,
          loyaltyPointsRedeemed: loyaltyPointsToRedeem,
          taxRate: taxEnabled ? taxRate : 0,
        }
        const orderResult = await api.orders.create(orderInput)
        const orderId = (orderResult as { order: { id: string } }).order.id
        result = await api.orders.complete({ orderId, payments: mappedPayments }) as typeof result
      }

      const num = result.order.orderNumber
      const orderId = result.order.id

      const snap: ReceiptSnapshot = {
        orderNumber: num,
        items: items.map((i) => ({
          productName: i.productName, variantName: i.variantName,
          quantity: i.quantity, unitPrice: i.unitPrice, discountAmount: i.discountAmount,
        })),
        subtotal: subtotal(), discountAmount: discountAmount(),
        taxAmount: taxAmount(), total: orderTotal,
        payments: payments.map((p) => ({
          method: p.method,
          amount: parseFloat(String(p.amount)) || 0,
          currency: p.currency,
        })),
        change: changeInCurrency,
        changeCurrency,
        customerName: customer ? `${customer.firstName} ${customer.lastName}` : undefined,
        notes: notes || undefined,
      }

      setReceiptSnapshot(snap)
      setOrderNumber(num)
      setCompleted(true)

      try {
        const storeName    = (await api.settings.get('storeName'))    || ''
        const storeAddr    = (await api.settings.get('storeAddress')) || ''
        const storePhoneNo = (await api.settings.get('storePhone'))   || ''
        const builtReceiptHtml = buildReceiptHtml(snap, storeName, receiptConfig, storeAddr, storePhoneNo)
        await api.display.update({
          state: 'complete',
          change: changeInCurrency,
          changeCurrency,
          changeSymbol: CURRENCIES[changeCurrency].symbol,
          storeName,
          completedReceiptHtml: builtReceiptHtml,
          orderNumber: num,
        })
      } catch { /* non-fatal */ }

      await api.audit.log({
        staffId: staff?.id, action: 'order_completed',
        entityType: 'order', entityId: orderId,
        details: { orderNumber: num, total: orderTotal },
      })

      if (printReceipt) {
        try {
          const storeName    = (await api.settings.get('storeName'))    || ''
          const storeAddr    = (await api.settings.get('storeAddress')) || ''
          const storePhoneNo = (await api.settings.get('storePhone'))   || ''
          await api.receipt.print(buildReceiptHtml(snap, storeName, receiptConfig, storeAddr, storePhoneNo))
        } catch {
          showToast('Auto-print failed — use Print Receipt to retry', 'warning')
        }
      }
    } catch (err) {
      showToast('Payment processing failed', 'error')
      console.error(err)
      try { await api.display.update({ state: 'shopping' }) } catch { /* non-fatal */ }
    } finally {
      setProcessing(false)
    }
  }

  async function handlePrint() {
    if (!receiptSnapshot) return
    setPrinting(true)
    try {
      const storeName    = (await api.settings.get('storeName'))    || 'POS System'
      const storeAddr    = (await api.settings.get('storeAddress')) || ''
      const storePhoneNo = (await api.settings.get('storePhone'))   || ''
      await api.receipt.print(buildReceiptHtml(receiptSnapshot, storeName, receiptConfig, storeAddr, storePhoneNo))
      showToast('Receipt printed', 'success')
    } catch {
      showToast('Print failed', 'error')
    } finally {
      setPrinting(false)
    }
  }

  function buildInvoiceHtmlFromSnap(snap: ReceiptSnapshot): string {
    const storeName       = storeSettings.storeName          ?? ''
    const storeAddress    = storeSettings.storeAddress       ?? ''
    const storePhone      = storeSettings.storePhone         ?? ''
    const showLogo        = (storeSettings.invoiceShowLogo   ?? 'true') === 'true'
    const footer          = storeSettings.invoiceFooterText  ?? 'Payment due on receipt. Thank you!'
    const primaryColor    = storeSettings.invoicePrimaryColor   ?? '#1e293b'
    const accentColor     = storeSettings.invoiceAccentColor    ?? '#10b981'
    const headerMessage   = storeSettings.invoiceHeaderMessage  ?? ''
    const showTaxLine     = (storeSettings.invoiceShowTaxLine      ?? 'true') === 'true'
    const showDiscountLine= (storeSettings.invoiceShowDiscountLine ?? 'true') === 'true'
    const customField1    = storeSettings.invoiceCustomField1 ?? ''
    const customField2    = storeSettings.invoiceCustomField2 ?? ''
    const customField3    = storeSettings.invoiceCustomField3 ?? ''

    const logoHtml = showLogo && receiptConfig.logoBase64
      ? `<img src="${receiptConfig.logoBase64}" style="max-height:60px;max-width:200px;object-fit:contain" alt="Logo"/>`
      : ''
    const currSym = CURRENCIES[storeCurrency]?.symbol ?? '$'
    const fmtAmt = (n: number) => `${currSym}${n.toFixed(2)}`
    const subtotal = snap.subtotal
    const tax = snap.taxAmount
    const total = snap.total
    const rows = snap.items.map((i) =>
      `<tr><td style="padding:8px 12px">${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td>
       <td style="padding:8px 12px;text-align:center">${i.quantity}</td>
       <td style="padding:8px 12px;text-align:right">${fmtAmt(i.unitPrice)}</td>
       <td style="padding:8px 12px;text-align:right;font-weight:600">${fmtAmt((i.unitPrice - i.discountAmount) * i.quantity)}</td></tr>`
    ).join('')

    const customFooter = [customField1, customField2, customField3]
      .filter(Boolean)
      .map((f) => `<div style="margin-top:4px">${esc(f)}</div>`)
      .join('')

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:'Segoe UI',sans-serif;color:#1e293b;margin:0;padding:32px 40px;font-size:13px}
  h1{margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px;color:${primaryColor}}
  table{width:100%;border-collapse:collapse}
  thead tr{background:${primaryColor};color:#fff}
  th{padding:9px 12px;text-align:left;font-weight:600;font-size:12px}
  tbody tr:nth-child(even){background:#f8fafc}
  .totals td{padding:4px 0;font-size:13px}
  .grand-total{font-size:16px;font-weight:700;border-top:2px solid ${primaryColor};padding-top:8px!important}
  .discount-row td{color:${accentColor}}
  .paid-stamp{display:inline-block;border:2px solid #16a34a;color:#16a34a;border-radius:4px;padding:2px 10px;font-size:12px;font-weight:700;letter-spacing:1px}
  .section{background:#f8fafc;border-radius:8px;padding:12px 16px;margin-bottom:16px}
  .footer{margin-top:24px;padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:11px;color:#64748b;text-align:center}
</style>
</head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
  <div>${logoHtml}<div style="margin-top:${logoHtml ? 8 : 0}px"><strong style="font-size:16px">${esc(storeName)}</strong>
    ${headerMessage ? `<div style="font-size:12px;color:#64748b;font-style:italic;margin-top:2px">${esc(headerMessage)}</div>` : ''}
    ${storeAddress ? `<div style="color:#64748b;font-size:12px;margin-top:2px">${esc(storeAddress)}</div>` : ''}
    ${storePhone ? `<div style="color:#64748b;font-size:12px">${esc(storePhone)}</div>` : ''}
  </div></div>
  <div style="text-align:right"><h1>INVOICE</h1>
    <div style="color:#64748b;font-size:12px;margin-top:4px">#${snap.orderNumber}</div>
    <div style="color:#64748b;font-size:12px">${new Date().toLocaleDateString()}</div>
    <div style="margin-top:8px"><span class="paid-stamp">PAID</span></div>
  </div>
</div>
${snap.customerName ? `<div class="section"><div style="font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Bill To</div><strong>${esc(snap.customerName)}</strong></div>` : ''}
<table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody></table>
<div style="display:flex;justify-content:flex-end;margin-top:16px">
  <table class="totals" style="width:220px">
    <tr><td>Subtotal</td><td style="text-align:right">${fmtAmt(subtotal)}</td></tr>
    ${showDiscountLine && snap.discountAmount > 0 ? `<tr class="discount-row"><td>Discount</td><td style="text-align:right">-${fmtAmt(snap.discountAmount)}</td></tr>` : ''}
    ${showTaxLine && tax > 0 ? `<tr><td>Tax</td><td style="text-align:right">${fmtAmt(tax)}</td></tr>` : ''}
    <tr class="grand-total"><td>Total</td><td style="text-align:right">${fmtAmt(total)}</td></tr>
  </table>
</div>
${footer || customFooter ? `<div class="footer">${esc(footer)}${customFooter}</div>` : ''}
</body></html>`
  }

  async function handlePrintInvoice() {
    if (!receiptSnapshot) return
    setInvoicePrinting(true)
    try {
      await api.invoice.print(buildInvoiceHtmlFromSnap(receiptSnapshot))
      showToast('Invoice sent to printer', 'success')
    } catch {
      showToast('Invoice print failed', 'error')
    } finally {
      setInvoicePrinting(false)
    }
  }

  async function handleEmailSend(type: 'receipt' | 'invoice') {
    if (!receiptSnapshot || !emailInput.trim()) return
    const email = emailInput.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Enter a valid email address', 'error')
      return
    }
    setEmailSending(true)
    try {
      const storeName = storeSettings.storeName    ?? ''
      const storeAddr = storeSettings.storeAddress ?? ''
      const storePhN  = storeSettings.storePhone   ?? ''
      const html = type === 'receipt'
        ? buildReceiptHtml(receiptSnapshot, storeName, receiptConfig, storeAddr, storePhN)
        : buildInvoiceHtmlFromSnap(receiptSnapshot)
      const result = type === 'receipt'
        ? await api.email.sendReceipt(email, html, receiptSnapshot.orderNumber)
        : await api.email.sendInvoice(email, html, receiptSnapshot.orderNumber)
      if (result.success) {
        showToast(`${type === 'receipt' ? 'Receipt' : 'Invoice'} emailed to ${email}`, 'success')
        setShowEmailInput(false)
        setEmailInput('')
      } else {
        showToast(result.error ?? 'Email failed', 'error')
      }
    } catch {
      showToast('Email failed — check email settings', 'error')
    } finally {
      setEmailSending(false)
    }
  }

  function handleDone() {
    clearCart()
    onComplete(orderNumber)
  }

  // Completed view
  if (completed) {
    return (
      <Modal isOpen={isOpen} onClose={handleDone} title="Payment Complete" size="md">
        <div className="text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
            <CheckCircle size={36} className="text-emerald-500" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">Payment Successful!</h3>
            <p className="text-gray-500 mt-1">Order #{orderNumber}</p>
          </div>

          {/* Totals */}
          <div className="bg-gray-50 rounded-xl p-4 text-left space-y-1.5">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Total charged</span>
              <span className="font-semibold">{fmtRaw(orderTotal)}</span>
            </div>
            {changeStore > 0.005 && (
              <div className="flex justify-between text-sm text-emerald-600">
                <span>Change ({changeCurrency})</span>
                <span className="font-bold">{CURRENCIES[changeCurrency].symbol}{changeInCurrency.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Receipt actions */}
          <div className="flex flex-wrap gap-2 justify-center">
            <Button variant="secondary" icon={<Printer size={14} />} onClick={handlePrint} loading={printing}>
              Print Receipt
            </Button>
            <Button variant="secondary" icon={<Printer size={14} />} onClick={handlePrintInvoice} loading={invoicePrinting}>
              Print Invoice
            </Button>
            <Button
              variant="secondary"
              icon={<Mail size={14} />}
              onClick={() => { setShowEmailInput((v) => !v); setEmailInput('') }}
            >
              Email
            </Button>
          </div>

          {/* Inline email input */}
          {showEmailInput && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-600 text-left">Send to customer email</p>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="customer@example.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => { if (e.key === 'Enter') handleEmailSend('receipt') }}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleEmailSend('receipt')}
                  disabled={emailSending || !emailInput}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {emailSending ? 'Sending\u2026' : 'Email Receipt'}
                </button>
                <button
                  type="button"
                  onClick={() => handleEmailSend('invoice')}
                  disabled={emailSending || !emailInput}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {emailSending ? 'Sending\u2026' : 'Email Invoice'}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 justify-center text-sm text-gray-500">
            <input
              type="checkbox"
              id="autoPrint"
              checked={printReceipt}
              onChange={(e) => setPrintReceipt(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            <label htmlFor="autoPrint">Auto-print receipt next time</label>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleDone} size="lg" className="px-10">
            Done
          </Button>
        </div>
      </Modal>
    )
  }

  // Payment entry view
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Payment"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={processing}>Cancel</Button>
          <Button
            onClick={handleProcess}
            loading={processing}
            disabled={remainingStore > 0.01}
            size="lg"
            className="px-8"
          >
            {processing ? 'Processing...' : `Charge ${fmtRaw(orderTotal)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Order summary */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal</span><span>{fmtRaw(subtotal())}</span>
          </div>
          {discountAmount() > 0 && (
            <div className="flex justify-between text-sm text-emerald-600">
              <span>Discount</span><span>-{fmtRaw(discountAmount())}</span>
            </div>
          )}
          {taxAmount() > 0 && (
            <div className="flex justify-between text-sm text-gray-600">
              <span>Tax</span><span>{fmtRaw(taxAmount())}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold text-gray-900 border-t border-gray-200 pt-2 mt-1">
            <span>Total</span>
            <span className="text-blue-600">{fmtRaw(orderTotal)}</span>
          </div>
          {showAlt && (
            <div className="flex justify-between text-xs text-gray-400">
              <span>approx {altCode}</span>
              <span>{CURRENCIES[altCode as CurrencyCode]?.symbol ?? '$'}{fromStore(orderTotal, altCode as CurrencyCode).toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Payment lines */}
        <div className="space-y-3">
          {payments.map((payment, index) => {
            const sym = CURRENCIES[payment.currency].symbol
            const enteredAmount = parseFloat(String(payment.amount)) || 0
            // Show the "approx X" hint in the other currency from what's entered
            const altPayCurrency: CurrencyCode = payment.currency === 'KYD' ? 'USD' : 'KYD'
            const altAmount = round2(convertAmount(enteredAmount, payment.currency, altPayCurrency, kydToUsdRate))
            const altSym = CURRENCIES[altPayCurrency].symbol

            return (
              <div key={index} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                {/* Method selector */}
                <div className="flex gap-2 flex-wrap">
                  {METHODS.filter(({ method }) => enabledMethods.includes(method)).map(({ method, label, icon }) => (
                    <button
                      key={method}
                      onClick={() => updatePayment(index, { method })}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                        payment.method === method
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {icon} {label}
                    </button>
                  ))}
                  {payments.length > 1 && (
                    <button
                      onClick={() => removePayment(index)}
                      className="ml-auto text-xs text-red-400 hover:text-red-600 px-2"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {/* Amount row */}
                <div className="flex gap-2 items-start">
                  {/* Explicit USD / KYD currency buttons */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {(['KYD', 'USD'] as const).map((cur) => (
                      <button
                        key={cur}
                        onClick={() => {
                          if (payment.currency === cur) return
                          const current = parseFloat(String(payment.amount)) || 0
                          const converted = round2(convertAmount(current, payment.currency, cur, kydToUsdRate))
                          updatePayment(index, { currency: cur, amount: converted })
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all min-w-[48px] min-h-[20px] ${
                          payment.currency === cur
                            ? cur === 'KYD'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-400'
                        }`}
                      >
                        {cur}
                      </button>
                    ))}
                  </div>

                  {/* Amount input — cents-first numpad format */}
                  <div className="flex-1">
                    <div className="flex">
                      <span className="bg-gray-50 border border-r-0 border-gray-300 rounded-l-lg px-3 py-2 text-sm text-gray-600 flex items-center min-h-[44px]">
                        {sym}
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={(payment.rawCents / 100).toFixed(2)}
                        onChange={() => {/* controlled via onKeyDown */}}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key >= '0' && e.key <= '9') {
                            e.preventDefault()
                            const newCents = Math.min(payment.rawCents * 10 + parseInt(e.key), 99999999)
                            updatePayment(index, { rawCents: newCents, amount: newCents / 100 })
                          } else if (e.key === 'Backspace' || e.key === 'Delete') {
                            e.preventDefault()
                            const newCents = Math.floor(payment.rawCents / 10)
                            updatePayment(index, { rawCents: newCents, amount: newCents / 100 })
                          }
                        }}
                        className="flex-1 border border-gray-300 rounded-r-lg px-3 py-2 text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                      />
                    </div>
                    {/* Alt currency hint */}
                    {(parseFloat(String(payment.amount)) || 0) > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        approx {altSym}{altAmount.toFixed(2)}
                      </p>
                    )}
                  </div>

                  {/* Quick amount buttons */}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => updatePayment(index, { amount: fromStore(orderTotal, payment.currency) })}
                      className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-gray-600 min-h-[20px]"
                    >
                      Exact
                    </button>
                    {remainingStore > 0.01 && (
                      <button
                        onClick={() => updatePayment(index, { amount: fromStore(remainingStore, payment.currency) })}
                        className="text-xs bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded text-blue-600 min-h-[20px]"
                      >
                        Rem.
                      </button>
                    )}
                  </div>
                </div>

                {/* Bill quick-buttons for cash */}
                {payment.method === 'cash' && (
                  <div className="flex gap-2 flex-wrap">
                    {BILLS[payment.currency].map((bill) => (
                      <button
                        key={bill}
                        onClick={() => updatePayment(index, { amount: bill })}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700"
                      >
                        {sym}{bill}
                      </button>
                    ))}
                  </div>
                )}

                {/* Reference for card/layaway */}
                {(payment.method === 'card' || payment.method === 'layaway') && (
                  <Input
                    label={payment.method === 'card' ? 'Auth Code (optional)' : 'Layaway Reference'}
                    value={payment.reference}
                    onChange={(e) => updatePayment(index, { reference: e.target.value })}
                    placeholder={payment.method === 'card' ? 'e.g. 123456' : 'e.g. LAY-001'}
                  />
                )}

                {/* Gift card code */}
                {payment.method === 'gift_card' && (
                  <Input
                    label="Gift Card Code"
                    value={payment.giftCardCode}
                    onChange={(e) => updatePayment(index, { giftCardCode: e.target.value })}
                    placeholder="e.g. GC-XXXX-XXXX"
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Split payment */}
        {remainingStore > 0.01 && (
          <button
            onClick={addPaymentLine}
            className="w-full py-2 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            + Add another payment method
          </button>
        )}

        {/* Running totals */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1">
          <div className="flex justify-between text-sm font-medium text-blue-800">
            <span>Total paid</span>
            <span>{fmtRaw(totalPaidStore)}</span>
          </div>
          {remainingStore > 0.01 && (
            <div className="flex justify-between text-sm text-red-600 font-medium">
              <span>Remaining</span>
              <span>{fmtRaw(remainingStore)}</span>
            </div>
          )}
          {changeStore > 0.005 && (
            <div className="flex justify-between text-sm text-emerald-700 font-bold">
              <span>Change ({changeCurrency})</span>
              <span>{CURRENCIES[changeCurrency].symbol}{changeInCurrency.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Print toggle */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            id="printReceiptToggle"
            checked={printReceipt}
            onChange={(e) => setPrintReceipt(e.target.checked)}
            className="w-4 h-4 accent-blue-600"
          />
          <label htmlFor="printReceiptToggle">Print receipt after payment</label>
        </div>

      </div>
    </Modal>
  )
}
