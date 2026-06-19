import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, RefreshCw, Eye, Undo2, Ban, Printer, FileText,
  CheckCircle, XCircle, Edit3, Truck, Package
} from 'lucide-react'
import { api } from '../../lib/api'
import { Input, Button, Badge, PageSpinner, Modal } from '../../components/ui'
import { formatCurrency, CURRENCIES } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { useUiStore } from '../../stores/ui.store'
import { useAuthStore } from '../../stores/auth.store'
import { useCartStore } from '../../stores/cart.store'
import { useCurrencyStore } from '../../stores/currency.store'
import { ROUTES } from '../../constants'
import type { Order, OrderItem, Payment } from '../../types'

/** Escape a string for safe interpolation into HTML. */
function esc(s: string | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// STATUS colour map
const STATUS_COLORS: Record<string, 'green' | 'blue' | 'red' | 'gray' | 'yellow' | 'purple'> = {
  completed:  'green',
  pending:    'blue',
  held:       'yellow',
  refunded:   'gray',
  voided:     'red',
  delivered:  'purple',
  canceled:   'red',
}

const STATUS_TABS = [
  { value: '',           label: 'All' },
  { value: 'pending',    label: 'Pending' },
  { value: 'held',       label: 'Held' },
  { value: 'completed',  label: 'Completed' },
  { value: 'delivered',  label: 'Delivered' },
  { value: 'canceled',   label: 'Canceled' },
  { value: 'refunded',   label: 'Refunded' },
  { value: 'voided',     label: 'Voided' },
]

export function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<{ order: Order; items: OrderItem[]; payments: Payment[] } | null>(null)
  const showToast = useUiStore((s) => s.showToast)
  const { staff } = useAuthStore()
  const cartStore = useCartStore()
  const navigate = useNavigate()
  const { currency: storeCurrency } = useCurrencyStore()

  async function load() {
    setLoading(true)
    try {
      const data = await api.orders.list({ status: statusFilter || undefined, limit: 200 })
      setOrders(data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [statusFilter])

  async function viewOrder(order: Order) {
    const full = await api.orders.get(order.id)
    if (full) setSelected(full as { order: Order; items: OrderItem[]; payments: Payment[] })
  }

  async function voidOrder(order: Order) {
    if (!confirm(`Void order ${order.orderNumber}?`)) return
    await api.orders.voidOrder(order.id, staff?.id ?? '')
    showToast('Order voided', 'success')
    load()
    setSelected(null)
  }

  async function refundOrder(order: Order) {
    if (!confirm(`Refund order ${order.orderNumber}?`)) return
    try {
      await api.orders.refund(order.id, [])
      showToast('Refund processed', 'success')
      load()
      setSelected(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Refund failed', 'error')
    }
  }

  async function updateStatus(order: Order, status: string) {
    try {
      await api.orders.updateStatus(order.id, status)
      showToast(`Order marked as ${status}`, 'success')
      load()
      setSelected(null)
    } catch {
      showToast('Failed to update status', 'error')
    }
  }

  /** Load a pending/held order back into the cart for editing in-place (same order number preserved). */
  async function editOrder(order: Order) {
    if (!confirm(`Edit order ${order.orderNumber}? Items will be loaded into the cart. The same invoice number will be kept.`)) return
    try {
      const full = await api.orders.getForEdit(order.id)
      if (!full) { showToast('Order not found', 'error'); return }
      const { order: o, items } = full as { order: Order; items: OrderItem[]; payments: Payment[] }

      // Do NOT cancel — we edit the order in-place via updateAndComplete when the cashier checks out.
      // Mark the order ID + number in the cart store so PaymentModal knows to use updateAndComplete.
      cartStore.clearCart()
      cartStore.setEditingOrder(o.id, o.orderNumber)

      if ((o as unknown as { orderType?: string }).orderType === 'delivery') {
        cartStore.setOrderType('delivery')
      }
      for (const item of items as OrderItem[]) {
        cartStore.addItem({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          productName: item.productName,
          variantName: item.variantName ?? undefined,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          notes: item.notes ?? undefined,
        })
      }
      if (o.notes) cartStore.setNotes(o.notes)

      showToast(`Editing ${o.orderNumber} — modify items then Charge to update the order`, 'info')
      setSelected(null)
      navigate(ROUTES.POS)
    } catch {
      showToast('Failed to load order for editing', 'error')
    }
  }

  // Receipt / Invoice builders

  /**
   * Build a template-aware reprint receipt using the same classic/modern/minimal
   * templates as PaymentModal's buildReceiptHtml. Includes change given and
   * conditionally hides subtotal when tax was not charged on the order.
   */
  function buildReprintReceiptHtml(
    order: Order,
    items: OrderItem[],
    payments: Payment[],
    storeName: string,
    cfg: { template: string; showLogo: boolean; footer: string; logoBase64: string },
    storeAddress = '',
    storePhone = ''
  ): string {
    const METHOD_LABELS: Record<string, string> = {
      cash: 'Cash', card: 'Card',
      store_credit: 'Store Credit', gift_card: 'Gift Card', layaway: 'Layaway',
    }
    // Change is ALWAYS returned in the store (primary) currency.
    const changeCurrCode = storeCurrency
    const changeCurrSym = CURRENCIES[storeCurrency]?.symbol ?? storeCurrency

    const cashChange = payments.find((p) => (p.changeGiven ?? 0) > 0.005)
    const changeAmt = cashChange?.changeGiven ?? 0

    // fmt shows the amount the customer *tendered* in their chosen currency.
    // originalAmount is what they handed over; fall back to amount if missing.
    const fmt = (p: Payment) => {
      const sym = CURRENCIES[p.currency]?.symbol ?? p.currency
      const displayAmt = p.originalAmount ?? p.amount
      return `${sym}${Math.abs(displayAmt).toFixed(2)}`
    }
    // Prices, totals, tax — always in store currency
    const fmtKyd = (n: number) => {
      const sym = CURRENCIES[storeCurrency]?.symbol ?? storeCurrency
      return `${sym}${Math.abs(n).toFixed(2)}`
    }

    const showSubtotal = order.taxAmount > 0

    // ── Classic template ──────────────────────────────────────────────────────
    const lineItemsClassic = items.map((i) => `
    <tr>
      <td>${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td>
      <td style="text-align:center">${i.quantity}</td>
      <td style="text-align:right">${fmtKyd(i.unitPrice)}</td>
      <td style="text-align:right">${i.discountAmount > 0 ? `-${fmtKyd(i.discountAmount)}` : ''}</td>
      <td style="text-align:right">${fmtKyd((i.unitPrice - i.discountAmount) * i.quantity)}</td>
    </tr>`).join('')

    const payLinesClassic = payments.map((p) =>
      `<tr><td>${METHOD_LABELS[p.method] ?? p.method} (${p.currency ?? storeCurrency})</td><td style="text-align:right">${fmt(p)}</td></tr>`
    ).join('')

    const logoHtml = cfg.showLogo && cfg.logoBase64
      ? `<div style="text-align:center;margin-bottom:8px"><img src="${cfg.logoBase64}" style="max-height:60px;max-width:200px;object-fit:contain" alt="Logo"/></div>`
      : ''

    const classicHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt #${order.orderNumber}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  @page{size:auto;margin:0}
  body{font-family:'Courier New',monospace;font-size:12px;width:300px;margin:0 auto;padding:12px}
  h1{font-size:16px;text-align:center;margin-bottom:4px}
  .center{text-align:center} .divider{border-top:1px dashed #000;margin:8px 0}
  table{width:100%;border-collapse:collapse} td{padding:2px 0;vertical-align:top}
  .total-row td{font-weight:bold;border-top:1px solid #000;padding-top:4px}
  .meta{font-size:11px;color:#555} .footer{text-align:center;margin-top:12px;font-size:11px}
  .change{color:#059669}
  @media print{body{width:100%;padding:6px}}
</style></head><body>
  ${logoHtml}
  <h1>${esc(storeName)}</h1>
  ${storeAddress || storePhone ? `<p class="center meta">${[storeAddress, storePhone].filter(Boolean).map(esc).join(' &bull; ')}</p>` : ''}
  <p class="center meta">*** REPRINT ***</p>
  <p class="center meta">Order #${order.orderNumber}</p>
  <p class="center meta">${new Date(order.createdAt).toLocaleString()}</p>
  <div class="divider"></div>
  <table><thead><tr>
    <td><b>Item</b></td><td style="text-align:center"><b>Qty</b></td>
    <td style="text-align:right"><b>Price</b></td><td style="text-align:right"><b>Disc</b></td>
    <td style="text-align:right"><b>Line</b></td>
  </tr></thead><tbody>${lineItemsClassic}</tbody></table>
  <div class="divider"></div>
  <table>
    ${showSubtotal ? `<tr><td>Subtotal</td><td style="text-align:right">${fmtKyd(order.subtotal)}</td></tr>` : ''}
    ${order.discountAmount > 0 ? `<tr><td>Discount</td><td style="text-align:right">-${fmtKyd(order.discountAmount)}</td></tr>` : ''}
    ${order.taxAmount > 0 ? `<tr><td>Tax</td><td style="text-align:right">${fmtKyd(order.taxAmount)}</td></tr>` : ''}
    <tr class="total-row"><td>TOTAL</td><td style="text-align:right">${fmtKyd(order.total)}</td></tr>
  </table>
  <div class="divider"></div>
  <table>
    <tr><td colspan="2"><b>Payment</b></td></tr>
    ${payLinesClassic}
    ${changeAmt > 0.005 ? `<tr class="change"><td>Change (${changeCurrCode})</td><td style="text-align:right">${changeCurrSym}${changeAmt.toFixed(2)}</td></tr>` : ''}
  </table>
  ${order.notes ? `<div class="divider"></div><p>Note: ${esc(order.notes)}</p>` : ''}
  <p class="footer">${esc(cfg.footer)}</p>
</body></html>`

    // ── Modern template ───────────────────────────────────────────────────────
    if (cfg.template === 'modern') {
      const payLinesModern = payments.map((p) =>
        `<div class="payment-row"><span>${METHOD_LABELS[p.method] ?? p.method} (${p.currency ?? storeCurrency})</span><span>${fmt(p)}</span></div>`
      ).join('')

      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt #${order.orderNumber}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  @page{size:auto;margin:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;width:380px;margin:0 auto;background:#fff}
  .header{background:#1e293b;color:#fff;padding:20px 24px;text-align:center}
  .header h1{font-size:20px;font-weight:800}
  .header p{font-size:12px;color:#94a3b8;margin-top:4px}
  .body{padding:20px 24px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;padding:6px 0}
  td{padding:7px 0;font-size:13px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  td:last-child,th:last-child{text-align:right}
  .total-section{border-top:2px solid #1e293b;padding-top:12px;margin-top:4px}
  .total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#475569}
  .grand-total{font-size:18px;font-weight:800;color:#1e293b;margin-top:8px}
  .payment-section{background:#f8fafc;border-radius:8px;padding:12px 16px;margin-top:16px}
  .payment-row{display:flex;justify-content:space-between;font-size:13px;color:#475569;padding:3px 0}
  .footer{text-align:center;padding:20px 24px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;margin-top:16px}
  @media print{body{width:100%;margin:0}}
</style></head><body>
  <div class="header">
    ${cfg.showLogo && cfg.logoBase64 ? `<img src="${cfg.logoBase64}" style="max-height:50px;max-width:180px;object-fit:contain;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto" alt="Logo"/>` : ''}
    <h1>${esc(storeName)}</h1>
    ${storeAddress || storePhone ? `<p style="font-size:11px;color:#94a3b8;margin-top:2px">${[storeAddress, storePhone].filter(Boolean).map(esc).join(' &bull; ')}</p>` : ''}
    <p>REPRINT &bull; Order #${order.orderNumber} &bull; ${new Date(order.createdAt).toLocaleString()}</p>
  </div>
  <div class="body">
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
      <tbody>${items.map((i) => `<tr><td>${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td><td>${i.quantity}</td><td>${fmtKyd((i.unitPrice - i.discountAmount) * i.quantity)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="total-section">
      ${showSubtotal ? `<div class="total-row"><span>Subtotal</span><span>${fmtKyd(order.subtotal)}</span></div>` : ''}
      ${order.discountAmount > 0 ? `<div class="total-row" style="color:#10b981"><span>Discount</span><span>-${fmtKyd(order.discountAmount)}</span></div>` : ''}
      ${order.taxAmount > 0 ? `<div class="total-row"><span>Tax</span><span>${fmtKyd(order.taxAmount)}</span></div>` : ''}
      <div class="total-row grand-total"><span>Total</span><span>${fmtKyd(order.total)}</span></div>
    </div>
    <div class="payment-section">
      ${payLinesModern}
      ${changeAmt > 0.005 ? `<div class="payment-row" style="color:#10b981"><span>Change (${changeCurrCode})</span><span>${changeCurrSym}${changeAmt.toFixed(2)}</span></div>` : ''}
    </div>
    ${order.notes ? `<p style="margin-top:12px;font-size:12px;color:#64748b">Note: ${esc(order.notes)}</p>` : ''}
  </div>
  <div class="footer">${esc(cfg.footer)}</div>
</body></html>`
    }

    // ── Minimal template ──────────────────────────────────────────────────────
    if (cfg.template === 'minimal') {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page{size:auto;margin:0}
      body{font-family:'Courier New',monospace;font-size:11px;width:260px;margin:0 auto;padding:8px}
      pre{white-space:pre-wrap;margin:0}
      @media print{body{width:100%;padding:4px}}
    </style></head><body>${logoHtml}<pre>${esc(storeName)}
${storeAddress ? esc(storeAddress) + '\n' : ''}${storePhone ? esc(storePhone) + '\n' : ''}REPRINT #${order.orderNumber} ${new Date(order.createdAt).toLocaleDateString()}
${'='.repeat(32)}
${items.map((i) => `${i.quantity}x ${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''} ${fmtKyd((i.unitPrice - i.discountAmount) * i.quantity)}`).join('\n')}
${'-'.repeat(32)}
TOTAL: ${fmtKyd(order.total)}
${payments.map((p) => `${METHOD_LABELS[p.method] ?? p.method} (${p.currency ?? storeCurrency}): ${fmt(p)}`).join('\n')}
${changeAmt > 0.005 ? `Change: ${changeCurrSym}${changeAmt.toFixed(2)}` : ''}
${esc(cfg.footer)}</pre></body></html>`
    }

    // Default → classic
    return classicHtml
  }

  /** Reprint a receipt using the saved receipt template from settings. */
  async function handleReprint(order: Order, items: OrderItem[], payments: Payment[]) {
    try {
      const s = await api.settings.getAll()
      const cfg = {
        template:   s.receiptTemplate  ?? 'classic',
        showLogo:   (s.receiptShowLogo ?? 'true') === 'true',
        footer:     s.receiptFooterText ?? 'Thank you for your business!',
        logoBase64: s.logoBase64 ?? '',
      }
      const storeName = s.storeName ?? ''
      const html = buildReprintReceiptHtml(order, items, payments, storeName, cfg, s.storeAddress ?? '', s.storePhone ?? '')
      const result = await api.receipt.print(html)
      if (result?.success) {
        showToast('Receipt reprinted', 'success')
      } else {
        showToast('Print failed — check printer settings', 'error')
      }
    } catch {
      showToast('Print failed — check printer settings', 'error')
    }
  }

  function buildInvoiceHtml(
    order: Order, items: OrderItem[], payments: Payment[],
    storeName: string, storeAddress: string, storePhone: string,
    logoBase64: string, showLogo: boolean, footerText: string
  ): string {
    const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`
    const isPaid = order.status === 'completed' || order.status === 'refunded' || order.status === 'delivered'
    const itemRows = items.map((i) => `
      <tr>
        <td class="item-name">${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td>
        <td class="item-center">${i.quantity}</td>
        <td class="item-right">${fmt(i.unitPrice)}</td>
        ${order.discountAmount > 0 ? `<td class="item-right">${i.discountAmount > 0 ? `-${fmt(i.discountAmount)}` : '—'}</td>` : ''}
        <td class="item-right item-bold">${fmt((i.unitPrice - i.discountAmount) * i.quantity)}</td>
      </tr>`).join('')
    // Build payment rows with change given sub-row for cash payments
    const payRows = payments.map((p) => {
      const changeGiven = (p.changeGiven ?? 0) > 0.005
        ? `<div class="pay-row" style="color:#10b981;font-size:12px"><span style="padding-left:12px">↳ Change given</span><span>${fmt(p.changeGiven!)}</span></div>`
        : ''
      return `<div class="pay-row"><span style="text-transform:capitalize">${p.method.replace(/_/g, ' ')}</span><span>${fmt(p.amount)}</span></div>${changeGiven}`
    }).join('')

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Invoice #${order.orderNumber}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;color:#1e293b;background:#fff;padding:40px}
  .page{max-width:750px;margin:0 auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #e2e8f0}
  .store-info h1{font-size:22px;font-weight:800;color:#1e293b;margin-bottom:4px}
  .store-info p{font-size:12px;color:#64748b;line-height:1.6}
  .logo{max-height:70px;max-width:200px;object-fit:contain}
  .invoice-meta{text-align:right}
  .invoice-title{font-size:28px;font-weight:900;color:#3b82f6;letter-spacing:-1px}
  .invoice-meta p{font-size:12px;color:#64748b;margin-top:4px}
  .invoice-meta strong{color:#1e293b}
  .paid-stamp{display:inline-block;border:3px solid #10b981;color:#10b981;font-weight:900;font-size:22px;letter-spacing:2px;padding:4px 16px;border-radius:4px;transform:rotate(-8deg);margin-top:8px;opacity:0.85}
  .unpaid-stamp{display:inline-block;border:3px solid #ef4444;color:#ef4444;font-weight:900;font-size:22px;letter-spacing:2px;padding:4px 16px;border-radius:4px;transform:rotate(-8deg);margin-top:8px;opacity:0.85}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  thead tr{background:#f8fafc;border-bottom:2px solid #e2e8f0}
  th{padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px}
  td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  .item-center{text-align:center} .item-right{text-align:right} .item-bold{font-weight:600}
  .totals{margin-left:auto;width:260px}
  .totals-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9}
  .totals-total{font-size:16px;font-weight:800;color:#1e293b;border-top:2px solid #1e293b;padding-top:10px;margin-top:4px;display:flex;justify-content:space-between}
  .payments{margin-top:24px;background:#f8fafc;border-radius:8px;padding:16px 20px}
  .payments h3{font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:10px}
  .pay-row{display:flex;justify-content:space-between;font-size:13px;color:#475569;padding:3px 0;text-transform:capitalize}
  .footer{margin-top:48px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8}
  @media print{body{padding:20px} @page{margin:1cm}}
</style></head><body><div class="page">
  <div class="header">
    <div class="store-info">
      ${showLogo && logoBase64 ? `<img class="logo" src="${logoBase64}" alt="Logo" style="margin-bottom:10px;display:block"/>` : ''}
      <h1>${esc(storeName)}</h1>
      <p>${storeAddress ? esc(storeAddress) + '<br>' : ''}${esc(storePhone)}</p>
    </div>
    <div class="invoice-meta">
      <div class="invoice-title">INVOICE</div>
      <p><strong>#${order.orderNumber}</strong></p>
      <p>Date: <strong>${new Date(order.createdAt).toLocaleDateString()}</strong></p>
      <p>Time: <strong>${new Date(order.createdAt).toLocaleTimeString()}</strong></p>
      <div class="${isPaid ? 'paid-stamp' : 'unpaid-stamp'}">${isPaid ? 'PAID' : 'UNPAID'}</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th>
      ${order.discountAmount > 0 ? '<th style="text-align:right">Discount</th>' : ''}
      <th style="text-align:right">Amount</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="totals">
    ${order.taxAmount > 0 ? `<div class="totals-row"><span>Subtotal</span><span>${fmt(order.subtotal)}</span></div>` : ''}
    ${order.discountAmount > 0 ? `<div class="totals-row" style="color:#10b981"><span>Discount</span><span>-${fmt(order.discountAmount)}</span></div>` : ''}
    ${order.taxAmount > 0 ? `<div class="totals-row"><span>Tax</span><span>${fmt(order.taxAmount)}</span></div>` : ''}
    <div class="totals-total"><span>Total</span><span>${fmt(order.total)}</span></div>
  </div>
  ${payments.length > 0 ? `<div class="payments"><h3>Payment Details</h3>${payRows}</div>` : ''}
  ${order.notes ? `<p style="margin-top:24px;font-size:12px;color:#64748b"><strong>Notes:</strong> ${esc(order.notes)}</p>` : ''}
  <div class="footer">${esc(footerText)}</div>
</div></body></html>`
  }

  async function handlePrintInvoice(order: Order, items: OrderItem[], payments: Payment[]) {
    try {
      const s = await api.settings.getAll()
      const html = buildInvoiceHtml(
        order, items, payments,
        s.storeName ?? '',
        s.storeAddress ?? '',
        s.storePhone ?? '',
        s.logoBase64 ?? '',
        (s.invoiceShowLogo ?? 'true') === 'true',
        s.invoiceFooterText ?? 'Payment due on receipt. Thank you!'
      )
      const result = await api.invoice.print(html)
      if (result?.success) {
        showToast('Invoice printed', 'success')
      } else {
        showToast('Invoice print failed — check printer settings', 'error')
      }
    } catch {
      showToast('Invoice print failed', 'error')
    }
  }

  // Derived data

  const filtered = orders.filter(
    (o) =>
      !search ||
      o.orderNumber.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header + search */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Order History</h1>
        <div className="flex gap-3 items-center">
          <Input
            placeholder="Search by order number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search size={14} />}
            className="max-w-sm"
          />
          <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={load}>
            Refresh
          </Button>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 mt-4 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === tab.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Order #', 'Date', 'Type', 'Status', 'Total', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((order) => {
                  const ot = (order as unknown as { orderType?: string }).orderType ?? 'instore'
                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono font-medium text-blue-600">{order.orderNumber}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDateTime(order.createdAt)}</td>
                      <td className="px-4 py-3">
                        {ot === 'delivery' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                            <Truck size={10} /> Delivery
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            <Package size={10} /> In-Store
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={STATUS_COLORS[order.status] ?? 'gray'}>
                          {order.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatCurrency(order.total)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 flex-wrap">
                          <Button size="sm" variant="ghost" icon={<Eye size={12} />} onClick={() => viewOrder(order)}>
                            View
                          </Button>
                          {(order.status === 'pending' || order.status === 'held') && (
                            <Button size="sm" variant="ghost" icon={<Edit3 size={12} />} onClick={() => editOrder(order)}
                              className="text-blue-600 hover:text-blue-800">
                              Edit
                            </Button>
                          )}
                          {(order.status === 'pending' || order.status === 'completed') && (
                            <Button size="sm" variant="ghost" icon={<CheckCircle size={12} />}
                              onClick={() => updateStatus(order, 'delivered')}
                              className="text-purple-600 hover:text-purple-800">
                              Delivered
                            </Button>
                          )}
                          {order.status === 'pending' && (
                            <Button size="sm" variant="ghost" icon={<XCircle size={12} />}
                              onClick={() => updateStatus(order, 'canceled')}
                              className="text-red-500 hover:text-red-700">
                              Cancel
                            </Button>
                          )}
                          {(order.status === 'completed' || order.status === 'delivered') && (
                            <Button size="sm" variant="ghost" icon={<Undo2 size={12} />}
                              onClick={() => refundOrder(order)}
                              className="text-orange-600 hover:text-orange-800">
                              Refund
                            </Button>
                          )}
                          {order.status === 'held' && (
                            <Button size="sm" variant="ghost" icon={<Ban size={12} />}
                              onClick={() => voidOrder(order)}
                              className="text-red-500 hover:text-red-700">
                              Void
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && !loading && (
              <div className="py-16 text-center text-gray-400 text-sm">No orders found</div>
            )}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <Modal
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          title={`Order ${selected.order.orderNumber}`}
          size="lg"
          footer={
            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
              {(selected.order.status === 'pending' || selected.order.status === 'held') && (
                <Button variant="ghost" icon={<Edit3 size={14} />}
                  onClick={() => editOrder(selected.order)}
                  className="text-blue-600">
                  Edit Order
                </Button>
              )}
              {(selected.order.status === 'pending' || selected.order.status === 'completed') && (
                <Button variant="ghost" icon={<CheckCircle size={14} />}
                  onClick={() => updateStatus(selected.order, 'delivered')}
                  className="text-purple-600">
                  Mark Delivered
                </Button>
              )}
              {selected.order.status === 'pending' && (
                <Button variant="ghost" icon={<XCircle size={14} />}
                  onClick={() => updateStatus(selected.order, 'canceled')}
                  className="text-red-500">
                  Cancel Order
                </Button>
              )}
              {(selected.order.status === 'completed' || selected.order.status === 'delivered') && (
                <Button variant="ghost" icon={<Undo2 size={14} />}
                  onClick={() => refundOrder(selected.order)}>
                  Refund
                </Button>
              )}
              {selected.order.status === 'held' && (
                <Button variant="ghost" icon={<Ban size={14} />}
                  onClick={() => voidOrder(selected.order)}
                  className="text-red-500">
                  Void
                </Button>
              )}
              <Button variant="ghost" icon={<Printer size={14} />}
                onClick={() => handleReprint(selected.order, selected.items, selected.payments)}>
                Reprint
              </Button>
              <Button variant="ghost" icon={<FileText size={14} />}
                onClick={() => handlePrintInvoice(selected.order, selected.items, selected.payments)}>
                Invoice
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Meta */}
            <div className="flex gap-4 flex-wrap text-sm text-gray-600">
              <span><strong>Date:</strong> {formatDateTime(selected.order.createdAt)}</span>
              <span>
                <strong>Status:</strong>{' '}
                <Badge color={STATUS_COLORS[selected.order.status] ?? 'gray'}>
                  {selected.order.status}
                </Badge>
              </span>
              <span>
                <strong>Type:</strong>{' '}
                {(selected.order as unknown as { orderType?: string }).orderType === 'delivery' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                    <Truck size={10} /> Delivery
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    <Package size={10} /> In-Store
                  </span>
                )}
              </span>
            </div>

            {/* Items */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Product', 'Qty', 'Unit Price', 'Total'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selected.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        {item.productName}
                        {item.variantName && <span className="text-xs text-gray-400 ml-1">({item.variantName})</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                      <td className="px-3 py-2 text-gray-600">{formatCurrency(item.unitPrice)}</td>
                      <td className="px-3 py-2 font-semibold">{formatCurrency(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span><span>{formatCurrency(selected.order.subtotal)}</span>
              </div>
              {selected.order.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount</span><span>-{formatCurrency(selected.order.discountAmount)}</span>
                </div>
              )}
              {selected.order.taxAmount > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Tax</span><span>{formatCurrency(selected.order.taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200">
                <span>Total</span><span className="text-blue-600">{formatCurrency(selected.order.total)}</span>
              </div>
            </div>

            {/* Payments */}
            {selected.payments.length > 0 && (
              <div className="text-sm">
                <p className="font-semibold text-gray-700 mb-2">Payments</p>
                {selected.payments.map((p) => (
                  <div key={p.id} className="py-1 border-b border-gray-100 last:border-0">
                    <div className="flex justify-between text-gray-600">
                      <span className="capitalize flex items-center gap-1.5">
                        {p.method.replace(/_/g, ' ')}
                        <span className="text-xs font-semibold text-gray-400 uppercase">
                          {p.currency ?? storeCurrency}
                        </span>
                      </span>
                      {/* Show amount the customer actually tendered in their currency */}
                      <span>
                        {CURRENCIES[p.currency]?.symbol ?? p.currency}
                        {(p.originalAmount ?? p.amount).toFixed(2)}
                      </span>
                    </div>
                    {p.changeGiven != null && p.changeGiven > 0.005 && (
                      <div className="flex justify-between text-xs text-emerald-600 mt-0.5">
                        {/* Change is always in primary/store currency */}
                        <span>Change ({storeCurrency})</span>
                        <span>{CURRENCIES[storeCurrency]?.symbol ?? storeCurrency}{p.changeGiven.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Notes */}
            {selected.order.notes && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                <strong>Notes:</strong> {selected.order.notes}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
