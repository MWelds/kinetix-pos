import React, { useState, useEffect } from 'react'
import { ProductGrid } from './ProductGrid'
import { CartPanel } from './CartPanel'
import { PaymentModal } from './PaymentModal'
import { HeldOrdersModal } from './HeldOrdersModal'
import { useCartStore } from '../../stores/cart.store'
import { useAuthStore } from '../../stores/auth.store'
import { useUiStore } from '../../stores/ui.store'
import { useLogoStore } from '../../stores/logo.store'
import { api } from '../../lib/api'
import { CURRENCIES } from '../../lib/currency'

/** Escape a string for safe interpolation into HTML. */
function esc(s: string | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function POSScreen() {
  const [showPayment, setShowPayment] = useState(false)
  const [showHeld, setShowHeld] = useState(false)
  const [heldCount, setHeldCount] = useState(0)
  const { items, orderType, customer, notes, discountType, discountValue, taxRate, taxEnabled, clearCart } = useCartStore()
  const { staff, shift } = useAuthStore()
  const showToast = useUiStore((s) => s.showToast)
  const logoBase64 = useLogoStore((s) => s.logoBase64)

  useEffect(() => {
    api.settings.get('taxRate').then((rate) => {
      useCartStore.getState().setTaxRate(parseFloat(rate) || 0.08)
    })
    refreshHeldCount()
  }, [])

  async function refreshHeldCount() {
    const held = await api.orders.heldList()
    setHeldCount(held.length)
  }

  async function handleHold() {
    if (!items.length) return
    try {
      const orderInput = {
        staffId: staff?.id,
        orderType,
        items: items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount
        }))
      }
      const result = await api.orders.create(orderInput)
      await api.orders.hold((result as { order: { id: string } }).order.id)
      clearCart()
      refreshHeldCount()
      showToast('Order held', 'info')
    } catch {
      showToast('Failed to hold order', 'error')
    }
  }

  /**
   * Pay Later: creates a pending delivery order (no payment), prints an invoice
   * so the customer has a record, and clears the cart.
   */
  async function handlePayLater() {
    if (!items.length || orderType !== 'delivery') return
    try {
      const cartState = useCartStore.getState()
      const sub = cartState.subtotal()
      const disc = cartState.discountAmount()
      const tax = cartState.taxAmount()
      const tot = cartState.total()

      const orderInput = {
        staffId: staff?.id,
        shiftId: shift?.id,
        orderType: 'delivery' as const,
        customerId: customer?.id,
        notes: notes || undefined,
        manualDiscountType: discountType ?? undefined,
        manualDiscountValue: discountValue > 0 ? discountValue : undefined,
        taxRate: taxEnabled ? taxRate : 0,
        items: items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          notes: item.notes
        }))
      }

      const result = await api.orders.create(orderInput) as { order: { id: string; orderNumber: string }; items: unknown[] }
      const { order } = result

      // Build and print the Pay Later invoice
      const settings = await api.settings.getAll()
      const storeName = settings.storeName ?? 'My Store'
      const storeAddress = settings.storeAddress ?? ''
      const storePhone = settings.storePhone ?? ''
      const showLogo = (settings.invoiceShowLogo ?? 'true') === 'true'
      const footer = settings.invoiceFooterText ?? 'Payment due on receipt. Thank you!'
      const sym = CURRENCIES['USD'].symbol

      const logoHtml = showLogo && logoBase64
        ? `<img src="${logoBase64}" style="max-height:60px;max-width:200px;object-fit:contain" alt="Logo"/>`
        : ''
      const fmtAmt = (n: number) => `${sym}${n.toFixed(2)}`

      const rows = items.map((i) =>
        `<tr>
          <td style="padding:8px 12px">${esc(i.productName)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td>
          <td style="padding:8px 12px;text-align:center">${i.quantity}</td>
          <td style="padding:8px 12px;text-align:right">${fmtAmt(i.unitPrice)}</td>
          <td style="padding:8px 12px;text-align:right;font-weight:600">${fmtAmt((i.unitPrice - i.discountAmount) * i.quantity)}</td>
        </tr>`
      ).join('')

      const customerName = customer ? `${customer.firstName} ${customer.lastName}` : ''

      const invoiceHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:'Segoe UI',sans-serif;color:#1e293b;margin:0;padding:32px 40px;font-size:13px}
  h1{margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px}
  table{width:100%;border-collapse:collapse}
  thead tr{background:#1e293b;color:#fff}
  th{padding:9px 12px;text-align:left;font-weight:600;font-size:12px}
  tbody tr:nth-child(even){background:#f8fafc}
  .totals td{padding:4px 0;font-size:13px}
  .grand-total{font-size:16px;font-weight:700;border-top:2px solid #1e293b;padding-top:8px!important}
  .due-stamp{display:inline-block;border:2px solid #f97316;color:#f97316;border-radius:4px;padding:2px 10px;font-size:12px;font-weight:700;letter-spacing:1px}
  .section{background:#f8fafc;border-radius:8px;padding:12px 16px;margin-bottom:16px}
  .footer{margin-top:24px;padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:11px;color:#64748b;text-align:center}
</style>
</head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
  <div>${logoHtml}<div style="margin-top:${logoHtml ? 8 : 0}px"><strong style="font-size:16px">${esc(storeName)}</strong>
    ${storeAddress ? `<div style="color:#64748b;font-size:12px;margin-top:2px">${esc(storeAddress)}</div>` : ''}
    ${storePhone ? `<div style="color:#64748b;font-size:12px">${esc(storePhone)}</div>` : ''}
  </div></div>
  <div style="text-align:right"><h1>INVOICE</h1>
    <div style="color:#64748b;font-size:12px;margin-top:4px">#${order.orderNumber}</div>
    <div style="color:#64748b;font-size:12px">${new Date().toLocaleDateString()}</div>
    <div style="margin-top:8px"><span class="due-stamp">PAYMENT DUE</span></div>
  </div>
</div>
${customerName ? `<div class="section"><div style="font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Bill To</div><strong>${esc(customerName)}</strong></div>` : ''}
<table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody></table>
<div style="display:flex;justify-content:flex-end;margin-top:16px">
  <table class="totals" style="width:220px">
    <tr><td>Subtotal</td><td style="text-align:right">${fmtAmt(sub)}</td></tr>
    ${disc > 0 ? `<tr><td>Discount</td><td style="text-align:right;color:#10b981">-${fmtAmt(disc)}</td></tr>` : ''}
    ${tax > 0 ? `<tr><td>Tax</td><td style="text-align:right">${fmtAmt(tax)}</td></tr>` : ''}
    <tr class="grand-total"><td>Amount Due</td><td style="text-align:right">${fmtAmt(tot)}</td></tr>
  </table>
</div>
${footer ? `<div class="footer">${esc(footer)}</div>` : ''}
</body></html>`

      try {
        await api.invoice.print(invoiceHtml)
      } catch {
        // Non-fatal: order is saved even if printing fails
        showToast('Invoice saved. Print failed — check printer settings.', 'error')
      }

      clearCart()
      showToast(`Order ${order.orderNumber} saved — invoice sent to printer`, 'success')
    } catch (err) {
      showToast(`Failed to save order: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0">
        <ProductGrid />
      </div>
      <div className="w-[380px] shrink-0 flex flex-col">
        <CartPanel
          onCheckout={() => setShowPayment(true)}
          onHold={handleHold}
          onShowHeld={() => setShowHeld(true)}
          onPayLater={handlePayLater}
        />
      </div>

      <PaymentModal
        isOpen={showPayment}
        onClose={() => setShowPayment(false)}
        onComplete={(orderNum) => {
          setShowPayment(false)
          refreshHeldCount()
          showToast(`Order #${orderNum} completed!`, 'success')
        }}
      />
      <HeldOrdersModal
        isOpen={showHeld}
        onClose={() => setShowHeld(false)}
        onRefresh={() => refreshHeldCount()}
      />
    </div>
  )
}
