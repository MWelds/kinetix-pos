/**
 * License store — single source of truth for license state in the renderer.
 *
 * Hydrated on app startup via LicenseHydrator in App.tsx.
 * Components access it via useLicenseStore() or the canUse() helper.
 */

import { create } from 'zustand'
import { api } from '../lib/api'
import type { LicenseTier, LicenseFeature } from '../lib/license-features'
import { TIER_FEATURES } from '../lib/license-features'

export interface LicenseState {
  /** Current effective tier (falls back to 'starter' when expired). */
  tier: LicenseTier
  expiresAt: string | null
  updatesUntil: string | null
  maxRegisters: number
  activatedAt: string | null
  isExpired: boolean
  isUpdatesExpired: boolean
  isTrialActive: boolean
  trialDaysLeft: number
  /** True when the current tier is usable (active trial or valid, non-expired license). */
  isValid: boolean
  /** False until the first load() completes — prevents flicker on mount. */
  isLoaded: boolean

  // ── Actions ──────────────────────────────────────────────────────────────────

  /** Fetch current license status from the main process. */
  load: () => Promise<void>

  /**
   * Returns true if the current tier (or active trial) includes the given feature.
   * During an active trial, ALL features are available.
   */
  canUse: (feature: LicenseFeature) => boolean

  /** Activate a new license key. Re-loads state on success. */
  activate: (key: string) => Promise<{ ok: boolean; error?: string }>

  /** Remove the current license and revert to trial/starter mode. */
  deactivate: () => Promise<void>
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  tier: 'starter',
  expiresAt: null,
  updatesUntil: null,
  maxRegisters: 1,
  activatedAt: null,
  isExpired: false,
  isUpdatesExpired: false,
  isTrialActive: false,
  trialDaysLeft: 0,
  isValid: false,
  isLoaded: false,

  load: async () => {
    try {
      const info = await api.license.getInfo() as LicenseState
      set({ ...info, isLoaded: true })
    } catch (err) {
      console.error('[license] Failed to load license info:', err)
      set({ isLoaded: true })
    }
  },

  canUse: (feature) => {
    const { tier, isValid, isTrialActive } = get()
    // During trial, everything is available
    if (isTrialActive) return true
    if (!isValid) return false
    return TIER_FEATURES[tier].includes(feature)
  },

  activate: async (key) => {
    const result = await api.license.activate(key) as { ok: boolean; error?: string }
    if (result.ok) {
      await get().load()
    }
    return result
  },

  deactivate: async () => {
    await api.license.deactivate()
    await get().load()
  },
}))
