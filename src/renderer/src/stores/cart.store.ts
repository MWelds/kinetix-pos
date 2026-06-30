import { create } from 'zustand'
import { nanoid } from '../lib/nanoid'
import type { CartItem, Customer } from '../types'
import { round2 } from '../lib/currency'

interface CartState {
  items: CartItem[]
  customer: Customer | null
  notes: string
  discountType: 'percentage' | 'fixed' | null
  discountValue: number
  loyaltyPointsToRedeem: number
  taxRate: number
  /** Whether tax is applied to this order. Can be toggled per-sale or set globally. */
  taxEnabled: boolean
  /** Whether this order is for in-store pickup or delivery */
  orderType: 'instore' | 'delivery'
  /**
   * When non-null, the POS is editing an existing order rather than creating a new one.
   * PaymentModal will call orders.updateAndComplete() to preserve the order number.
   */
  editingOrderId: string | null
  /** Display-friendly order number shown in the editing banner (e.g. "POS-000042"). */
  editingOrderNumber: string | null

  // Computed
  subtotal: () => number
  discountAmount: () => number
  taxAmount: () => number
  total: () => number
  itemCount: () => number

  // Actions
  addItem: (item: Omit<CartItem, 'id' | 'discountAmount'>) => void
  updateQuantity: (id: string, quantity: number) => void
  removeItem: (id: string) => void
  setItemDiscount: (id: string, amount: number) => void
  setItemPrice: (id: string, price: number | null) => void
  setItemNotes: (id: string, notes: string) => void
  setCustomer: (customer: Customer | null) => void
  setNotes: (notes: string) => void
  setDiscount: (type: 'percentage' | 'fixed' | null, value: number) => void
  setLoyaltyPoints: (points: number) => void
  setTaxRate: (rate: number) => void
  setTaxEnabled: (enabled: boolean) => void
  setOrderType: (type: 'instore' | 'delivery') => void
  setEditingOrder: (id: string | null, orderNumber?: string | null) => void
  clearCart: () => void
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customer: null,
  notes: '',
  discountType: null,
  discountValue: 0,
  loyaltyPointsToRedeem: 0,
  taxRate: 0.08,
  taxEnabled: true,
  orderType: 'instore',
  editingOrderId: null,
  editingOrderNumber: null,

  subtotal: () => {
    const { items } = get()
    return round2(
      items.reduce((sum, item) => {
        const effectivePrice = item.customPrice ?? item.unitPrice
        return sum + (effectivePrice - item.discountAmount) * item.quantity
      }, 0)
    )
  },

  discountAmount: () => {
    const { discountType, discountValue, subtotal } = get()
    if (!discountType || discountValue <= 0) return 0
    const sub = subtotal()
    if (discountType === 'percentage') return round2(sub * (discountValue / 100))
    return round2(Math.min(discountValue, sub))
  },

  taxAmount: () => {
    const { taxEnabled, taxRate, subtotal, discountAmount } = get()
    if (!taxEnabled) return 0
    return round2((subtotal() - discountAmount()) * taxRate)
  },

  total: () => {
    const { subtotal, discountAmount, taxAmount, loyaltyPointsToRedeem } = get()
    // 1 loyalty point = $0.01 — must match order.service.ts loyaltyDeduction calculation
    const loyaltyDeduction = loyaltyPointsToRedeem * 0.01
    return round2(
      Math.max(0, subtotal() - discountAmount() + taxAmount() - loyaltyDeduction)
    )
  },

  itemCount: () => get().items.reduce((sum, item) => sum + item.quantity, 0),

  addItem: (itemData) => {
    const { items } = get()
    const existing = items.find(
      (i) => i.productId === itemData.productId && i.variantId === itemData.variantId
    )
    if (existing) {
      set({
        items: items.map((i) =>
          i.id === existing.id ? { ...i, quantity: i.quantity + itemData.quantity } : i
        )
      })
    } else {
      set({ items: [...items, { ...itemData, id: nanoid(), discountAmount: 0 }] })
    }
  },

  updateQuantity: (id, quantity) => {
    if (quantity <= 0) {
      set({ items: get().items.filter((i) => i.id !== id) })
    } else {
      set({ items: get().items.map((i) => (i.id === id ? { ...i, quantity } : i)) })
    }
  },

  removeItem: (id) => set({ items: get().items.filter((i) => i.id !== id) }),

  setItemDiscount: (id, amount) =>
    set({ items: get().items.map((i) => (i.id === id ? { ...i, discountAmount: amount } : i)) }),

  setItemPrice: (id, price) =>
    set({
      items: get().items.map((i) =>
        i.id === id ? { ...i, customPrice: price === null ? undefined : price } : i
      )
    }),

  setItemNotes: (id, notes) =>
    set({ items: get().items.map((i) => (i.id === id ? { ...i, notes } : i)) }),

  setCustomer: (customer) => set({ customer }),

  setNotes: (notes) => set({ notes }),

  setDiscount: (type, value) => set({ discountType: type, discountValue: value }),

  setLoyaltyPoints: (points) => set({ loyaltyPointsToRedeem: points }),

  setTaxRate: (rate) => set({ taxRate: rate }),

  setTaxEnabled: (enabled) => set({ taxEnabled: enabled }),

  setOrderType: (type) => set({ orderType: type }),

  setEditingOrder: (id, orderNumber = null) =>
    set({ editingOrderId: id, editingOrderNumber: orderNumber }),

  clearCart: () =>
    set({
      items: [],
      customer: null,
      notes: '',
      discountType: null,
      discountValue: 0,
      loyaltyPointsToRedeem: 0,
      orderType: 'instore',
      editingOrderId: null,
      editingOrderNumber: null,
    })
}))
