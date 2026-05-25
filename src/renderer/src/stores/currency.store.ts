import { create } from 'zustand'
import {
  formatCurrency,
  convertAmount,
  DEFAULT_KYD_TO_USD,
  type CurrencyCode
} from '../lib/currency'

interface CurrencyState {
  currency: CurrencyCode
  kydToUsdRate: number
  setCurrency: (code: CurrencyCode) => void
  setKydToUsdRate: (rate: number) => void
  /** Format a USD amount, converting to active currency first. Use for cart/payment totals. */
  fmt: (usdAmount: number) => string
  /** Format a price already in the store currency — no conversion, just adds the symbol. Use for product prices. */
  fmtRaw: (amount: number) => string
  /** Format a USD amount in the alternate (non-active) currency. */
  fmtAlt: (usdAmount: number) => string
  /** Returns the currency code that is NOT active. */
  altCurrency: () => CurrencyCode
  /** Convert a USD amount to the active display currency (raw number). */
  toDisplay: (usdAmount: number) => number
  /** Convert a display-currency amount back to USD (raw number). */
  toUsd: (displayAmount: number) => number
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  currency: 'USD',
  kydToUsdRate: DEFAULT_KYD_TO_USD,

  setCurrency: (currency) => set({ currency }),
  setKydToUsdRate: (kydToUsdRate) => set({ kydToUsdRate }),

  fmt: (usdAmount) => {
    const { currency, kydToUsdRate } = get()
    const display = convertAmount(usdAmount, 'USD', currency, kydToUsdRate)
    return formatCurrency(display, currency)
  },

  fmtRaw: (amount) => {
    const { currency } = get()
    return formatCurrency(amount, currency)
  },

  fmtAlt: (usdAmount) => {
    const { currency, kydToUsdRate } = get()
    const alt: CurrencyCode = currency === 'USD' ? 'KYD' : 'USD'
    const display = convertAmount(usdAmount, 'USD', alt, kydToUsdRate)
    return formatCurrency(display, alt)
  },

  altCurrency: () => {
    const { currency } = get()
    return currency === 'USD' ? 'KYD' : 'USD'
  },

  toDisplay: (usdAmount) => {
    const { currency, kydToUsdRate } = get()
    return convertAmount(usdAmount, 'USD', currency, kydToUsdRate)
  },

  toUsd: (displayAmount) => {
    const { currency, kydToUsdRate } = get()
    return convertAmount(displayAmount, currency, 'USD', kydToUsdRate)
  },
}))
