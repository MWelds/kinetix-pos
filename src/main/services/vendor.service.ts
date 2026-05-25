import { eq, sql } from 'drizzle-orm'
import { getDatabase, getSqlite } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'

export interface VendorWithBalance {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  /** Total owed to vendor from completed sales (vendorCost × qty sold) */
  totalEarned: number
  /** Total already paid out to vendor */
  totalPaid: number
  /** Current outstanding balance (totalEarned - totalPaid) */
  balanceOwed: number
}

export interface CreateVendorInput {
  name: string
  phone?: string
  email?: string
  notes?: string
}

export interface RecordPayoutInput {
  vendorId: string
  amount: number
  note?: string
  staffId?: string
}

/**
 * How much has been earned for a vendor from completed order items.
 * Uses a raw prepared statement to avoid Drizzle JOIN alias ambiguity.
 */
function calcEarned(vendorId: string): number {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT COALESCE(SUM(oi.quantity * p.vendor_cost), 0) AS total
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       JOIN orders o ON oi.order_id = o.id
       WHERE p.vendor_id = ?
         AND o.status = 'completed'
         AND p.vendor_cost IS NOT NULL`
    )
    .get(vendorId) as { total: number } | undefined
  return Number(row?.total ?? 0)
}

/**
 * How much has already been paid out to a vendor.
 */
function calcPaid(vendorId: string): number {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM vendor_payouts
       WHERE vendor_id = ?`
    )
    .get(vendorId) as { total: number } | undefined
  return Number(row?.total ?? 0)
}

export const vendorService = {
  /**
   * List all vendors with their current outstanding balance.
   * Balance = Σ(orderItem.qty × product.vendorCost) for completed orders
   *           − Σ(recorded payouts)
   */
  list(): VendorWithBalance[] {
    const db = getDatabase()
    const rows = db.select().from(schema.vendors).orderBy(schema.vendors.name).all()
    return rows.map((v) => {
      const totalEarned = calcEarned(v.id)
      const totalPaid = calcPaid(v.id)
      return { ...v, totalEarned, totalPaid, balanceOwed: Math.max(0, totalEarned - totalPaid) }
    })
  },

  /** Fetch a single vendor with balance. */
  getById(id: string): VendorWithBalance | null {
    const db = getDatabase()
    const v = db.select().from(schema.vendors).where(eq(schema.vendors.id, id)).get()
    if (!v) return null
    const totalEarned = calcEarned(v.id)
    const totalPaid = calcPaid(v.id)
    return { ...v, totalEarned, totalPaid, balanceOwed: Math.max(0, totalEarned - totalPaid) }
  },

  /** Create a new vendor. */
  create(input: CreateVendorInput): VendorWithBalance {
    const db = getDatabase()
    const now = new Date().toISOString()
    const id = generateId()
    db.insert(schema.vendors)
      .values({
        id,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return vendorService.getById(id)!
  },

  /** Update vendor details. */
  update(id: string, input: Partial<CreateVendorInput>): VendorWithBalance {
    const db = getDatabase()
    const now = new Date().toISOString()
    db.update(schema.vendors)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone || null }),
        ...(input.email !== undefined && { email: input.email || null }),
        ...(input.notes !== undefined && { notes: input.notes || null }),
        updatedAt: now
      })
      .where(eq(schema.vendors.id, id))
      .run()
    return vendorService.getById(id)!
  },

  /** Delete a vendor (only if no products are assigned to them). */
  delete(id: string): { ok: boolean; reason?: string } {
    const db = getDatabase()
    const linked = db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.vendorId, id))
      .all()
    if (linked.length > 0) {
      return { ok: false, reason: 'Vendor has products assigned. Reassign or remove them first.' }
    }
    db.delete(schema.vendorPayouts).where(eq(schema.vendorPayouts.vendorId, id)).run()
    db.delete(schema.vendors).where(eq(schema.vendors.id, id)).run()
    return { ok: true }
  },

  /** Record a cash payment to a vendor. Returns updated balance. */
  recordPayout(input: RecordPayoutInput): {
    payout: typeof schema.vendorPayouts.$inferSelect
    balanceOwed: number
  } {
    const db = getDatabase()
    const now = new Date().toISOString()
    const id = generateId()
    db.insert(schema.vendorPayouts)
      .values({
        id,
        vendorId: input.vendorId,
        amount: input.amount,
        note: input.note ?? null,
        staffId: input.staffId ?? null,
        createdAt: now
      })
      .run()
    const payout = db
      .select()
      .from(schema.vendorPayouts)
      .where(eq(schema.vendorPayouts.id, id))
      .get()!
    const vendor = vendorService.getById(input.vendorId)!
    return { payout, balanceOwed: vendor.balanceOwed }
  },

  /** List payout history for a vendor, newest first. */
  payoutHistory(vendorId: string): Array<typeof schema.vendorPayouts.$inferSelect> {
    const db = getDatabase()
    return db
      .select()
      .from(schema.vendorPayouts)
      .where(eq(schema.vendorPayouts.vendorId, vendorId))
      .orderBy(sql`${schema.vendorPayouts.createdAt} DESC`)
      .all()
  },

  /** List products belonging to a vendor. */
  products(vendorId: string): Array<{
    id: string
    name: string
    sku: string
    basePrice: number
    vendorCost: number | null
  }> {
    const db = getDatabase()
    return db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        sku: schema.products.sku,
        basePrice: schema.products.basePrice,
        vendorCost: schema.products.vendorCost
      })
      .from(schema.products)
      .where(eq(schema.products.vendorId, vendorId))
      .all()
  }
}
