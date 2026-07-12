import React, { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'
import { ProductGrid } from './ProductGrid'
import { CartPanel } from './CartPanel'
import { PaymentModal } from './PaymentModal'
import { HeldOrdersModal } from './HeldOrdersModal'
import { ShiftModal } from '../staff/ShiftModal'
import { useCartStore } from '../../stores/cart.store'
import { useAuthStore } from '../../stores/auth.store'
import { useUiStore } from '../../stores/ui.store'
import { useLogoStore } from '../../stores/logo.store'
import { api } from '../../lib/api'
import { CURRENCIES } from '../../lib/currency'
import { buildInvoiceHtml } from '../../lib/invoice-template'

export function POSScreen() {
  const [showPayment, setShowPayment] = useState(false)
  const [showHeld, setShowHeld] = useState(false)
  const [, setHeldCount] = useState(0)
  const [showShiftModal, setShowShiftModal] = useState(false)
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
    if (!shift) { setShowShiftModal(true); return }
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

      // Build and print the Pay Later invoice (shared template — honors all invoice settings)
      const settings = await api.settings.getAll()
      const customerName = customer ? `${customer.firstName} ${customer.lastName}` : undefined

      const invoiceHtml = buildInvoiceHtml(
        {
          orderNumber: order.orderNumber,
          date: new Date(),
          isPaid: false,
          customerName,
          items: items.map((i) => ({
            name: i.productName,
            variantName: i.variantName,
            sku: i.sku,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discountAmount: i.discountAmount
          })),
          subtotal: sub,
          discountAmount: disc,
          taxAmount: tax,
          total: tot,
          payments: [],
          notes: notes || undefined
        },
        {
          storeName: settings.storeName ?? '',
          storeAddress: settings.storeAddress ?? '',
          storePhone: settings.storePhone ?? '',
          logoBase64: logoBase64 ?? '',
          currencySymbol: CURRENCIES['USD'].symbol
        },
        settings
      )

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
      {/* Cart panel — gated behind an active shift */}
      <div className="w-[380px] shrink-0 flex flex-col relative">
        <CartPanel
          onCheckout={() => {
            if (!shift) { setShowShiftModal(true); return }
            setShowPayment(true)
          }}
          onHold={handleHold}
          onShowHeld={() => setShowHeld(true)}
          onPayLater={handlePayLater}
        />

        {/* Shift gate overlay — rendered on top when no shift is open */}
        {!shift && (
          <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-20 rounded-r-none">
            <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center">
              <Clock size={32} className="text-amber-600" />
            </div>
            <div className="text-center px-6">
              <h3 className="text-base font-semibold text-gray-900 mb-1">No Active Shift</h3>
              <p className="text-sm text-gray-500">You must open a shift before processing sales.</p>
            </div>
            <button
              onClick={() => setShowShiftModal(true)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm"
            >
              Open Shift
            </button>
          </div>
        )}
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
      <ShiftModal isOpen={showShiftModal} onClose={() => setShowShiftModal(false)} />
    </div>
  )
}
