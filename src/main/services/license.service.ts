/**
 * License service — main process only.
 *
 * Responsibilities:
 *  - Verify HMAC-signed license keys (offline, no server call needed)
 *  - Store/retrieve license state in the settings table
 *  - Track the 30-day trial window for new installations
 *
 * Key format:  KPOS-{BASE64URL_PAYLOAD}.{HEX_HMAC_16_CHARS}
 *
 * IMPORTANT: Change LICENSE_SECRET before distributing and keep it out of git.
 * Generate a new secret with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createHmac } from 'crypto'
import type Database from 'better-sqlite3'

// ─── Secret ───────────────────────────────────────────────────────────────────
// Must match scripts/generate-license.ts exactly.
const LICENSE_SECRET = 'kp-e3f8a291c4d56b7082f9e4a3c1d7b509'

// ─── Types ────────────────────────────────────────────────────────────────────

export type LicenseTier = 'starter' | 'standard' | 'pro' | 'lifetime'

/** Raw payload embedded in a license key. */
export interface LicensePayload {
  /** Tier code: st=starter  sd=standard  pr=pro  lt=lifetime */
  t: 'st' | 'sd' | 'pr' | 'lt'
  /** ISO date the subscription expires. null = never (lifetime). */
  e: string | null
  /** ISO date free updates end. null = never. */
  u: string | null
  /** Max simultaneous registers allowed. */
  r: number
  /** Random nonce so two keys for the same tier/expiry differ. */
  n: string
}

/** Full license status returned to the renderer via IPC. */
export interface LicenseInfo {
  tier: LicenseTier
  expiresAt: string | null
  updatesUntil: string | null
  maxRegisters: number
  activatedAt: string | null
  isExpired: boolean
  isUpdatesExpired: boolean
  isTrialActive: boolean
  trialDaysLeft: number
  /** True when the store can use the current tier (trial or valid, non-expired license). */
  isValid: boolean
}

// ─── Internal constants ───────────────────────────────────────────────────────

const TRIAL_DAYS = 30

const TIER_MAP: Record<LicensePayload['t'], LicenseTier> = {
  st: 'starter',
  sd: 'standard',
  pr: 'pro',
  lt: 'lifetime',
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _db: Database.Database | null = null

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Must be called once from handlers.ts after the DB is open.
 * Seeds the trial-start timestamp on first launch.
 */
export function initLicenseService(db: Database.Database): void {
  _db = db
  db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('licenseTrialStarted', ?, ?)`
  ).run(new Date().toISOString(), new Date().toISOString())
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

function getSetting(key: string): string | null {
  const row = _db!
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setSetting(key: string, value: string): void {
  _db!
    .prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`
    )
    .run(key, value, new Date().toISOString())
}

function deleteSetting(key: string): void {
  _db!.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
}

// ─── Key verification ─────────────────────────────────────────────────────────

/**
 * Verify a raw license key string.
 * Returns the decoded payload if valid, null otherwise.
 * Pure function — no side effects, no DB access.
 */
export function verifyKey(rawKey: string): LicensePayload | null {
  try {
    const key = rawKey.trim().toUpperCase()
    if (!key.startsWith('KPOS-')) return null

    const rest = key.slice(5)
    const dotIdx = rest.lastIndexOf('.')
    if (dotIdx === -1) return null

    const payloadB64 = rest.slice(0, dotIdx)
    const sigHex = rest.slice(dotIdx + 1)

    // Decode payload
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const payload = JSON.parse(payloadJson) as LicensePayload

    // Verify HMAC — timing-safe comparison not strictly needed here (offline, no oracle)
    const expectedSig = createHmac('sha256', LICENSE_SECRET)
      .update(payloadB64)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase()

    if (sigHex !== expectedSig) return null

    // Validate required fields
    if (!['st', 'sd', 'pr', 'lt'].includes(payload.t)) return null
    if (typeof payload.r !== 'number' || payload.r < 1) return null

    return payload
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempt to activate a license key.
 * Persists to the settings table on success.
 */
export function activateLicense(rawKey: string): { ok: boolean; error?: string } {
  const payload = verifyKey(rawKey)
  if (!payload) {
    return { ok: false, error: 'Invalid license key. Please check the key and try again.' }
  }

  // Check if already expired at activation time
  if (payload.e && new Date(payload.e) < new Date()) {
    return { ok: false, error: 'This license key has already expired.' }
  }

  const tier = TIER_MAP[payload.t]
  const now = new Date().toISOString()

  setSetting('licenseKey', rawKey.trim())
  setSetting('licenseTier', tier)
  setSetting('licenseExpiresAt', payload.e ?? '')
  setSetting('licenseUpdatesUntil', payload.u ?? '')
  setSetting('licenseMaxRegisters', String(payload.r))
  setSetting('licenseActivatedAt', now)

  console.log(`[license] Activated ${tier} tier (key: ${rawKey.slice(0, 12)}…)`)
  return { ok: true }
}

/** Remove the current license from the DB. Falls back to trial/starter mode. */
export function deactivateLicense(): void {
  const keys = [
    'licenseKey', 'licenseTier', 'licenseExpiresAt',
    'licenseUpdatesUntil', 'licenseMaxRegisters', 'licenseActivatedAt',
  ]
  for (const key of keys) deleteSetting(key)
  console.log('[license] Deactivated license')
}

/**
 * Return the full license status for the current installation.
 * This is the single source of truth — called by the renderer via IPC.
 */
export function getLicenseInfo(): LicenseInfo {
  const trialStarted = getSetting('licenseTrialStarted') ?? new Date().toISOString()
  const trialMs = Date.now() - new Date(trialStarted).getTime()
  const trialDaysLeft = Math.max(0, TRIAL_DAYS - Math.floor(trialMs / 86_400_000))
  const isTrialActive = trialDaysLeft > 0

  const licenseKey = getSetting('licenseKey')

  // No license key — use trial window
  if (!licenseKey) {
    return {
      tier: 'starter',
      expiresAt: null,
      updatesUntil: null,
      maxRegisters: 1,
      activatedAt: null,
      isExpired: false,
      isUpdatesExpired: false,
      isTrialActive,
      trialDaysLeft,
      isValid: isTrialActive,
    }
  }

  // License present — decode and return current state
  const tier = (getSetting('licenseTier') ?? 'starter') as LicenseTier
  const expiresAt = getSetting('licenseExpiresAt') || null
  const updatesUntil = getSetting('licenseUpdatesUntil') || null
  const maxRegisters = parseInt(getSetting('licenseMaxRegisters') ?? '1', 10)
  const activatedAt = getSetting('licenseActivatedAt')

  const now = new Date()
  const isExpired = expiresAt ? new Date(expiresAt) < now : false
  const isUpdatesExpired = updatesUntil ? new Date(updatesUntil) < now : false

  return {
    tier: isExpired ? 'starter' : tier,
    expiresAt,
    updatesUntil,
    maxRegisters,
    activatedAt,
    isExpired,
    isUpdatesExpired,
    isTrialActive: false,
    trialDaysLeft: 0,
    isValid: !isExpired,
  }
}
