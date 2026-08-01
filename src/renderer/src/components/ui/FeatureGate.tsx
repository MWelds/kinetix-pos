/**
 * FeatureGate — wraps any feature and renders an upgrade prompt when the
 * current license tier doesn't include it. Children render normally when allowed.
 *
 * Usage:
 *   <FeatureGate feature="full_reports">
 *     <ReportsScreen />
 *   </FeatureGate>
 *
 *   <FeatureGate feature="loyalty" variant="inline">
 *     <LoyaltySection />
 *   </FeatureGate>
 */

import React from 'react'
import { Lock, ArrowUpCircle } from 'lucide-react'
import { useLicenseStore } from '../../stores/license.store'
import type { LicenseFeature } from '../../lib/license-features'
import { FEATURE_REQUIRED_TIER, TIER_LABELS, TIER_PRICES } from '../../lib/license-features'

interface FeatureGateProps {
  feature: LicenseFeature
  /** Custom description shown in the prompt. */
  message?: string
  /**
   * 'overlay' (default) — renders children blurred behind the prompt.
   * 'inline'            — renders a compact banner replacing children.
   * 'hide'              — renders nothing when locked.
   */
  variant?: 'overlay' | 'inline' | 'hide'
  children: React.ReactNode
}

export function FeatureGate({
  feature,
  message,
  variant = 'overlay',
  children,
}: FeatureGateProps) {
  const canUse = useLicenseStore((s) => s.canUse)

  if (canUse(feature)) return <>{children}</>

  const requiredTier = FEATURE_REQUIRED_TIER[feature]
  const tierLabel = TIER_LABELS[requiredTier]
  const price = TIER_PRICES[requiredTier]
  const desc = message ?? `This feature is available on the ${tierLabel} plan and above.`

  if (variant === 'hide') return null

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <Lock size={12} className="flex-shrink-0" />
        <span className="flex-1">{desc}</span>
        <span className="font-semibold whitespace-nowrap">{price}</span>
      </div>
    )
  }

  // Default: 'overlay'
  return (
    <div className="relative h-full w-full min-h-[200px] overflow-hidden rounded-lg">
      {/* Blurred preview of locked content */}
      <div className="pointer-events-none select-none blur-sm opacity-30 h-full">
        {children}
      </div>

      {/* Upgrade overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-blue-100">
          <Lock size={24} className="text-blue-600" />
        </div>

        <div className="text-center max-w-sm">
          <p className="font-semibold text-gray-900 text-base">
            {tierLabel} Plan Required
          </p>
          <p className="text-gray-500 text-sm mt-1">{desc}</p>
        </div>

        <div className="flex flex-col items-center gap-1 bg-blue-50 rounded-xl px-8 py-4 border border-blue-100">
          <span className="text-2xl font-bold text-blue-600">{price}</span>
          <span className="text-xs text-blue-400">per license</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
          <ArrowUpCircle size={16} />
          <span>Go to Settings → License to activate</span>
        </div>
      </div>
    </div>
  )
}
