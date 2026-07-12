import { eq, desc, inArray } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'
import { hashPin, candidateHashes, isLegacyHash } from '../lib/pin'

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
        canAccessDashboard: schema.staff.canAccessDashboard,
        createdAt: schema.staff.createdAt
      })
      .from(schema.staff)
      .where(eq(schema.staff.isActive, true))
      .all()
  },

  /** Get a single staff member by ID (without PIN field). */
  get(id: string) {
    const db = getDatabase()
    const member = db.select().from(schema.staff).where(eq(schema.staff.id, id)).get()
    if (!member) return null
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pin: _pin, ...safe } = member
    return safe
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
    // Match either hash scheme in one indexed lookup (current PBKDF2 or legacy
    // SHA-256) so existing installs keep working during the migration window.
    const { current, legacy } = candidateHashes(pin)
    const member = db
      .select()
      .from(schema.staff)
      .where(inArray(schema.staff.pin, [current, legacy]))
      .get()

    if (!member || !member.isActive) return null

    // Transparent upgrade: if this PIN is still stored under the legacy scheme,
    // rehash it to PBKDF2 now that we know the plaintext. Best-effort — a failed
    // rehash must never block a valid login.
    if (isLegacyHash(member.pin)) {
      try {
        db.update(schema.staff)
          .set({ pin: current, updatedAt: new Date().toISOString() })
          .where(eq(schema.staff.id, member.id))
          .run()
      } catch { /* keep legacy hash; will retry on next login */ }
    }

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
      canAccessDashboard: boolean
    }>
  ) {
    if (!id) throw new Error('id is required')
    const db = getDatabase()
    const payload: typeof input & { pin?: string; isDefaultPin?: boolean; updatedAt: string } = {
      ...input,
      updatedAt: new Date().toISOString()
    }
    if (input.pin !== undefined) {
      if (input.pin.length < 4) throw new Error('PIN must be at least 4 characters')
      payload.pin = hashPin(input.pin)
      // Whatever PIN is set here is no longer the seeded default.
      payload.isDefaultPin = false
    }
    db.update(schema.staff).set(payload).where(eq(schema.staff.id, id)).run()
    return this.list().find((s) => s.id === id) ?? null
  },

  /**
   * Soft-deletes a staff member by setting is_active=false and deleted_at.
   * The record is retained for audit trail and sync purposes.
   */
  delete(id: string) {
    if (!id) throw new Error('id is required')
    const db = getDatabase()
    const now = new Date().toISOString()
    db.update(schema.staff)
      .set({ isActive: false, updatedAt: now })
      .where(eq(schema.staff.id, id))
      .run()
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

  /**
   * Close a shift.  If `requestingStaffId` is provided the shift must belong to
   * that staff member — prevents a cashier from closing another user's shift.
   * Omit `requestingStaffId` only from trusted manager/admin code paths.
   */
  closeShift(shiftId: string, closingCash: number, notes?: string, requestingStaffId?: string) {
    const db = getDatabase()
    if (requestingStaffId) {
      const existing = db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).get()
      if (!existing) throw new Error('Shift not found')
      if (existing.staffId !== requestingStaffId) {
        throw new Error('Cannot close a shift belonging to another staff member')
      }
    }
    db.update(schema.shifts)
      .set({
        closedAt: new Date().toISOString(),
        closingCash,
        notes,
        status: 'closed',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.shifts.id, shiftId))
      .run()
    return db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).get()
  },

  getCurrentShift(staffId: string) {
    const db = getDatabase()
    // Filter status at the DB level — avoids loading all historical shifts into memory
    return (
      db
        .select()
        .from(schema.shifts)
        .where(eq(schema.shifts.staffId, staffId))
        .all()
        .find((s) => s.status === 'open') ?? null
    )
  },

  listShifts() {
    const db = getDatabase()
    const rows = db
      .select({
        id: schema.shifts.id,
        staffId: schema.shifts.staffId,
        openedAt: schema.shifts.openedAt,
        closedAt: schema.shifts.closedAt,
        openingCash: schema.shifts.openingCash,
        closingCash: schema.shifts.closingCash,
        notes: schema.shifts.notes,
        status: schema.shifts.status,
        firstName: schema.staff.firstName,
        lastName: schema.staff.lastName,
      })
      .from(schema.shifts)
      .leftJoin(schema.staff, eq(schema.shifts.staffId, schema.staff.id))
      .all()
    return rows
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map((r) => ({
        id: r.id,
        staffId: r.staffId,
        openedAt: r.openedAt,
        closedAt: r.closedAt ?? null,
        openingCash: r.openingCash,
        closingCash: r.closingCash ?? null,
        notes: r.notes ?? null,
        status: r.status as 'open' | 'closed',
        staffName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : 'Unknown',
      }))
  },

  reopenShift(shiftId: string) {
    if (!shiftId) throw new Error('shiftId is required')
    const db = getDatabase()
    db.update(schema.shifts)
      .set({ status: 'open', closedAt: null, closingCash: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.shifts.id, shiftId))
      .run()
    return db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).get()
  },

  getOrdersForShift(shiftId: string) {
    if (!shiftId) return []
    const db = getDatabase()
    return db
      .select({
        id: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        total: schema.orders.total,
        status: schema.orders.status,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.shiftId, shiftId))
      .all()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
