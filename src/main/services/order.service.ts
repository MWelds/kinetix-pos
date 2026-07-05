import { eq, desc, and, gte, lte, like, sql, isNull } from 'drizzle-orm'
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
    /** Amount in store (primary) currency — used for accounting. */
    amount: number
    /** Currency the customer paid in (e.g. 'USD', 'KYD'). */
    currency?: string
    /** Amount as tendered in the payment currency (e.g. 10.00 USD). */
    originalAmount?: number
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
    /** Amount in store (primary) currency — used for accounting. */
    amount: number
    /** Currency the customer paid in (e.g. 'USD', 'KYD'). */
    currency?: string
    /** Amount as tendered in the payment currency (e.g. 10.00 USD). */
    originalAmount?: number
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

export interface RefundItemInput {
  /** The original order_items row being (partially) refunded. */
  orderItemId: string
  /** Quantity to refund this pass — must not exceed that line's remaining refundable quantity. */
  quantity: number
}

/** Rounds to the nearest cent — keeps proration across repeated partial refunds from drifting. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Generates next order number like POS-000001 */
function generateOrderNumber(db: ReturnType<typeof getDatabase>): string {
  // Find the highest *valid* numeric POS order. Ordering by createdAt is unsafe
  // because a corrupted entry like 'POS-000NaN' could be newest, causing parseInt
  // to return 0 and generating 'POS-000001' (already taken → UNIQUE crash).
  // Instead, sort by the numeric value of the suffix so corrupted rows (CAST = 0)
  // naturally sort last and are never picked.
  const last = db
    .select({ orderNumber: schema.orders.orderNumber })
    .from(schema.orders)
    .where(
      and(
        like(schema.orders.orderNumber, 'POS-%'),
        sql`CAST(SUBSTR(${schema.orders.orderNumber}, 5) AS INTEGER) > 0`
      )
    )
    .orderBy(sql`CAST(SUBSTR(${schema.orders.orderNumber}, 5) AS INTEGER) DESC`)
    .limit(1)
    .get()
  if (!last) return 'POS-000001'
  const num = parseInt(last.orderNumber.replace('POS-', ''), 10)
  if (isNaN(num) || num <= 0) return 'POS-000001'
  return `POS-${String(num + 1).padStart(6, '0')}`
}

/** Write a single inventory_adjustments record (sale or return). */
function writeAdjustment(
  db: ReturnType<typeof getDatabase>,
  productId: string,
  delta: number,
  type: 'sale' | 'return',
  now: string
): void {
  db.insert(schema.inventoryAdjustments)
    .values({ id: generateId(), productId, type, quantity: delta, createdAt: now })
    .run()
}

/**
 * Deduct inventory for a single product and write a `sale` adjustment record.
 *
 * Three cases are handled:
 * 1. Pack product (unitsPerPack > 1): deducts soldQty x unitsPerPack from
 *    the linked individual product's inventory (the single source of truth).
 * 2. Composite/bundle product: deducts each component's inventory normally.
 * 3. Standard product: deducts soldQty from its own inventory record.
 *
 * Writing the adjustment record is what makes multi-terminal inventory safe —
 * adjustments are additive and never conflict during sync.
 */
function deductInventory(
  db: ReturnType<typeof getDatabase>,
  productId: string,
  soldQty: number,
  now: string,
  variantId?: string | null
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
      writeAdjustment(db, product.individualProductId, -deductUnits, 'sale', now)
    }
    return
  }

  // Case 2 & 3: Standard or composite product - deduct own inventory. Must
  // match variantId too — a product with sizes has a separate inventory row
  // per size, and matching on productId alone would deduct from whichever
  // row happens to come back first (typically the unused base row) instead
  // of the size that was actually sold.
  const inv = db
    .select()
    .from(schema.inventory)
    .where(
      and(
        eq(schema.inventory.productId, productId),
        variantId ? eq(schema.inventory.variantId, variantId) : isNull(schema.inventory.variantId)
      )
    )
    .get()
  if (inv) {
    db.update(schema.inventory)
      .set({ quantity: Math.max(0, inv.quantity - soldQty), updatedAt: now })
      .where(eq(schema.inventory.id, inv.id))
      .run()
    if (!product?.isComposite) {
      writeAdjustment(db, productId, -soldQty, 'sale', now)
    }
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
        writeAdjustment(db, component.componentProductId, -deduct, 'sale', now)
      }
    }
  }
}

