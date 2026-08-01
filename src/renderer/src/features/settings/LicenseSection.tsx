/**
 * LicenseSection — license management UI embedded in the Settings screen.
 *
 * Shows current tier, expiry, and a key-entry form for activation/deactivation.
 */

import React, { useState } from 'react'
import {
  CheckCircle, AlertCircle, Clock, Key, ShieldCheck,
  Zap, Star, Infinity, RefreshCw, XCircle
} from 'lucide-react'
import { useLicenseStore } from '../../stores/license.store'
import type { LicenseTier } from '../../lib/license-features'
import { TIER_LABELS, TIER_PRICES } from '../../lib/license-features'

// ─── Tier badge config ────────────────────────────────────────────────────────

const TIER_CONFIG: Record<LicenseTier, {
  icon: React.ReactNode
  color: string
  bg: string
  border: string
}> = {
  starter: {
    icon: <Zap size={18} />,
    color: 'text-gray-600',
    bg: 'bg-gray-50',
    border: 'border-gray-200',
  },
  standard: {
    icon: <Star size={18} />,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  pro: {
    icon: <ShieldCheck size={18} />,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
  },
  lifetime: {
    icon: <Infinity size={18} />,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LicenseSection() {
  const {
    tier, expiresAt, updatesUntil, maxRegisters, activatedAt,
    isExpired, isUpdatesExpired, isTrialActive, trialDaysLeft,
    isValid, isLoaded, activate, deactivate, load,
  } = useLicenseStore()

  const [keyInput, setKeyInput] = useState('')
  const [activating, setActivating] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const cfg = TIER_CONFIG[tier]
  const hasLicense = !!activatedAt

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault()
    if (!keyInput.trim()) return
    setError(null)
    setSuccess(null)
    setActivating(true)
    try {
      const result = await activate(keyInput.trim())
      if (result.ok) {
        setSuccess('License activated successfully.')
        setKeyInput('')
      } else {
        setError(result.error ?? 'Activation failed.')
      }
    } finally {
      setActivating(false)
    }
  }

  async function handleDeactivate() {
    if (!window.confirm('Remove this license? The app will revert to trial or Starter mode.')) return
    setDeactivating(true)
    setError(null)
    setSuccess(null)
    try {
      await deactivate()
      setSuccess('License removed.')
    } finally {
      setDeactivating(false)
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
        <RefreshCw size={14} className="animate-spin" />
        Loading license info…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Current status card ─────────────────────────────────────────────── */}
      <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-5 space-y-4`}>
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 font-semibold ${cfg.color}`}>
            {cfg.icon}
            <span>{TIER_LABELS[tier]} Plan</span>
            {tier !== 'starter' && (
              <span className="text-xs font-normal text-gray-500">
                — {TIER_PRICES[tier]}
              </span>
            )}
          </div>

          {/* Status pill */}
          {isTrialActive && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-3 py-0.5">
              <Clock size={11} />
              Trial — {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left
            </span>
          )}
          {!isTrialActive && isValid && !isExpired && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 border border-green-200 rounded-full px-3 py-0.5">
              <CheckCircle size={11} />
              Active
            </span>
          )}
          {isExpired && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 border border-red-200 rounded-full px-3 py-0.5">
              <AlertCircle size={11} />
              Expired
            </span>
          )}
          {!isTrialActive && !hasLicense && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-3 py-0.5">
              <AlertCircle size={11} />
              Trial ended
            </span>
          )}
        </div>

        {/* Detail grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {hasLicense && (
            <>
              <div className="text-gray-500">Activated</div>
              <div className="font-medium text-gray-800">{formatDate(activatedAt)}</div>

              <div className="text-gray-500">Expires</div>
              <div className={`font-medium ${isExpired ? 'text-red-600' : 'text-gray-800'}`}>
                {expiresAt ? formatDate(expiresAt) : 'Never'}
              </div>

              <div className="text-gray-500">Updates until</div>
              <div className={`font-medium ${isUpdatesExpired ? 'text-amber-600' : 'text-gray-800'}`}>
                {updatesUntil ? formatDate(updatesUntil) : 'Never'}
                {isUpdatesExpired && (
                  <span className="ml-2 text-xs text-amber-600">(renewal available)</span>
                )}
              </div>

              <div className="text-gray-500">Max registers</div>
              <div className="font-medium text-gray-800">
                {maxRegisters >= 999 ? 'Unlimited' : maxRegisters}
              </div>
            </>
          )}

          {isTrialActive && (
            <>
              <div className="text-gray-500">Trial ends in</div>
              <div className="font-medium text-amber-700">{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}</div>
              <div className="text-gray-500">Access</div>
              <div className="font-medium text-gray-800">All Pro features</div>
            </>
          )}

          {!isTrialActive && !hasLicense && (
            <div className="col-span-2 text-sm text-gray-500">
              Your 30-day trial has ended. Activate a license key to continue using all features,
              or contact us for a new subscription.
            </div>
          )}
        </div>

        {/* Deactivate button */}
        {hasLicense && (
          <button
            onClick={handleDeactivate}
            disabled={deactivating}
            className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 disabled:opacity-50 mt-1"
          >
            <XCircle size={13} />
            {deactivating ? 'Removing…' : 'Remove license'}
          </button>
        )}
      </div>

      {/* ── Activation form ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Key size={14} />
          {hasLicense ? 'Replace License Key' : 'Activate License Key'}
        </h3>

        <form onSubmit={handleActivate} className="space-y-3">
          <input
            type="text"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); setError(null); setSuccess(null) }}
            placeholder="KPOS-XXXXXXXXXXXX.XXXXXXXXXXXXXXXX"
            className="w-full font-mono text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-300"
            spellCheck={false}
            autoComplete="off"
          />

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle size={14} />
              <span>{success}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={activating || !keyInput.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {activating ? 'Activating…' : 'Activate'}
            </button>
            <button
              type="button"
              onClick={() => { load(); setSuccess('Refreshed.') }}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              <RefreshCw size={11} />
              Refresh status
            </button>
          </div>
        </form>

        <p className="text-xs text-gray-400">
          License keys start with <span className="font-mono">KPOS-</span> and are provided
          when you subscribe. Contact us at{' '}
          <a
            href="mailto:mavwelds@gmail.com"
            className="text-blue-500 hover:underline"
          >
            mavwelds@gmail.com
          </a>{' '}
          to purchase or renew.
        </p>
      </div>
    </div>
  )
}
