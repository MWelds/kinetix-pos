import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'

export const giftCardService = {
  getByCode(code: string) {
    if (!code?.trim()) return null
    const db = getDatabase()
    return db.select().from(schema.giftCards)
      .where(eq(schema.giftCards.code, code.trim().toUpperCase()))
      .get() ?? null
  },

  getById(id: string) {
    const db = getDatabase()
    return db.select().from(schema.giftCards)
      .where(eq(schema.giftCards.id, id))
      .get() ?? null
  },

  create(input: { code?: string; balance: number; isActive?: boolean }) {
    const db = getDatabase()
    const id = generateId()
    const now = new Date().toISOString()
    // Auto-generate a code if not provided (e.g. GC-XXXXXXXX)
    const code = (input.code?.trim().toUpperCase()) || `GC-${generateId().slice(0, 8).toUpperCase()}`

    db.insert(schema.giftCards)
      .values({
        id,
        code,
        balance: input.balance,
        initialBalance: input.balance,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return db.select().from(schema.giftCards)
      .where(eq(schema.giftCards.id, id)).get()
  },

  /**
   * Apply a gift card payment. Deducts amount from balance and returns
   * the updated card. Throws if the card is not found, inactive, or has
   * insufficient balance.
   */
  redeem(code: string, amount: number) {
    const db = getDatabase()
    const card = db.select().from(schema.giftCards)
      .where(eq(schema.giftCards.code, code.trim().toUpperCase()))
      .get()

    if (!card) throw new Error('Gift card not found')
    if (!card.isActive) throw new Error('Gift card is not active')
    if (card.balance < amount) throw new Error(`Insufficient balance ($${card.balance.toFixed(2)} available)`)

    const newBalance = Math.max(0, card.balance - amount)
    db.update(schema.giftCards)
      .set({ balance: newBalance, updatedAt: new Date().toISOString() })
      .where(eq(schema.giftCards.id, card.id))
      .run()

    return { ...card, balance: newBalance }
  }
}
