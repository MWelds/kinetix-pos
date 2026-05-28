import { eq, desc, and, gte, lte } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'
import { settingsService } from './settings.service'

export interface CartItemInput {
  productId: string
  variantId?: string
  productName: string
  variantName?: string
  sku: string
  quantity: number
  unitPrice: number
  discountAmount?: number
  notes?: string
}

export interface CreateOrderInput {
  customerId?: string
  staffId?: string
  shiftId?: string
  items: CartItemInput[]
  notes?: string
  manualDiscountType?: 'percentage' | 'fixed'
  manualDiscountValue?: number
  discountId?: string
  loyaltyPointsRedeemed?: number
  taxRate?: number
  /** Whether this is an in-store or delivery order */
  orderType?: 'instore' | 'delivery'
}

export interface CompleteOrderInput {
  orderId: string
  payments: Array<{
    method: 'cash' | 'card' | 'store_credit' | 'gift_card' | 'layaway'
    amount: number
    reference?: string
    changeGiven?: number
    giftCardCode?: string
  }>
}

/** Input for in-place editing of a pending/held order — replaces items + completes with payment. */
export interface UpdateAndCompleteInput {
  /** The existing order ID to update (keeps same order number). */
  orderId: string
  /** New item list (replaces old items). */
  items: CartItemInput[]
  customerId?: string
  staffId?: string
  shiftId?: string
  notes?: string
  orderType?: 'instore' | 'delivery'
  manualDiscountType?: 'percentage' | 'fixed'
  manualDiscountValue?: number
  loyaltyPointsRedeemed?: number
  taxRate?: number
  payments: Array<{
    method: 'cash' | 'card' | 'store_credit' | 'gift_card' | 'layaway'
    amount: number
    reference?: string
    changeGiven?: number
    giftCardCode?: string
  }>
}

export interface OrderWithItems {
  order: typeof schema.orders.$inferSelect
  items: (typeof schema.orderItems.$inferSelect)[]
  payments: (typeof schema.payments.$inferSelect)[]
}

/** Generates next order number like POS-000001 */
function generateOrderNumber(db: ReturnType<typeof getDatabase>): string {
  const last = db
    .select({ orderNumber: schema.orders.orderNumber })
    .from(schema.orders)
    .orderBy(desc(schema.orders.createdAt))
    .limit(1)
    .get()
  if (!last) return 'POS-000001'
  const num = parseInt(last.orderNumber.split('-')[1] || '0', 10)
  return `POS-${String(num + 1).padStart(6, '0')}`
}

/**
 * Deduct inventory for a single product.
 *
 * Three cases are handled:
 * 1. Pack product (unitsPerPack > 1): deducts soldQty x unitsPerPack from
 *    the linked individual product's inventory (the single source of truth).
 * 2. Composite/bundle product: deducts each component's inventory normally.
 * 3. Standard product: deducts soldQty from its own inventory record.
 */
function deductInventory(
  db: ReturnType<typeof getDatabase>,
  productId: string,
  soldQty: number,
  now: string
): void {
  const product = db
    .select({
      isComposite: schema.products.isComposite,
      unitsPerPack: schema.products.unitsPerPack,
      individualProductId: schema.products.individualProductId,
      trackStock: schema.products.trackStock,
    })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .get()

  // Skip stock deduction for service/non-physical products
  if (product?.trackStock === false) return

  // Case 1: Pack product - redirect deduction to the individual product
  if ((product?.unitsPerPack ?? 1) > 1 && product?.individualProductId) {
    const deductUnits = soldQty * (product.unitsPerPack ?? 1)
    const indInv = db
      .select()
      .from(schema.inventory)
      .where(eq(schema.inventory.productId, product.individualProductId))
      .get()
    if (indInv) {
      db.update(schema.inventory)
        .set({ quantity: Math.max(0, indInv.quantity - deductUnits), updatedAt: now })
        .where(eq(schema.inventory.id, indInv.id))
        .run()
    }
    return
  }

  // Case 2 & 3: Standard or composite product - deduct own inventory
  const inv = db
    .select()
    .from(schema.inventory)
    .where(eq(schema.inventory.productId, productId))
    .get()
  if (inv) {
    db.update(schema.inventory)
      .set({ quantity: Math.max(0, inv.quantity - soldQty), updatedAt: now })
      .where(eq(schema.inventory.id, inv.id))
      .run()
  }

  // Case 2 extra: also deduct composite components
  if (product?.isComposite) {
    const components = db
      .select()
      .from(schema.productComponents)
      .where(eq(schema.productComponents.compositeProductId, productId))
      .all()

    for (const component of components) {
      const compInv = db
        .select()
        .from(schema.inventory)
        .where(eq(schema.inventory.productId, component.componentProductId))
        .get()
      if (compInv) {
        const deduct = component.quantity * soldQty
        db.update(schema.inventory)
          .set({ quantity: Math.max(0, compInv.quantity - deduct), updatedAt: now })
          .where(eq(schema.inventory.id, compInv.id))
          .run()
      }
    }
  }
}

