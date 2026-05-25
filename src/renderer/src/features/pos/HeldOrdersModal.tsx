import React, { useState, useEffect } from 'react'
import { Clock, ShoppingCart } from 'lucide-react'
import { Modal, Button } from '../../components/ui'
import { api } from '../../lib/api'
import { useCartStore } from '../../stores/cart.store'
import { useUiStore } from '../../stores/ui.store'
import { formatCurrency } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import type { Order } from '../../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  onRefresh: () => void
}

export function HeldOrdersModal({ isOpen, onClose, onRefresh }: Props) {
  const [orders, setOrders] = useState<Order[]>([])
  const addItem = useCartStore((s) => s.addItem)
  const clearCart = useCartStore((s) => s.clearCart)
  const showToast = useUiStore((s) => s.showToast)

  useEffect(() => {
    if (isOpen) api.orders.heldList().then(setOrders)
  }, [isOpen])

  async function restoreOrder(order: Order) {
    try {
      const full = await api.orders.get(order.id)
      if (!full) return
      clearCart()
      for (const item of (full as { items: { productId: string; productName: string; sku: string; quantity: number; unitPrice: number; variantId?: string; variantName?: string }[] }).items) {
        addItem({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          variantId: item.variantId,
          variantName: item.variantName,
          taxRate: 0.08
        })
      }
      // Void the held order
      await api.orders.voidOrder(order.id, '')
      onRefresh()
      onClose()
      showToast('Order restored to cart', 'success')
    } catch {
      showToast('Failed to restore order', 'error')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Held Orders" size="md">
      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-gray-400">
          <Clock size={32} />
          <p className="text-sm">No held orders</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <div key={order.id} className="border border-gray-200 rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm text-gray-900">{order.orderNumber}</p>
                <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleString()}</p>
                <p className="text-sm font-bold text-blue-600 mt-1">{formatCurrency(order.total)}</p>
              </div>
              <Button size="sm" icon={<ShoppingCart size={14} />} onClick={() => restoreOrder(order)}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
