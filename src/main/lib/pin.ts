import * as crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'

const SALT_KEY = 'pinSalt'

/**
 * Gets or creates the per-installation PIN salt stored in the settings table.
 * The salt is generated once using cryptographically secure randomness and
 * never leaves the main process.
 */
function getPinSalt(): string {
  const db = getDatabase()
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, SALT_KEY)).get()
  if (row?.value) return row.value

  const salt = crypto.randomBytes(32).toString('hex')
  db.insert(schema.settings)
    .values({ key: SALT_KEY, value: salt, updatedAt: new Date().toISOString() })
    .run()
  return salt
}

/**
 * Hashes a PIN with the per-installation salt using SHA-256.
 * Always call this before storing or comparing PINs.
 */
export function hashPin(pin: string): string {
  const salt = getPinSalt()
  return crypto.createHash('sha256').update(salt + pin).digest('hex')
}
