/**
 * License Key Generator — run this locally to issue keys for customers.
 *
 * Usage:
 *   npx ts-node scripts/generate-license.ts --tier standard --months 12
 *   npx ts-node scripts/generate-license.ts --tier pro --months 12
 *   npx ts-node scripts/generate-license.ts --tier lifetime
 *
 * Options:
 *   --tier     starter | standard | pro | lifetime  (required)
 *   --months   Subscription length in months (omit for lifetime)
 *   --registers Override max registers (uses tier default if omitted)
 *   --update-years  Years of updates included (default: 1 for subscriptions, 2 for lifetime)
 *
 * IMPORTANT: LICENSE_SECRET must match src/main/services/license.service.ts exactly.
 * Keep this file and the secret out of version control if you want to prevent
 * customers from generating their own keys.
 */

import { createHmac, randomBytes } from 'crypto'

// ─── Must match license.service.ts ───────────────────────────────────────────
const LICENSE_SECRET = 'kp-e3f8a291c4d56b7082f9e4a3c1d7b509'

// ─── Types ───────────────────────────────────────────────────────────────────
type TierCode = 'st' | 'sd' | 'pr' | 'lt'
type Tier = 'starter' | 'standard' | 'pro' | 'lifetime'

const TIER_CODES: Record<Tier, TierCode> = {
  starter:  'st',
  standard: 'sd',
  pro:      'pr',
  lifetime: 'lt',
}

const DEFAULT_REGISTERS: Record<Tier, number> = {
  starter:  1,
  standard: 3,
  pro:      999,
  lifetime: 5,
}

const TIER_PRICES: Record<Tier, string> = {
  starter:  '$49/month',
  standard: '$89/month',
  pro:      '$149/month',
  lifetime: '$599 one-time',
}

// ─── Key generation ───────────────────────────────────────────────────────────

function generateKey(opts: {
  tier: Tier
  months?: number
  registers?: number
  updateYears?: number
}): string {
  const tierCode = TIER_CODES[opts.tier]
  const isLifetime = opts.tier === 'lifetime'
  const now = new Date()

  // Expiry date
  let expiresAt: string | null = null
  if (!isLifetime) {
    if (!opts.months || opts.months < 1) {
      throw new Error('--months is required for non-lifetime tiers')
    }
    const exp = new Date(now)
    exp.setMonth(exp.getMonth() + opts.months)
    expiresAt = exp.toISOString().slice(0, 10)
  }

  // Updates-until date
  const updateYears = opts.updateYears ?? (isLifetime ? 2 : 1)
  const updExp = new Date(now)
  updExp.setFullYear(updExp.getFullYear() + updateYears)
  const updatesUntil = updExp.toISOString().slice(0, 10)

  const maxRegisters = opts.registers ?? DEFAULT_REGISTERS[opts.tier]
  const nonce = randomBytes(4).toString('hex').toUpperCase()

  const payload = {
    t: tierCode,
    e: expiresAt,
    u: updatesUntil,
    r: maxRegisters,
    n: nonce,
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload))
    .toString('base64url')
    .toUpperCase()

  const sig = createHmac('sha256', LICENSE_SECRET)
    .update(payloadB64)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase()

  return `KPOS-${payloadB64}.${sig}`
}

// ─── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const getArg = (flag: string): string | undefined => {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : undefined
}

const tierArg = getArg('--tier') as Tier | undefined
const validTiers: Tier[] = ['starter', 'standard', 'pro', 'lifetime']

if (!tierArg || !validTiers.includes(tierArg)) {
  console.error(`\nError: --tier is required. Must be one of: ${validTiers.join(', ')}\n`)
  process.exit(1)
}

const months = getArg('--months') ? parseInt(getArg('--months')!, 10) : undefined
const registers = getArg('--registers') ? parseInt(getArg('--registers')!, 10) : undefined
const updateYears = getArg('--update-years') ? parseInt(getArg('--update-years')!, 10) : undefined

try {
  const key = generateKey({ tier: tierArg, months, registers, updateYears })
  const isLifetime = tierArg === 'lifetime'
  const displayRegisters = registers ?? DEFAULT_REGISTERS[tierArg]

  console.log('\n' + '═'.repeat(60))
  console.log('  KINETIX POS — License Key')
  console.log('═'.repeat(60))
  console.log(`  Tier:          ${tierArg.charAt(0).toUpperCase() + tierArg.slice(1)} (${TIER_PRICES[tierArg]})`)
  console.log(`  Expires:       ${isLifetime ? 'Never' : `${months} months from activation`}`)
  console.log(`  Updates until: ${updateYears ?? (isLifetime ? 2 : 1)} year(s) from generation`)
  console.log(`  Max registers: ${displayRegisters === 999 ? 'Unlimited' : displayRegisters}`)
  console.log('─'.repeat(60))
  console.log(`  KEY:`)
  console.log(`  ${key}`)
  console.log('═'.repeat(60) + '\n')
} catch (err) {
  console.error('\nError:', (err as Error).message + '\n')
  process.exit(1)
}