/**
 * Restore inventory for a single product (refund/void) and write a `return` adjustment record.
 *
 * Mirrors deductInventory — pack products restore to the individual product's
 * inventory pool, composite products restore each component.
 */
function restoreInventory(
  db: ReturnType<typeof getDatabase>,
  productId: string,
  qty: number,
  now: string,
  variantId?: string | null
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
      writeAdjustment(db, product.individualProductId, restoreUnits, 'return', now)
    }
    return
  }

  // Standard / composite product — must match variantId too, same reasoning
  // as deductInventory above.
  const inv = db
    .select()
    .from(schema.inventory)
    .where(
      and(
        eq(schema.inventory.productId, productId),
        variantId ? eq(schema.inventory.variantId, variantId) : isNull(schema.inventory.variantId)
      )
    )
    .get()
  if (inv) {
    db.update(schema.inventory)
      .set({ quantity: inv.quantity + qty, updatedAt: now })
      .where(eq(schema.inventory.id, inv.id))
      .run()
    if (!product?.isComposite) {
      writeAdjustment(db, productId, qty, 'return', now)
    }
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
        const restore = component.quantity * qty
        db.update(schema.inventory)
          .set({ quantity: compInv.quantity + restore, updatedAt: now })
          .where(eq(schema.inventory.id, compInv.id))
          .run()
        writeAdjustment(db, component.componentProductId, restore, 'return', now)
      }
    }
  }
}

