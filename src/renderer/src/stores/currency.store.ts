import { create } from 'zustand'
import {
  formatCurrency,
  convertAmount,
  DEFAULT_KYD_TO_USD,
  type CurrencyCode
} from '../lib/currency'

interface CurrencyState {
  /** Primary display currency — prices are shown and entered in this currency. */
  currency: CurrencyCode
  /**
   * Secondary / alternate currency — shown alongside the primary as a
   * reference conversion. Empty string means no secondary is configured.
   */
  currency2: CurrencyCode
  /**
   * Exchange rate: 1 unit of `currency` (primary) = kydToUsdRate units of `currency2` (secondary).
   * Name kept as kydToUsdRate for backward compatibility with settings storage.
   */
  kydToUsdRate: number

  setCurrency: (code: CurrencyCode) => void
  setCurrency2: (code: CurrencyCode) => void
  setKydToUsdRate: (rate: number) => void

  /** Format an amount in the primary currency (no conversion — amount is already in primary). */
  fmt: (amount: number) => string
  /** Format a price already in the primary currency — alias of fmt. */
  fmtRaw: (amount: number) => string
  /** Format an amount in the secondary currency, converting from primary. */
  fmtAlt: (primaryAmount: number) => string
  /** Returns the secondary currency code, or empty string if none / same as primary. */
  altCurrency: () => CurrencyCode
  /** Convert a primary-currency amount to secondary (raw number). */
  toDisplay: (primaryAmount: number) => number
  /** Convert a secondary-currency amount back to primary (raw number). */
  toUsd: (secondaryAmount: number) => number
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  currency:     'USD',
  currency2:    'KYD',
  kydToUsdRate: DEFAULT_KYD_TO_USD,

  setCurrency:     (currency)     => set({ currency }),
  setCurrency2:    (currency2)    => set({ currency2 }),
  setKydToUsdRate: (kydToUsdRate) => set({ kydToUsdRate }),

  fmt: (amount) => {
    const { currency } = get()
    return formatCurrency(amount, currency)
  },

  fmtRaw: (amount) => {
    const { currency } = get()
    return formatCurrency(amount, currency)
  },

  fmtAlt: (primaryAmount) => {
    const { currency, currency2, kydToUsdRate } = get()
    if (!currency2 || currency2 === currency) return ''
    const converted = convertAmount(primaryAmount, currency, currency2, kydToUsdRate, currency)
    return formatCurrency(converted, currency2)
  },

  altCurrency: () => {
    const { currency, currency2 } = get()
    return currency2 && currency2 !== currency ? currency2 : ''
  },

  toDisplay: (primaryAmount) => {
    const { currency, currency2, kydToUsdRate } = get()
    if (!currency2 || currency2 === currency) return primaryAmount
    return convertAmount(primaryAmount, currency, currency2, kydToUsdRate, currency)
  },

  toUsd: (secondaryAmount) => {
    const { currency, currency2, kydToUsdRate } = get()
    if (!currency2 || currency2 === currency) return secondaryAmount
    return convertAmount(secondaryAmount, currency2, currency, kydToUsdRate, currency)
  },
}))
