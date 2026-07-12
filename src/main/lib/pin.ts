import * as crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'

const SALT_KEY = 'pinSalt'

/**
 * PIN storage scheme.
 *
 * PINs are hashed with a slow, deterministic KDF (PBKDF2-HMAC-SHA256) using the
 * per-installation salt. Determinism is required because the auth path looks a
 * PIN up with an indexed equality query (`WHERE pin = <hash>`) rather than a
 * per-row compare — the same salt is shared across terminals via sync, so a PIN
 * hashed on one register validates on every register.
 *
 * Stored format:  pbkdf2$<iterations>$<hex>
 *
 * Legacy hashes (plain 64-char SHA-256 hex, no `$`) are still accepted so
 * existing installs keep working; `authenticate()` transparently upgrades a
 * matched legacy hash to PBKDF2 on the next successful sign-in.
 */
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_KEYLEN = 32
const PBKDF2_DIGEST = 'sha256'
const PBKDF2_PREFIX = 'pbkdf2$'

/**
 * Gets or creates the per-installation PIN salt stored in the settings table.
 * The salt is generated once using cryptographically secure randomness. It is
 * shared across terminals via sync (it is NOT machine-specific) so that PIN
 * hashes are portable between registers.
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

/** Legacy SHA-256 hash (pre-PBKDF2). Used only to match/verify existing rows. */
function legacyHash(pin: string, salt: string): string {
  return crypto.createHash('sha256').update(salt + pin).digest('hex')
}

/** PBKDF2 hash in the self-describing stored format. */
function pbkdf2Hash(pin: string, salt: string): string {
  const derived = crypto
    .pbkdf2Sync(pin, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex')
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${derived}`
}

/** True if a stored hash is the old plain-SHA-256 format (no scheme prefix). */
export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith(PBKDF2_PREFIX)
}

/**
 * Hashes a PIN for STORAGE. Always produces the current (PBKDF2) scheme.
 * Use this whenever writing a PIN to the database (create, update, reset, seed,
 * dashboard PIN).
 */
export function hashPin(pin: string): string {
  return pbkdf2Hash(pin, getPinSalt())
}

/**
 * Returns both candidate hashes for a plaintext PIN — the current scheme and the
 * legacy scheme — so a single `WHERE pin IN (?, ?)` lookup can match rows in
 * either format during the migration window.
 */
export function candidateHashes(pin: string): { current: string; legacy: string } {
  const salt = getPinSalt()
  return { current: pbkdf2Hash(pin, salt), legacy: legacyHash(pin, salt) }
}

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/**
 * Verifies a plaintext PIN against a stored hash of EITHER scheme.
 * Does not touch the database beyond reading the salt.
 */
export function verifyPin(pin: string, storedHash: string): boolean {
  if (!pin || !storedHash) return false
  const salt = getPinSalt()
  if (storedHash.startsWith(PBKDF2_PREFIX)) {
    return safeEqual(pbkdf2Hash(pin, salt), storedHash)
  }
  return safeEqual(legacyHash(pin, salt), storedHash)
}