export const orderService = {
  /** Create a new order (pending / held) */
  create(input: CreateOrderInput): OrderWithItems {
    const db = getDatabase()
    return db.transaction((tx) => {
      const orderId = generateId()
      const now = new Date().toISOString()
      const orderNumber = generateOrderNumber(tx)

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

      tx.insert(schema.orders)
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
          loyaltyPointsEarned: Math.floor(Math.max(0, total)),
          loyaltyPointsRedeemed: input.loyaltyPointsRedeemed ?? 0,
          syncStatus: 'pending',
          terminalId: settingsService.get('terminalId') || 'unknown',
          terminalName: settingsService.get('terminalName') || 'POS',
          createdAt: now,
          updatedAt: now
        })
        .run()

      for (const item of input.items) {
        const lineTotal = (item.unitPrice - (item.discountAmount ?? 0)) * item.quantity
        tx.insert(schema.orderItems)
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

      const order = tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()!
      const items = tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).all()
      return { order, items, payments: [] }
    })
  },

  /** Complete an order with payment — all mutations run inside a single DB transaction. */
  complete(input: CompleteOrderInput): OrderWithItems {
    const db = getDatabase()
    return db.transaction((tx) => {
      const now = new Date().toISOString()

      const order = tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, input.orderId))
        .get()
      if (!order) throw new Error(`Order ${input.orderId} not found`)

      // Record payments and handle side-effects (gift card balance, store credit)
      for (const payment of input.payments) {
        if (payment.method === 'gift_card' && payment.giftCardCode) {
          const gc = tx
            .select()
            .from(schema.giftCards)
            .where(eq(schema.giftCards.code, payment.giftCardCode))
            .get()
          if (gc) {
            tx.update(schema.giftCards)
              .set({ balance: Math.max(0, gc.balance - payment.amount) })
              .where(eq(schema.giftCards.id, gc.id))
              .run()
          }
        }

        if (payment.method === 'store_credit' && order.customerId) {
          const customer = tx
            .select()
            .from(schema.customers)
            .where(eq(schema.customers.id, order.customerId))
            .get()
          if (customer) {
            tx.update(schema.customers)
              .set({ storeCredit: Math.max(0, customer.storeCredit - payment.amount), updatedAt: now })
              .where(eq(schema.customers.id, order.customerId))
              .run()
          }
        }

        tx.insert(schema.payments)
          .values({
            id: generateId(),
            orderId: input.orderId,
            method: payment.method,
            amount: payment.amount,
            currency: payment.currency ?? 'KYD',
            originalAmount: payment.originalAmount ?? payment.amount,
            reference: payment.reference,
            changeGiven: payment.changeGiven,
            status: 'completed',
            createdAt: now
          })
          .run()
      }

      // Award loyalty points — also fires when earned = 0 but points were redeemed,
      // so the redeemed balance is correctly deducted even on zero-total orders.
      if (order.customerId && (order.loyaltyPointsEarned > 0 || order.loyaltyPointsRedeemed > 0)) {
        const customer = tx
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
          .get()
        if (customer) {
          tx.update(schema.customers)
            .set({
              loyaltyPoints: Math.max(
                0,
                customer.loyaltyPoints + order.loyaltyPointsEarned - order.loyaltyPointsRedeemed
              ),
              updatedAt: now
            })
            .where(eq(schema.customers.id, order.customerId))
            .run()
        }
      }

      // Deduct inventory (handles pack and bundle components automatically)
      const items = tx
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, input.orderId))
        .all()

      for (const item of items) {
        deductInventory(tx, item.productId, item.quantity, now, item.variantId)
      }

      tx.update(schema.orders)
        .set({ status: 'completed', updatedAt: now })
        .where(eq(schema.orders.id, input.orderId))
        .run()

      const updatedOrder = tx.select().from(schema.orders).where(eq(schema.orders.id, input.orderId)).get()!
      const updatedItems = tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, input.orderId)).all()
      const pays = tx.select().from(schema.payments).where(eq(schema.payments.orderId, input.orderId)).all()
      return { order: updatedOrder, items: updatedItems, payments: pays }
    })
  },

  /** Hold an order for later */
  hold(orderId: string): void {
    const db = getDatabase()
    db.update(schema.orders)
      .set({ status: 'held', updatedAt: new Date().toISOString() })
      .where(eq(schema.orders.id, orderId))
      .run()
  },

  /** Void an order — all mutations run inside a single DB transaction. */
  voidOrder(orderId: string, staffId: string): void {
    const db = getDatabase()
    db.transaction((tx) => {
      const now = new Date().toISOString()

      // Read the order before voiding so we can restore inventory and loyalty if needed
      const existing = tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .get()

      tx.update(schema.orders)
        .set({ status: 'voided', updatedAt: now })
        .where(eq(schema.orders.id, orderId))
        .run()

      // Restore inventory for orders that had already deducted stock (completed / delivered).
      // Pending and held orders never reached the deduction step, so nothing to restore.
      if (existing && ['completed', 'delivered'].includes(existing.status)) {
        const items = tx
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, orderId))
          .all()
        for (const item of items) {
          restoreInventory(tx, item.productId, item.quantity, now, item.variantId)
        }

        // Reverse loyalty points awarded at completion time
        if (existing.customerId && (existing.loyaltyPointsEarned > 0 || existing.loyaltyPointsRedeemed > 0)) {
          const customer = tx
            .select()
            .from(schema.customers)
            .where(eq(schema.customers.id, existing.customerId))
            .get()
          if (customer) {
            tx.update(schema.customers)
              .set({
                loyaltyPoints: Math.max(
                  0,
                  customer.loyaltyPoints - existing.loyaltyPointsEarned + existing.loyaltyPointsRedeemed
                ),
                updatedAt: now
              })
              .where(eq(schema.customers.id, existing.customerId))
              .run()
          }
        }
      }

      // Write audit log so voids are traceable to the responsible staff member
      tx.insert(schema.auditLog)
        .values({
          id: generateId(),
          staffId: staffId || undefined,
          action: 'void_order',
          entityType: 'order',
          entityId: orderId,
          details: JSON.stringify({ voidedAt: now }),
          createdAt: now
        })
        .run()
    })
  },

  /**
   * Process a refund for a specific set of order-item quantities (may be a subset
   * of the order, and may be called again later against the same order for
   * whatever remains unrefunded). Restores inventory, prorates loyalty points,
   * writes an audit log entry, all in one transaction.
   *
   * The original order/order_items rows are never mutated except for bumping
   * each refunded line's `refundedQuantity` — their quantity/price/tax fields
   * stay the immutable as-sold record (needed for accurate historical
   * reporting and QuickBooks sync). A real `REF-` order is created with its
   * own order_items rows for exactly what was refunded this pass. The
   * original's `status` only flips to 'refunded' once every line has been
   * fully refunded — report/QBO queries include 'refunded'-status orders in
   * their sums specifically so this nets out correctly whether the refund is
   * partial, full, or spread across several passes over time.
   */
  refund(orderId: string, refundItems: RefundItemInput[], staffId?: string): OrderWithItems {
    if (refundItems.length === 0) throw new Error('No items selected to refund')
    const db = getDatabase()
    return db.transaction((tx) => {
      const now = new Date().toISOString()

      const order = tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()
      if (!order) throw new Error('Original order not found')
      const originalItems = tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).all()
      const originalPays = tx.select().from(schema.payments).where(eq(schema.payments.orderId, orderId)).all()
      const original: OrderWithItems = { order, items: originalItems, payments: originalPays }

      const refundId = generateId()
      // orders.order_number is UNIQUE, and an order can be refunded more than once
      // over time (repeated partial refunds) — each pass needs its own distinct
      // REF- record, so number them REF-<original>-1, -2, etc.
      const priorRefunds = tx
        .select({ count: sql<number>`count(*)` })
        .from(schema.orders)
        .where(like(schema.orders.orderNumber, `REF-${original.order.orderNumber}%`))
        .get()?.count ?? 0
      const orderNumber = `REF-${original.order.orderNumber}-${priorRefunds + 1}`

      // order_items.order_id has a FOREIGN KEY on orders.id, enforced immediately
      // (PRAGMA foreign_keys = ON, not deferred) — the REF- order header must exist
      // before its line items are inserted below. Totals aren't known yet (they're
      // accumulated while inserting those lines), so insert with placeholders and
      // update them once the loop finishes.
      tx.insert(schema.orders)
        .values({
          id: refundId,
          orderNumber,
          status: 'refunded',
          customerId: original.order.customerId,
          staffId: original.order.staffId,
          shiftId: original.order.shiftId,
          // Preserve terminal and order type so per-terminal EOD reports include refunds correctly
          terminalId: original.order.terminalId,
          orderType: original.order.orderType,
          subtotal: 0,
          discountAmount: 0,
          taxAmount: 0,
          total: 0,
          notes: `Refund for ${original.order.orderNumber}`,
          loyaltyPointsEarned: 0,
          loyaltyPointsRedeemed: 0,
          syncStatus: 'pending',
          createdAt: now,
          updatedAt: now
        })
        .run()

      // orderItems.lineTotal is each line's contribution to order.subtotal, i.e.
      // (unitPrice - itemDiscount) * quantity — BEFORE the order-level manual
      // discount and tax (see create()/updateAndComplete()). orderItems.taxAmount
      // is always 0 system-wide; tax is only ever tracked as a single flat amount
      // on the order itself. So the order-level discount/tax/loyalty-redemption
      // amounts are prorated here by each line's share of the order's subtotal —
      // this exactly reproduces the original whole-order refund math when 100%
      // of every line is refunded at once, and is proportionally correct for any
      // partial subset.
      const orderSubtotal = original.order.subtotal
      const loyaltyDeduction = orderSubtotal - original.order.discountAmount + original.order.taxAmount - original.order.total

      let refundSubtotal = 0
      let refundDiscount = 0
      let refundTax = 0
      let refundTotal = 0

      for (const { orderItemId, quantity: requestedQty } of refundItems) {
        const item = original.items.find((i) => i.id === orderItemId)
        if (!item) throw new Error(`Order item ${orderItemId} not found on this order`)
        const remaining = item.quantity - item.refundedQuantity
        if (requestedQty <= 0 || requestedQty > remaining) {
          throw new Error(`Cannot refund ${requestedQty} of "${item.productName}" — only ${remaining} remaining`)
        }

        const itemDiscountPortion = round2((item.discountAmount / item.quantity) * requestedQty)
        const itemSubtotalPortion = round2((item.lineTotal / item.quantity) * requestedQty)
        const shareOfOrder = orderSubtotal > 0 ? itemSubtotalPortion / orderSubtotal : 0
        const orderDiscountPortion = round2(original.order.discountAmount * shareOfOrder)
        const orderTaxPortion = round2(original.order.taxAmount * shareOfOrder)
        const loyaltyPortion = round2(loyaltyDeduction * shareOfOrder)
        const itemTotalPortion = round2(itemSubtotalPortion - orderDiscountPortion + orderTaxPortion - loyaltyPortion)

        refundSubtotal += itemSubtotalPortion
        refundDiscount += orderDiscountPortion
        refundTax += orderTaxPortion
        refundTotal += itemTotalPortion

        tx.insert(schema.orderItems)
          .values({
            id: generateId(),
            orderId: refundId,
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            // Negative, matching every dollar field below — a fully-refunded original
            // order becomes status='refunded' and (per the widened report filter) its
            // full positive quantity is now counted again, so this REF- line's negative
            // quantity is what makes "units sold" net back to correct, the same way the
            // negative dollar amounts make revenue net out correctly.
            quantity: -requestedQty,
            unitPrice: item.unitPrice,
            discountAmount: -itemDiscountPortion,
            taxAmount: 0,
            lineTotal: -itemSubtotalPortion,
            refundedQuantity: 0,
            createdAt: now,
            updatedAt: now
          })
          .run()

        tx.update(schema.orderItems)
          .set({ refundedQuantity: item.refundedQuantity + requestedQty, updatedAt: now })
          .where(eq(schema.orderItems.id, item.id))
          .run()

        // Restore inventory only for the refunded quantity (handles pack/bundle components).
        restoreInventory(tx, item.productId, requestedQty, now, item.variantId)
      }

      // Now that every line's contribution has been accumulated, fill in the
      // REF- order's real totals (inserted as placeholders above, before the loop).
      tx.update(schema.orders)
        .set({
          subtotal: -refundSubtotal,
          discountAmount: -refundDiscount,
          taxAmount: -refundTax,
          total: -refundTotal,
          updatedAt: now
        })
        .where(eq(schema.orders.id, refundId))
        .run()

      // Insert a negative payment row for the REF- order, attributed
      // proportionally to the original order's payment method(s) (split
      // payments get split refunds). Without this, orders.total nets out
      // correctly for revenue reports, but the Cash/Card breakdown and the
      // EOD cash-drawer reconciliation (which read the payments table, not
      // orders.total) never reflected refunds at all.
      const totalPaid = original.payments.reduce((s, p) => s + p.amount, 0)
      if (totalPaid > 0 && refundTotal > 0) {
        let allocated = 0
        original.payments.forEach((p, idx) => {
          const isLast = idx === original.payments.length - 1
          const amount = isLast ? round2(refundTotal - allocated) : round2(refundTotal * (p.amount / totalPaid))
          allocated += amount
          const origAmount = p.originalAmount != null ? round2(amount * (p.originalAmount / p.amount)) : null
          tx.insert(schema.payments)
            .values({
              id: generateId(),
              orderId: refundId,
              method: p.method,
              amount: -amount,
              currency: p.currency,
              originalAmount: origAmount != null ? -origAmount : null,
              reference: p.reference,
              changeGiven: null,
              status: 'completed',
              createdAt: now
            })
            .run()
        })
      }

      // Only mark the original fully 'refunded' once every line has nothing left —
      // otherwise leave its status alone so its remaining revenue keeps reporting
      // correctly (report/QBO queries never mutate on partial refunds, they just
      // also include this new negative REF- order in their sums).
      const refreshedItems = tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).all()
      const fullyRefunded = refreshedItems.every((i) => i.quantity - i.refundedQuantity <= 0)
      if (fullyRefunded) {
        tx.update(schema.orders)
          .set({ status: 'refunded', updatedAt: now })
          .where(eq(schema.orders.id, orderId))
          .run()
      }

      // Reverse loyalty points proportionally to how much of the order's total this
      // refund covers — a one-shot full refund naturally reverses everything (ratio 1).
      if (original.order.customerId && (original.order.loyaltyPointsEarned > 0 || original.order.loyaltyPointsRedeemed > 0) && original.order.total > 0) {
        const ratio = Math.min(1, refundTotal / original.order.total)
        const pointsEarnedReversed = Math.round(original.order.loyaltyPointsEarned * ratio)
        const pointsRedeemedReversed = Math.round(original.order.loyaltyPointsRedeemed * ratio)
        const customer = tx
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, original.order.customerId))
          .get()
        if (customer) {
          tx.update(schema.customers)
            .set({
              loyaltyPoints: Math.max(0, customer.loyaltyPoints - pointsEarnedReversed + pointsRedeemedReversed),
              updatedAt: now
            })
            .where(eq(schema.customers.id, original.order.customerId))
            .run()
        }
      }

      // Audit trail — refunds previously left none, unlike voidOrder above.
      tx.insert(schema.auditLog)
        .values({
          id: generateId(),
          staffId: staffId || undefined,
          action: 'refund_order',
          entityType: 'order',
          entityId: orderId,
          details: JSON.stringify({ refundOrderId: refundId, items: refundItems }),
          createdAt: now
        })
        .run()

      const refundOrder = tx.select().from(schema.orders).where(eq(schema.orders.id, refundId)).get()!
      const refundOrderItems = tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, refundId)).all()
      const refundOrderPayments = tx.select().from(schema.payments).where(eq(schema.payments.orderId, refundId)).all()
      return { order: refundOrder, items: refundOrderItems, payments: refundOrderPayments }
    })
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
   * Edit an existing order in-place and immediately complete it.
   * Preserves the original order number and ID — no new order is created.
   *
   * For completed/delivered orders the old inventory is restored before
   * re-deducting the new items. All mutations run inside a single DB transaction.
   */
  updateAndComplete(input: UpdateAndCompleteInput): OrderWithItems {
    const db = getDatabase()
    return db.transaction((tx) => {
      const now = new Date().toISOString()

      const existing = tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, input.orderId))
        .get()
      if (!existing) throw new Error(`Order ${input.orderId} not found`)
      if (existing.status === 'voided') throw new Error('Voided orders cannot be edited')

      // ── Recalculate totals from new item list ──────────────────────────────
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
      const loyaltyPointsEarned = Math.floor(total)
      const loyaltyPointsRedeemed = input.loyaltyPointsRedeemed ?? 0

      // ── Snapshot old items before deletion (needed for inventory restore) ──
      // completed/delivered orders had inventory deducted — restore before re-deducting.
      // pending/held orders never reached deduction — nothing to restore.
      // refunded orders were deducted then restored — inventory already back.
      const inventoryAlreadyDeducted = ['completed', 'delivered'].includes(existing.status)
      const oldItems = inventoryAlreadyDeducted
        ? tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, input.orderId)).all()
        : []

      // ── Restore old inventory (C-2 fix) ───────────────────────────────────
      for (const item of oldItems) {
        restoreInventory(tx, item.productId, item.quantity, now, item.variantId)
      }

      // ── Reverse old loyalty points for completed/delivered edits ──────────
      const custId = input.customerId ?? existing.customerId
      if (inventoryAlreadyDeducted && custId &&
          (existing.loyaltyPointsEarned > 0 || existing.loyaltyPointsRedeemed > 0)) {
        const cust = tx.select().from(schema.customers).where(eq(schema.customers.id, custId)).get()
        if (cust) {
          tx.update(schema.customers)
            .set({
              loyaltyPoints: Math.max(
                0,
                cust.loyaltyPoints - existing.loyaltyPointsEarned + existing.loyaltyPointsRedeemed
              ),
              updatedAt: now
            })
            .where(eq(schema.customers.id, custId))
            .run()
        }
      }

      // ── Replace order items ────────────────────────────────────────────────
      tx.delete(schema.orderItems)
        .where(eq(schema.orderItems.orderId, input.orderId))
        .run()

      for (const item of input.items) {
        const lineTotal = (item.unitPrice - (item.discountAmount ?? 0)) * item.quantity
        tx.insert(schema.orderItems)
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

      // ── Update the order record (keep orderNumber, id, createdAt) ──────────
      tx.update(schema.orders)
        .set({
          customerId: custId,
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
          loyaltyPointsEarned,
          loyaltyPointsRedeemed,
          status: 'completed',
          syncStatus: 'pending',
          updatedAt: now,
        })
        .where(eq(schema.orders.id, input.orderId))
        .run()

      // ── Replace payments ───────────────────────────────────────────────────
      tx.delete(schema.payments)
        .where(eq(schema.payments.orderId, input.orderId))
        .run()

      for (const payment of input.payments) {
        if (payment.method === 'gift_card' && payment.giftCardCode) {
          const gc = tx
            .select()
            .from(schema.giftCards)
            .where(eq(schema.giftCards.code, payment.giftCardCode))
            .get()
          if (gc) {
            tx.update(schema.giftCards)
              .set({ balance: Math.max(0, gc.balance - payment.amount) })
              .where(eq(schema.giftCards.id, gc.id))
              .run()
          }
        }

        if (payment.method === 'store_credit' && custId) {
          const customer = tx
            .select()
            .from(schema.customers)
            .where(eq(schema.customers.id, custId))
            .get()
          if (customer) {
            // H-1 fix: guard against going negative
            tx.update(schema.customers)
              .set({
                storeCredit: Math.max(0, (customer.storeCredit ?? 0) - payment.amount),
                updatedAt: now
              })
              .where(eq(schema.customers.id, custId))
              .run()
          }
        }

        // Insert the payment record (was missing entirely before this fix)
        tx.insert(schema.payments)
          .values({
            id: generateId(),
            orderId: input.orderId,
            method: payment.method,
            amount: payment.amount,
            currency: payment.currency ?? 'KYD',
            originalAmount: payment.originalAmount ?? payment.amount,
            reference: payment.reference,
            changeGiven: payment.changeGiven,
            status: 'completed',
            createdAt: now,
          })
          .run()
      }

      // ── Deduct inventory for new items (C-2 fix) ──────────────────────────
      for (const item of input.items) {
        deductInventory(tx, item.productId, item.quantity, now, item.variantId)
      }

      // ── Award updated loyalty points ───────────────────────────────────────
      if (custId && loyaltyPointsEarned > 0) {
        const customer = tx.select().from(schema.customers).where(eq(schema.customers.id, custId)).get()
        if (customer) {
          tx.update(schema.customers)
            .set({
              loyaltyPoints: Math.max(
                0,
                customer.loyaltyPoints + loyaltyPointsEarned - loyaltyPointsRedeemed
              ),
              updatedAt: now
            })
            .where(eq(schema.customers.id, custId))
            .run()
        }
      }

      // ── Return the fully updated order (C-1 fix) ──────────────────────────
      const updatedOrder = tx.select().from(schema.orders).where(eq(schema.orders.id, input.orderId)).get()!
      const updatedItems = tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, input.orderId)).all()
      const updatedPays = tx.select().from(schema.payments).where(eq(schema.payments.orderId, input.orderId)).all()
      return { order: updatedOrder, items: updatedItems, payments: updatedPays }
    })
  },
}