/**
 * Restore inventory for a single product (refund/void).
 *
 * Mirrors deductInventory - pack products restore to the individual product's
 * inventory pool, composite products restore each component.
 */
function restoreInventory(
  db: ReturnType<typeof getDatabase>,
  productId: string,
  qty: number,
  now: string
): void {
  const product = db
    .select({
      isComposite: schema.products.isComposite,
      unitsPerPack: schema.products.unitsPerPack,
      individualProductId: schema.products.individualProductId,
      trackStock: schema.products.trackStock,
    })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .get()

  // Skip stock restoration for service/non-physical products
  if (product?.trackStock === false) return

  // Pack product - restore to individual product's inventory
  if ((product?.unitsPerPack ?? 1) > 1 && product?.individualProductId) {
    const restoreUnits = qty * (product.unitsPerPack ?? 1)
    const indInv = db
      .select()
      .from(schema.inventory)
      .where(eq(schema.inventory.productId, product.individualProductId))
      .get()
    if (indInv) {
      db.update(schema.inventory)
        .set({ quantity: indInv.quantity + restoreUnits, updatedAt: now })
        .where(eq(schema.inventory.id, indInv.id))
        .run()
    }
    return
  }

  // Standard / composite product
  const inv = db
    .select()
    .from(schema.inventory)
    .where(eq(schema.inventory.productId, productId))
    .get()
  if (inv) {
    db.update(schema.inventory)
      .set({ quantity: inv.quantity + qty, updatedAt: now })
      .where(eq(schema.inventory.id, inv.id))
      .run()
  }

  if (product?.isComposite) {
    const components = db
      .select()
      .from(schema.productComponents)
      .where(eq(schema.productComponents.compositeProductId, productId))
      .all()

    for (const component of components) {
      const compInv = db
        .select()
        .from(schema.inventory)
        .where(eq(schema.inventory.productId, component.componentProductId))
        .get()
      if (compInv) {
        db.update(schema.inventory)
          .set({ quantity: compInv.quantity + component.quantity * qty, updatedAt: now })
          .where(eq(schema.inventory.id, compInv.id))
          .run()
      }
    }
  }
}

