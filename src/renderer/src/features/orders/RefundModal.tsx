import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Modal } from '../../components/ui'
import { formatCurrency } from '../../lib/currency'
import { useUiStore } from '../../stores/ui.store'
import { useCartStore } from '../../stores/cart.store'
import { ROUTES } from '../../constants'
import type { Order, OrderItem, RefundItemInput } from '../../types'

interface RefundModalProps {
  orderId: string
  onClose: () => void
  onRefunded: () => void
}

/** Remaining refundable quantity for a line — never negative even if data is inconsistent. */
function remaining(item: OrderItem): number {
  return Math.max(0, item.quantity - item.refundedQuantity)
}

export function RefundModal({ orderId, onClose, onRefunded }: RefundModalProps) {
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [selections, setSelections] = useState<Record<string, number>>({})
  const [returnToCart, setReturnToCart] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const showToast = useUiStore((s) => s.showToast)
  const cartStore = useCartStore()
  const navigate = useNavigate()

  useEffect(() => {
    api.orders.get(orderId).then((full) => {
      if (full) { setOrder(full.order); setItems(full.items) }
      setLoading(false)
    })
  }, [orderId])

  function setQty(item: OrderItem, qty: number) {
    const clamped = Math.max(0, Math.min(qty, remaining(item)))
    setSelections((s) => ({ ...s, [item.id]: clamped }))
    setError('')
  }

  const refundableItems = items.filter((i) => remaining(i) > 0)
  const hasSelection = Object.values(selections).some((q) => q > 0)

  // Mirrors the server-side proration in order.service.ts's refund() so the preview
  // matches what actually gets refunded: each line's share of the order's subtotal
  // carries the same share of the order-level discount and tax.
  const preview = (() => {
    if (!order) return { subtotal: 0, discount: 0, tax: 0, total: 0 }
    let subtotal = 0, discount = 0, tax = 0, total = 0
    for (const item of refundableItems) {
      const qty = selections[item.id] ?? 0
      if (qty <= 0) continue
      const itemSubtotalPortion = (item.lineTotal / item.quantity) * qty
      const shareOfOrder = order.subtotal > 0 ? itemSubtotalPortion / order.subtotal : 0
      const orderDiscountPortion = order.discountAmount * shareOfOrder
      const orderTaxPortion = order.taxAmount * shareOfOrder
      subtotal += itemSubtotalPortion
      discount += orderDiscountPortion
      tax += orderTaxPortion
      total += itemSubtotalPortion - orderDiscountPortion + orderTaxPortion
    }
    return { subtotal, discount, tax, total }
  })()

  async function handleSubmit() {
    if (!hasSelection) return
    setSubmitting(true)
    setError('')
    try {
      const refundItems: RefundItemInput[] = Object.entries(selections)
        .filter(([, qty]) => qty > 0)
        .map(([orderItemId, quantity]) => ({ orderItemId, quantity }))

      await api.orders.refund(orderId, refundItems)
      showToast('Refund processed', 'success')

      if (returnToCart) {
        for (const { orderItemId, quantity } of refundItems) {
          const item = items.find((i) => i.id === orderItemId)
          if (!item) continue
          // orderItems doesn't store a per-line tax rate (tax is order-level only) —
          // use the product's current rate, same source ProductGrid uses when adding.
          let taxRate = 0
          try {
            const product = await api.products.get(item.productId)
            taxRate = product?.taxRate ?? 0
          } catch { /* fall back to 0 */ }
          cartStore.addItem({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            productName: item.productName,
            variantName: item.variantName ?? undefined,
            sku: item.sku,
            quantity,
            unitPrice: item.unitPrice,
            taxRate
          })
        }
        navigate(ROUTES.POS)
      }

      onRefunded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={order ? `Refund ${order.orderNumber}` : 'Refund'}
      size="lg"
      footer={
        <div className="flex gap-2 justify-end w-full">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            variant="danger"
            onClick={handleSubmit}
            disabled={!hasSelection || submitting}
            loading={submitting}
          >
            Refund {hasSelection ? formatCurrency(preview.total) : ''}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="py-10 text-center text-gray-400 text-sm">Loading order…</div>
      ) : refundableItems.length === 0 ? (
        <div className="py-10 text-center text-gray-400 text-sm">Nothing left to refund on this order.</div>
      ) : (
        <div className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Product', 'Sold', 'Already Refunded', 'Refund Qty'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {refundableItems.map((item) => {
                  const max = remaining(item)
                  const qty = selections[item.id] ?? 0
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        {item.productName}
                        {item.variantName && <span className="text-xs text-gray-400 ml-1">({item.variantName})</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{item.quantity}</td>
                      <td className="px-3 py-2 text-gray-600">{item.refundedQuantity > 0 ? item.refundedQuantity : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center border border-gray-200 rounded-lg w-fit">
                          <button
                            type="button"
                            onClick={() => setQty(item, qty - 1)}
                            disabled={qty <= 0}
                            className="p-1.5 hover:bg-gray-100 rounded-l-lg text-gray-500 disabled:opacity-30"
                            aria-label="Decrease refund quantity"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="px-3 text-sm font-medium text-gray-900 min-w-[32px] text-center">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => setQty(item, qty + 1)}
                            disabled={qty >= max}
                            className="p-1.5 hover:bg-gray-100 rounded-r-lg text-gray-500 disabled:opacity-30"
                            aria-label="Increase refund quantity"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">of {max} remaining</p>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {hasSelection && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Refund subtotal</span><span>{formatCurrency(preview.subtotal)}</span>
              </div>
              {preview.discount > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Discount</span><span>-{formatCurrency(preview.discount)}</span>
                </div>
              )}
              {preview.tax > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Tax</span><span>{formatCurrency(preview.tax)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-200">
                <span>Total refund</span><span>{formatCurrency(preview.total)}</span>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={returnToCart}
              onChange={(e) => setReturnToCart(e.target.checked)}
              className="rounded border-gray-300"
            />
            Bring these items back to the sales screen for an exchange
          </label>
        </div>
      )}
    </Modal>
  )
}
