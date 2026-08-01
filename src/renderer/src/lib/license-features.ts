/**
 * Feature flag map for the Kinetix POS license tiers.
 *
 * Each tier includes all features of the tiers below it.
 * The renderer uses this to decide whether to render a feature or an UpgradePrompt.
 */

export type LicenseTier = 'starter' | 'standard' | 'pro' | 'lifetime'

export type LicenseFeature =
  // Standard+
  | 'multi_register'       // More than 1 POS terminal
  | 'customers'            // Customer profiles & purchase history
  | 'loyalty'              // Loyalty points earning & redemption
  | 'inventory_tracking'   // Inventory management screen
  | 'low_stock_alerts'     // Low-stock badge in sidebar
  | 'email_receipts'       // Email receipt on checkout
  // Pro+
  | 'staff_management'     // Staff creation, roles, PIN management
  | 'shifts'               // Shift open/close & shift reports
  | 'full_reports'         // All reports (by product, staff, terminal, CSV export)
  | 'csv_export'           // CSV bulk export
  | 'discount_rules'       // Automatic promotions & coupon codes
  | 'gift_cards'           // Gift card issuance & redemption
  | 'vendors'              // Vendor/consignment management
  // Lifetime only
  | 'machine_transfer'     // Transfer license to a new machine once

// ─── Feature sets per tier ────────────────────────────────────────────────────

const STARTER_FEATURES: LicenseFeature[] = []

const STANDARD_FEATURES: LicenseFeature[] = [
  ...STARTER_FEATURES,
  'multi_register',
  'customers',
  'loyalty',
  'inventory_tracking',
  'low_stock_alerts',
  'email_receipts',
]

const PRO_FEATURES: LicenseFeature[] = [
  ...STANDARD_FEATURES,
  'staff_management',
  'shifts',
  'full_reports',
  'csv_export',
  'discount_rules',
  'gift_cards',
  'vendors',
]

const LIFETIME_FEATURES: LicenseFeature[] = [
  ...PRO_FEATURES,
  'machine_transfer',
]

export const TIER_FEATURES: Record<LicenseTier, LicenseFeature[]> = {
  starter:  STARTER_FEATURES,
  standard: STANDARD_FEATURES,
  pro:      PRO_FEATURES,
  lifetime: LIFETIME_FEATURES,
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

/** Minimum tier required to use a given feature. */
export const FEATURE_REQUIRED_TIER: Record<LicenseFeature, LicenseTier> = {
  multi_register:     'standard',
  customers:          'standard',
  loyalty:            'standard',
  inventory_tracking: 'standard',
  low_stock_alerts:   'standard',
  email_receipts:     'standard',
  staff_management:   'pro',
  shifts:             'pro',
  full_reports:       'pro',
  csv_export:         'pro',
  discount_rules:     'pro',
  gift_cards:         'pro',
  vendors:            'pro',
  machine_transfer:   'lifetime',
}

export const TIER_LABELS: Record<LicenseTier, string> = {
  starter:  'Starter',
  standard: 'Standard',
  pro:      'Pro',
  lifetime: 'Lifetime',
}

export const TIER_PRICES: Record<LicenseTier, string> = {
  starter:  '$49/mo',
  standard: '$89/mo',
  pro:      '$149/mo',
  lifetime: '$599 one-time',
}

export const TIER_ORDER: LicenseTier[] = ['starter', 'standard', 'pro', 'lifetime']

/** Returns true if `tier` is at least as high as `required`. */
export function tierAtLeast(tier: LicenseTier, required: LicenseTier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(required)
}
