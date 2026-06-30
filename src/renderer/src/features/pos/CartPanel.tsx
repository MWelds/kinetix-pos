import React, { useState, useRef } from 'react'
import {
  ShoppingCart, Trash2, Plus, Minus, User, Tag, Pause, Package, Truck, History, Clock, Edit3
} from 'lucide-react'
import { useCartStore } from '../../stores/cart.store'
import { useCurrencyStore } from '../../stores/currency.store'
import { useUiStore } from '../../stores/ui.store'
import { Button, Badge, Modal, Input } from '../../components/ui'
import { CustomerSearch } from './CustomerSearch'
import type { CartItem } from '../../types'

interface CartPanelProps {
  onCheckout: () => void
  onHold: () => void
  onShowHeld: () => void
  /** Pay Later: create a pending delivery order + print invoice. Only for delivery orders. */
  onPayLater?: () => void
}

export function CartPanel({ onCheckout, onHold, onShowHeld, onPayLater }: CartPanelProps) {
  const {
    items, customer, notes, discountType, discountValue,
    subtotal, discountAmount, taxAmount, total, itemCount, orderType, taxEnabled,
    editingOrderId, editingOrderNumber,
    removeItem, updateQuantity, setItemNotes, setItemDiscount, setItemPrice,
    setCustomer, setNotes, setDiscount, setOrderType, clearCart
  } = useCartStore()

  const { fmtRaw, currency, altCurrency, kydToUsdRate } = useCurrencyStore()
  const showToast = useUiStore((s) => s.showToast)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [discountInput, setDiscountInput] = useState({ type: 'percentage' as 'percentage' | 'fixed', value: '' })

  const sub = subtotal()
  const disc = discountAmount()
  const tax = taxAmount()
  const tot = total()
  const count = itemCount()
  const showAlt = currency !== 'USD'
  const altCode = altCurrency()

  function handleApplyDiscount() {
    const val = parseFloat(discountInput.value)
    if (isNaN(val) || val <= 0) return
    setDiscount(discountInput.type, val)
    setShowDiscountModal(false)
    showToast('Discount applied', 'success')
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      {/* Editing-order banner */}
      {editingOrderId && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm font-medium">
          <Edit3 size={14} />
          <span>Editing {editingOrderNumber ?? 'order'} — same invoice number will be kept</span>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <ShoppingCart size={18} className="text-blue-600" />
          <span className="font-semibold text-gray-900">Cart</span>
          {count > 0 && <Badge color="blue">{count}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {/* Retrieve held orders */}
          <button
            onClick={onShowHeld}
            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 px-2 py-1 rounded-lg hover:bg-amber-50 font-medium"
            title="Retrieve held orders"
          >
            <History size={13} /> Held
          </button>
          {items.length > 0 && (
            <button
              onClick={clearCart}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
              aria-label="Clear cart"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Delivery / In-Store toggle */}
      <div className="flex border-b border-gray-100">
        <button
          type="button"
          onClick={() => setOrderType('instore')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors ${
            orderType === 'instore'
              ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
              : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Package size={12} /> In-Store
        </button>
        <button
          type="button"
          onClick={() => setOrderType('delivery')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors ${
            orderType === 'delivery'
              ? 'bg-orange-50 text-orange-700 border-b-2 border-orange-500'
              : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Truck size={12} /> Delivery
        </button>
      </div>

      {/* Customer row */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50"
        onClick={() => setShowCustomerModal(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setShowCustomerModal(true)}
      >
        <User size={14} className="text-gray-400 shrink-0" />
        {customer ? (
          <div className="flex-1 flex justify-between items-center">
            <span className="text-sm font-medium text-gray-800">
              {customer.firstName} {customer.lastName}
            </span>
            <div className="flex items-center gap-2">
              <Badge color="purple">{customer.loyaltyPoints} pts</Badge>
              <button
                onClick={(e) => { e.stopPropagation(); setCustomer(null) }}
                className="text-gray-400 hover:text-gray-600"
              >
                x
              </button>
            </div>
          </div>
        ) : (
          <span className="text-sm text-gray-400">Add customer (optional)</span>
        )}
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-300">
            <ShoppingCart size={40} />
            <p className="text-sm">Cart is empty</p>
            <p className="text-xs">Tap a product or scan a barcode</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <CartItemRow
                key={item.id}
                item={item}
                fmt={fmtRaw}
                onQuantity={(q) => updateQuantity(item.id, q)}
                onRemove={() => removeItem(item.id)}
                onNotes={(n) => setItemNotes(item.id, n)}
                onDiscount={(a) => setItemDiscount(item.id, a)}
                onPriceChange={(p) => setItemPrice(item.id, p)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Order actions */}
      {items.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2 flex gap-2">
          <button
            onClick={() => setShowDiscountModal(true)}
            className="flex-1 flex items-center justify-center gap-1 text-xs text-blue-600 hover:text-blue-800 py-2 rounded-lg hover:bg-blue-50"
          >
            <Tag size={12} /> Discount
            {discountType && (
              <Badge color="blue" className="ml-1">
                {discountType === 'percentage' ? `${discountValue}%` : fmtRaw(discountValue)}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setShowNotesModal(true)}
            className="flex-1 flex items-center justify-center gap-1 text-xs text-gray-600 hover:text-gray-800 py-2 rounded-lg hover:bg-gray-50"
          >
            Order Notes {notes && 'checkmark'}
          </button>
        </div>
      )}

      {/* Totals */}
      <div className="border-t border-gray-200 px-4 py-3 space-y-1.5">
        {/* Only show subtotal row when tax is enabled (otherwise it duplicates the total) */}
        {taxEnabled && (
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal</span>
            <span>{fmtRaw(sub)}</span>
          </div>
        )}
        {disc > 0 && (
          <div className="flex justify-between text-sm text-emerald-600">
            <span>Discount</span>
            <span>-{fmtRaw(disc)}</span>
          </div>
        )}
        {tax > 0 && (
          <div className="flex justify-between text-sm text-gray-600">
            <span>Tax</span>
            <span>{fmtRaw(tax)}</span>
          </div>
        )}
        {/* Total in active currency */}
        <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
          <span>Total</span>
          <span className="text-blue-600">{fmtRaw(tot)}</span>
        </div>
        {/* Alt currency equivalent — tot is in store currency (KYD), convert to USD for display */}
        {showAlt && tot > 0 && (
          <div className="flex justify-between text-xs text-gray-400">
            <span>approx {altCode}</span>
            <span>{'$'}{(tot * kydToUsdRate).toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Item count bar */}
      {count > 0 && (
        <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-100 text-center text-xs text-gray-500">
          {count} item{count !== 1 ? 's' : ''} in cart
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 pb-4 pt-2 space-y-2">
        {/* Pay Later — delivery only */}
        {orderType === 'delivery' && onPayLater && (
          <Button
            variant="secondary"
            size="md"
            onClick={onPayLater}
            disabled={items.length === 0}
            icon={<Clock size={14} />}
            className="w-full text-orange-700 border-orange-300 hover:bg-orange-50"
          >
            Pay Later — Print Invoice
          </Button>
        )}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={onHold}
            disabled={items.length === 0}
            icon={<Pause size={14} />}
            className="flex-1"
          >
            Hold
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={onCheckout}
            disabled={items.length === 0}
            className="flex-[2] text-base font-bold"
          >
            Charge {items.length > 0 && fmtRaw(tot)}
          </Button>
        </div>
      </div>

      {/* Customer modal */}
      <Modal isOpen={showCustomerModal} onClose={() => setShowCustomerModal(false)} title="Select Customer">
        <CustomerSearch
          onSelect={(c) => { setCustomer(c); setShowCustomerModal(false) }}
          selectedId={customer?.id}
        />
      </Modal>

      {/* Discount modal */}
      <Modal
        isOpen={showDiscountModal}
        onClose={() => setShowDiscountModal(false)}
        title="Apply Order Discount"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDiscountModal(false)}>Cancel</Button>
            {discountType && (
              <Button variant="ghost" onClick={() => { setDiscount(null, 0); setShowDiscountModal(false) }}>
                Remove
              </Button>
            )}
            <Button onClick={handleApplyDiscount}>Apply</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex rounded-lg overflow-hidden border border-gray-300">
            <button
              className={`flex-1 py-2 text-sm font-medium transition-colors ${discountInput.type === 'percentage' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              onClick={() => setDiscountInput((d) => ({ ...d, type: 'percentage' }))}
            >
              Percentage %
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium transition-colors ${discountInput.type === 'fixed' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              onClick={() => setDiscountInput((d) => ({ ...d, type: 'fixed' }))}
            >
              Fixed Amount
            </button>
          </div>
          <Input
            label={discountInput.type === 'percentage' ? 'Discount (%)' : `Discount Amount (${currency})`}
            type="number"
            min="0"
            max={discountInput.type === 'percentage' ? 100 : undefined}
            value={discountInput.value}
            onChange={(e) => setDiscountInput((d) => ({ ...d, value: e.target.value }))}
            autoFocus
          />
        </div>
      </Modal>

      {/* Notes modal */}
      <Modal
        isOpen={showNotesModal}
        onClose={() => setShowNotesModal(false)}
        title="Order Notes"
        footer={<Button onClick={() => setShowNotesModal(false)}>Done</Button>}
      >
        <textarea
          className="w-full border border-gray-300 rounded-lg p-3 text-sm min-h-[120px] focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Add notes to this order..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Modal>
    </div>
  )
}

// ─── Cart Item Row ─────────────────────────────────────────────────────────────

interface CartItemRowProps {
  item: CartItem
  fmt: (n: number) => string
  onQuantity: (q: number) => void
  onRemove: () => void
  onNotes: (n: string) => void
  onDiscount: (a: number) => void
  onPriceChange: (price: number | null) => void
}

function CartItemRow({ item, fmt, onQuantity, onRemove, onPriceChange }: CartItemRowProps) {
  const effectivePrice = item.customPrice ?? item.unitPrice
  const lineTotal = (effectivePrice - item.discountAmount) * item.quantity
  const priceOverridden = item.customPrice !== undefined && item.customPrice !== item.unitPrice

  const [editingPrice, setEditingPrice] = useState(false)
  const [priceInput, setPriceInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startPriceEdit() {
    setPriceInput(effectivePrice.toFixed(2))
    setEditingPrice(true)
    // Focus after render
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitPriceEdit() {
    const val = parseFloat(priceInput)
    if (!isNaN(val) && val >= 0) {
      // If it matches the original price, clear the override
      onPriceChange(Math.abs(val - item.unitPrice) < 0.001 ? null : val)
    }
    setEditingPrice(false)
  }

  function handlePriceKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitPriceEdit()
    if (e.key === 'Escape') setEditingPrice(false)
  }

  return (
    <div className="px-4 py-3 hover:bg-gray-50">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{item.productName}</p>
          {item.variantName && (
            <p className="text-xs text-gray-500">{item.variantName}</p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            {fmt(effectivePrice)} each
            {priceOverridden && (
              <span className="ml-1 line-through text-gray-300">{fmt(item.unitPrice)}</span>
            )}
          </p>
        </div>
        {/* Line total — tap to edit unit price */}
        <div className="flex flex-col items-end gap-1">
          {editingPrice ? (
            <input
              ref={inputRef}
              type="number"
              min="0"
              step="0.01"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onBlur={commitPriceEdit}
              onKeyDown={handlePriceKeyDown}
              autoFocus
              className="w-24 text-sm font-bold text-right border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
            />
          ) : (
            <button
              onClick={startPriceEdit}
              title="Tap to edit price"
              className={`text-sm font-bold rounded px-1 transition-colors ${
                priceOverridden
                  ? 'text-amber-600 bg-amber-50 border border-amber-200'
                  : 'text-gray-900 hover:text-blue-600 hover:bg-blue-50'
              }`}
            >
              {fmt(lineTotal)}
            </button>
          )}
          <button
            onClick={onRemove}
            className="text-red-400 hover:text-red-600"
            aria-label="Remove item"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {/* Quantity controls */}
      <div className="flex items-center gap-3 mt-2">
        <div className="flex items-center border border-gray-200 rounded-lg">
          <button
            onClick={() => onQuantity(item.quantity - 1)}
            className="p-1.5 hover:bg-gray-100 rounded-l-lg text-gray-500"
            aria-label="Decrease quantity"
          >
            <Minus size={12} />
          </button>
          <span className="px-3 text-sm font-medium text-gray-900 min-w-[32px] text-center">
            {item.quantity}
          </span>
          <button
            onClick={() => onQuantity(item.quantity + 1)}
            className="p-1.5 hover:bg-gray-100 rounded-r-lg text-gray-500"
            aria-label="Increase quantity"
          >
            <Plus size={12} />
          </button>
        </div>
        {item.discountAmount > 0 && (
          <Badge color="green">-{fmt(item.discountAmount)}</Badge>
        )}
      </div>
    </div>
  )
}
