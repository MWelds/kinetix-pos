import { eq, like, or, and, desc, isNull } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'

export const customerService = {
  list() {
    const db = getDatabase()
    return db
      .select()
      .from(schema.customers)
      .where(isNull(schema.customers.deletedAt))
      .orderBy(schema.customers.firstName)
      .all()
  },

  getById(id: string) {
    const db = getDatabase()
    return db.select().from(schema.customers).where(eq(schema.customers.id, id)).get() ?? null
  },

  search(query: string) {
    const db = getDatabase()
    const like_ = `%${query}%`
    return db
      .select()
      .from(schema.customers)
      .where(
        and(
          isNull(schema.customers.deletedAt),
          or(
            like(schema.customers.firstName, like_),
            like(schema.customers.lastName, like_),
            like(schema.customers.email, like_),
            like(schema.customers.phone, like_)
          )
        )
      )
      .limit(20)
      .all()
  },

  create(input: {
    firstName: string
    lastName: string
    email?: string
    phone?: string
    address?: string
    notes?: string
  }) {
    const db = getDatabase()
    const id = generateId()
    const now = new Date().toISOString()
    db.insert(schema.customers)
      .values({ id, ...input, loyaltyPoints: 0, storeCredit: 0, createdAt: now, updatedAt: now })
      .run()
    return this.getById(id)!
  },

  update(
    id: string,
    input: Partial<{
      firstName: string
      lastName: string
      email: string
      phone: string
      address: string
      notes: string
      loyaltyPoints: number
      storeCredit: number
    }>
  ) {
    const db = getDatabase()
    db.update(schema.customers)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(schema.customers.id, id))
      .run()
    return this.getById(id)!
  },

  /**
   * Soft-deletes a customer by setting deleted_at.
   * The record is retained for historical order references.
   */
  delete(id: string) {
    if (!id) throw new Error('id is required')
    const db = getDatabase()
    const now = new Date().toISOString()
    db.update(schema.customers)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.customers.id, id))
      .run()
  },

  getPurchaseHistory(customerId: string) {
    const db = getDatabase()
    return db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.customerId, customerId))
      .orderBy(desc(schema.orders.createdAt))
      .limit(100)
      .all()
  }
}