export const orderService = {
  /** Create a new order (pending / held) */
  create(input: CreateOrderInput): OrderWithItems {
    const db = getDatabase()
    const orderId = generateId()
    const now = new Date().toISOString()
    const orderNumber = generateOrderNumber(db)

    let subtotal = 0
    for (const item of input.items) {
      subtotal += (item.unitPrice - (item.discountAmount ?? 0)) * item.quantity
    }

    let discountAmount = 0
    if (input.manualDiscountType === 'percentage' && input.manualDiscountValue) {
      discountAmount = subtotal * (input.manualDiscountValue / 100)
    } else if (input.manualDiscountType === 'fixed' && input.manualDiscountValue) {
      discountAmount = Math.min(input.manualDiscountValue, subtotal)
    }

    const afterDiscount = subtotal - discountAmount
    const taxAmount = afterDiscount * (input.taxRate ?? 0)
    const loyaltyDeduction = (input.loyaltyPointsRedeemed ?? 0) * 0.01
    const total = afterDiscount + taxAmount - loyaltyDeduction

    db.insert(schema.orders)
      .values({
        id: orderId,
        orderNumber,
        status: 'pending',
        orderType: input.orderType ?? 'instore',
        customerId: input.customerId,
        staffId: input.staffId,
        shiftId: input.shiftId,
        subtotal,
        discountAmount,
        taxAmount,
        total: Math.max(0, total),
        notes: input.notes,
        manualDiscountType: input.manualDiscountType,
        manualDiscountValue: input.manualDiscountValue,
        discountId: input.discountId,
        loyaltyPointsEarned: Math.floor(total),
        loyaltyPointsRedeemed: input.loyaltyPointsRedeemed ?? 0,
        syncStatus: 'pending',
        terminalId: settingsService.get('terminalId') ?? 'unknown',
        createdAt: now,
        updatedAt: now
      })
      .run()

    for (const item of input.items) {
      const lineTotal = (item.unitPrice - (item.discountAmount ?? 0)) * item.quantity
      db.insert(schema.orderItems)
        .values({
          id: generateId(),
          orderId,
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount ?? 0,
          taxAmount: 0,
          lineTotal,
          notes: item.notes,
          createdAt: now,
          updatedAt: now
        })
        .run()
    }

    return this.getWithItems(orderId)!
  },

  /** Complete an order with payment */
  complete(input: CompleteOrderInput): OrderWithItems {
    const db = getDatabase()
    const now = new Date().toISOString()

    const order = db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, input.orderId))
      .get()
    if (!order) throw new Error(`Order ${input.orderId} not found`)

    // Record payments
    for (const payment of input.payments) {
      if (payment.method === 'gift_card' && payment.giftCardCode) {
        const gc = db
          .select()
          .from(schema.giftCards)
          .where(eq(schema.giftCards.code, payment.giftCardCode))
          .get()
        if (gc) {
          db.update(schema.giftCards)
            .set({ balance: Math.max(0, gc.balance - payment.amount) })
            .where(eq(schema.giftCards.id, gc.id))
            .run()
        }
      }

      if (payment.method === 'store_credit' && order.customerId) {
        const customer = db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
          .get()
        if (customer) {
          db.update(schema.customers)
            .set({ storeCredit: Math.max(0, customer.storeCredit - payment.amount) })
            .where(eq(schema.customers.id, order.customerId))
            .run()
        }
      }

      db.insert(schema.payments)
        .values({
          id: generateId(),
          orderId: input.orderId,
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference,
          changeGiven: payment.changeGiven,
          status: 'completed',
          createdAt: now
        })
        .run()
    }

    // Award loyalty points
    if (order.customerId && order.loyaltyPointsEarned > 0) {
      const customer = db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, order.customerId))
        .get()
      if (customer) {
        db.update(schema.customers)
          .set({
            loyaltyPoints:
              customer.loyaltyPoints + order.loyaltyPointsEarned - order.loyaltyPointsRedeemed,
            updatedAt: now
          })
          .where(eq(schema.customers.id, order.customerId))
          .run()
      }
    }

    // Deduct inventory (handles pack and bundle components automatically)
    const items = db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, input.orderId))
      .all()

    for (const item of items) {
      deductInventory(db, item.productId, item.quantity, now)
    }

    db.update(schema.orders)
      .set({ status: 'completed', updatedAt: now })
      .where(eq(schema.orders.id, input.orderId))
      .run()

    return this.getWithItems(input.orderId)!
  },

  /** Hold an order for later */
  hold(orderId: string): void {
    const db = getDatabase()
    db.update(schema.orders)
      .set({ status: 'held', updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, orderId))
      .run()
  },

  /** Void an order */
  voidOrder(orderId: string, _staffId: string): void {
    const db = getDatabase()
    db.update(schema.orders)
      .set({ status: 'voided', updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, orderId))
      .run()
  },

  /** Process a refund - restores inventory including pack and bundle components */
  refund(orderId: string, _itemIds: string[]): OrderWithItems {
    const db = getDatabase()
    const now = new Date().toISOString()

    const original = this.getWithItems(orderId)
    if (!original) throw new Error('Original order not found')

    const refundId = generateId()
    const orderNumber = `REF-${original.order.orderNumber}`

    db.insert(schema.orders)
      .values({
        id: refundId,
        orderNumber,
        status: 'refunded',
        customerId: original.order.customerId,
        staffId: original.order.staffId,
        shiftId: original.order.shiftId,
        subtotal: -original.order.subtotal,
        discountAmount: -original.order.discountAmount,
        taxAmount: -original.order.taxAmount,
        total: -original.order.total,
        notes: `Refund for ${original.order.orderNumber}`,
        loyaltyPointsEarned: 0,
        loyaltyPointsRedeemed: 0,
        syncStatus: 'pending',
        createdAt: now,
        updatedAt: now
      })
      .run()

    db.update(schema.orders)
      .set({ status: 'refunded', updatedAt: now })
      .where(eq(schema.orders.id, orderId))
      .run()

    // Restore inventory (handles pack and bundle components automatically)
    for (const item of original.items) {
      restoreInventory(db, item.productId, item.quantity, now)
    }

    return this.getWithItems(refundId)!
  },

  /** Get a single order with its items and payments */
  getWithItems(orderId: string): OrderWithItems | null {
    const db = getDatabase()
    const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()
    if (!order) return null
    const items = db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).all()
    const pays = db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId)).all()
    return { order, items, payments: pays }
  },

  /** List orders with optional date/status filters */
  list(filters?: {
    status?: string
    fromDate?: string
    toDate?: string
    customerId?: string
    limit?: number
    offset?: number
  }) {
    const db = getDatabase()
    let query = db.select().from(schema.orders).$dynamic()
    const conditions = []
    if (filters?.status) conditions.push(eq(schema.orders.status, filters.status))
    if (filters?.fromDate) conditions.push(gte(schema.orders.createdAt, filters.fromDate))
    if (filters?.toDate) conditions.push(lte(schema.orders.createdAt, filters.toDate))
    if (filters?.customerId) conditions.push(eq(schema.orders.customerId, filters.customerId))
    if (conditions.length > 0) query = query.where(and(...conditions))
    return query
      .orderBy(desc(schema.orders.createdAt))
      .limit(filters?.limit ?? 50)
      .offset(filters?.offset ?? 0)
      .all()
  },

  /** List held orders */
  listHeld() {
    const db = getDatabase()
    return db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.status, 'held'))
      .orderBy(desc(schema.orders.updatedAt))
      .all()
  },

  /**
   * Update an order's status.
   * Allowed transitions: pending -> delivered | canceled | completed | held | voided
   */
  updateStatus(orderId: string, status: string): void {
    const allowed = new Set(['pending', 'held', 'completed', 'refunded', 'voided', 'delivered', 'canceled'])
    if (!allowed.has(status)) throw new Error(`Invalid status: ${status}`)
    const db = getDatabase()
    db.update(schema.orders)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, orderId))
      .run()
  },

  /**
   * Edit an existing pending/held order in-place and immediately complete it.
   * Preserves the original order number and ID — no new order is created.
   *
   * The old order items and payments are replaced wholesale. Inventory is
   * deducted only for the new items (pending orders never had inventory deducted).
   */
  updateAndComplete(input: UpdateAndCompleteInput): OrderWithItems {
    const db = getDatabase()
    const now = new Date().toISOString()

    const existing = db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, input.orderId))
      .get()
    if (!existing) throw new Error(`Order ${input.orderId} not found`)

    // ── Recalculate totals from new item list ────────────────────────────────
    let subtotal = 0
    for (const item of input.items) {
      subtotal += (item.unitPrice - (item.discountAmount ?? 0)) * item.quantity
    }

    let discountAmount = 0
    if (input.manualDiscountType === 'percentage' && input.manualDiscountValue) {
      discountAmount = subtotal * (input.manualDiscountValue / 100)
    } else if (input.manualDiscountType === 'fixed' && input.manualDiscountValue) {
      discountAmount = Math.min(input.manualDiscountValue, subtotal)
    }

    const afterDiscount = subtotal - discountAmount
    const taxAmount = afterDiscount * (input.taxRate ?? 0)
    const loyaltyDeduction = (input.loyaltyPointsRedeemed ?? 0) * 0.01
    const total = Math.max(0, afterDiscount + taxAmount - loyaltyDeduction)

    // ── Replace order items ──────────────────────────────────────────────────
    db.delete(schema.orderItems)
      .where(eq(schema.orderItems.orderId, input.orderId))
      .run()

    for (const item of input.items) {
      const lineTotal = (item.unitPrice - (item.discountAmount ?? 0)) * item.quantity
      db.insert(schema.orderItems)
        .values({
          id: generateId(),
          orderId: input.orderId,
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount ?? 0,
          taxAmount: 0,
          lineTotal,
          notes: item.notes,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    // ── Update the order record (keep orderNumber, id, createdAt) ────────────
    db.update(schema.orders)
      .set({
        customerId: input.customerId ?? existing.customerId,
        staffId: input.staffId ?? existing.staffId,
        shiftId: input.shiftId ?? existing.shiftId,
        orderType: input.orderType ?? existing.orderType,
        notes: input.notes ?? existing.notes,
        subtotal,
        discountAmount,
        taxAmount,
        total,
        manualDiscountType: input.manualDiscountType ?? null,
        manualDiscountValue: input.manualDiscountValue ?? null,
        loyaltyPointsEarned: Math.floor(total),
        loyaltyPointsRedeemed: input.loyaltyPointsRedeemed ?? 0,
        status: 'completed',
        syncStatus: 'pending',
        updatedAt: now,
      })
      .where(eq(schema.orders.id, input.orderId))
      .run()

    // ── Replace payments ─────────────────────────────────────────────────────
    db.delete(schema.payments)
      .where(eq(schema.payments.orderId, input.orderId))
      .run()

    for (const payment of input.payments) {
      if (payment.method === 'gift_card' && payment.giftCardCode) {
        const gc = db
          .select()
          .from(schema.giftCards)
          .where(eq(schema.giftCards.code, payment.giftCardCode))
          .get()
        if (gc) {
          db.update(schema.giftCards)
            .set({ balance: Math.max(0, gc.balance - payment.amount) })
            .where(eq(schema.giftCards.id, gc.id))
            .run()
        }
      }

      if (payment.method === 'store_credit' && (input.customerId ?? existing.customerId)) {
        const custId = input.customerId ?? existing.customerId
        if (custId) {
          const customer = db
            .select()
            .from(schema.customers)
            .where(eq(schema.customers.id, custId))
            .get()
          if (customer) {
            db.update(schema.customers)
              .set({ storeCredit: Math.max(0, customer.storeCredit - payment.amount) })
              .where(eq(schema.customers.id, custId))
              .run()
          }
        }
      }

      db.insert(schema.payments)
        .values({
          id: generateId(),
          orderId: input.orderId,
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference,
          changeGiven: payment.changeGiven,
          status: 'completed',
          createdAt: now,
        })
        .run()
    }

    // ── Award loyalty points ─────────────────────────────────────────────────
    const custId = input.customerId ?? existing.customerId
    if (custId && Math.floor(total) > 0) {
      const customer = db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, custId))
        .get()
      if (customer) {
        db.update(schema.customers)
          .set({
            loyaltyPoints:
              customer.loyaltyPoints + Math.floor(total) - (input.loyaltyPointsRedeemed ?? 0),
            updatedAt: now,
          })
          .where(eq(schema.customers.id, custId))
          .run()
      }
    }

    // ── Deduct inventory for new items (pending orders never deducted) ───────
    for (const item of input.items) {
      deductInventory(db, item.productId, item.quantity, now)
    }

    return this.getWithItems(input.orderId)!
  },
}
