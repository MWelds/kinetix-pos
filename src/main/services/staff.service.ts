import { eq, desc } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'
import { hashPin } from '../lib/pin'

export type StaffRole = 'cashier' | 'manager' | 'admin'

export const staffService = {
  list() {
    const db = getDatabase()
    return db
      .select({
        id: schema.staff.id,
        firstName: schema.staff.firstName,
        lastName: schema.staff.lastName,
        email: schema.staff.email,
        role: schema.staff.role,
        isActive: schema.staff.isActive,
        createdAt: schema.staff.createdAt
      })
      .from(schema.staff)
      .where(eq(schema.staff.isActive, true))
      .all()
  },

  /**
   * Authenticate staff by PIN.
   * The supplied PIN is hashed before comparison — plaintext PINs are never
   * stored or compared directly.
   * Returns staff record (without the hashed PIN field) or null on failure.
   */
  authenticate(pin: string) {
    if (!pin || typeof pin !== 'string' || pin.length === 0) return null
    const db = getDatabase()
    const hashed = hashPin(pin)
    const member = db
      .select()
      .from(schema.staff)
      .where(eq(schema.staff.pin, hashed))
      .get()

    if (!member || !member.isActive) return null

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pin: _pin, ...safe } = member
    return safe
  },

  /** Creates a new staff member. The PIN is hashed before storage. */
  create(input: {
    firstName: string
    lastName: string
    email?: string
    pin: string
    role: StaffRole
  }) {
    if (!input.pin || input.pin.length < 4) throw new Error('PIN must be at least 4 characters')
    const db = getDatabase()
    const id = generateId()
    const now = new Date().toISOString()
    db.insert(schema.staff)
      .values({
        id,
        ...input,
        pin: hashPin(input.pin),
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return this.list().find((s) => s.id === id) ?? null
  },

  /** Updates a staff member. If pin is provided it is hashed before storage. */
  update(
    id: string,
    input: Partial<{
      firstName: string
      lastName: string
      email: string
      pin: string
      role: StaffRole
      isActive: boolean
    }>
  ) {
    if (!id) throw new Error('id is required')
    const db = getDatabase()
    const payload: typeof input & { pin?: string; updatedAt: string } = {
      ...input,
      updatedAt: new Date().toISOString()
    }
    if (input.pin !== undefined) {
      if (input.pin.length < 4) throw new Error('PIN must be at least 4 characters')
      payload.pin = hashPin(input.pin)
    }
    db.update(schema.staff).set(payload).where(eq(schema.staff.id, id)).run()
    return this.list().find((s) => s.id === id) ?? null
  },

  // ─── Shifts ────────────────────────────────────────────────────────────────

  openShift(staffId: string, openingCash: number) {
    const db = getDatabase()
    const id = generateId()
    db.insert(schema.shifts)
      .values({
        id,
        staffId,
        openedAt: new Date().toISOString(),
        openingCash,
        status: 'open'
      })
      .run()
    return db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).get()
  },

  closeShift(shiftId: string, closingCash: number, notes?: string) {
    const db = getDatabase()
    db.update(schema.shifts)
      .set({
        closedAt: new Date().toISOString(),
        closingCash,
        notes,
        status: 'closed'
      })
      .where(eq(schema.shifts.id, shiftId))
      .run()
    return db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).get()
  },

  getCurrentShift(staffId: string) {
    const db = getDatabase()
    return (
      db
        .select()
        .from(schema.shifts)
        .where(eq(schema.shifts.staffId, staffId))
        .all()
        .find((s) => s.status === 'open') ?? null
    )
  },

  // ─── Audit ────────────────────────────────────────────────────────────────

  logAction(input: {
    staffId?: string
    action: string
    entityType: string
    entityId?: string
    details?: Record<string, unknown>
  }) {
    const db = getDatabase()
    db.insert(schema.auditLog)
      .values({
        id: generateId(),
        staffId: input.staffId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        details: input.details ? JSON.stringify(input.details) : undefined,
        createdAt: new Date().toISOString()
      })
      .run()
  },

  listAuditLog(limit = 100) {
    const db = getDatabase()
    return db
      .select()
      .from(schema.auditLog)
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(limit)
      .all()
  }
}
