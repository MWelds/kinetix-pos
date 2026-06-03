import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'

export interface DiscountInput {
  name: string
  type: 'percentage' | 'fixed' | 'bogo' | 'category'
  value: number
  minOrderAmount?: number
  categoryId?: string
  productId?: string
  couponCode?: string
  isActive?: boolean
  validFrom?: string
  validUntil?: string
}

export const discountService = {
  list() {
    const db = getDatabase()
    return db.select().from(schema.discountRules)
      .orderBy(schema.discountRules.name)
      .all()
  },

  getById(id: string) {
    const db = getDatabase()
    return db.select().from(schema.discountRules)
      .where(eq(schema.discountRules.id, id))
      .get()
  },

  create(input: DiscountInput) {
    const db = getDatabase()
    const id = generateId()
    const now = new Date().toISOString()
    db.insert(schema.discountRules)
      .values({
        id,
        name: input.name,
        type: input.type,
        value: input.value,
        minOrderAmount: input.minOrderAmount ?? null,
        categoryId: input.categoryId ?? null,
        productId: input.productId ?? null,
        couponCode: input.couponCode ?? null,
        isActive: input.isActive ?? true,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return db.select().from(schema.discountRules)
      .where(eq(schema.discountRules.id, id)).get()
  },

  update(id: string, input: Partial<DiscountInput>) {
    const db = getDatabase()
    db.update(schema.discountRules)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(schema.discountRules.id, id))
      .run()
    return db.select().from(schema.discountRules)
      .where(eq(schema.discountRules.id, id)).get()
  },

  /**
   * Validate a coupon code against an order total.
   * Returns the matching discount rule if valid, or null with a reason if not.
   */
  validateCoupon(code: string, orderTotal: number): { valid: boolean; discount: typeof schema.discountRules.$inferSelect | null; reason?: string } {
    if (!code?.trim()) return { valid: false, discount: null, reason: 'No code provided' }
    const db = getDatabase()
    const rule = db.select().from(schema.discountRules)
      .where(eq(schema.discountRules.couponCode, code.trim().toUpperCase()))
      .get()

    if (!rule) return { valid: false, discount: null, reason: 'Invalid coupon code' }
    if (!rule.isActive) return { valid: false, discount: null, reason: 'Coupon is no longer active' }

    const now = new Date().toISOString()
    if (rule.validFrom && now < rule.validFrom) return { valid: false, discount: null, reason: 'Coupon not yet valid' }
    if (rule.validUntil && now > rule.validUntil) return { valid: false, discount: null, reason: 'Coupon has expired' }
    if (rule.minOrderAmount && orderTotal < rule.minOrderAmount) {
      return { valid: false, discount: null, reason: `Minimum order of $${rule.minOrderAmount.toFixed(2)} required` }
    }

    return { valid: true, discount: rule }
  }
}
