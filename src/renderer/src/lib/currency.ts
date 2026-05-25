/** Supported currency codes */
export type CurrencyCode = 'USD' | 'KYD'

export interface CurrencyDef {
  code: CurrencyCode
  symbol: string
  name: string
}

/** Currency definitions */
export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar' },
  KYD: { code: 'KYD', symbol: 'CI$', name: 'Cayman Islands Dollar' }
}

/** Official Cayman Islands peg: 1 KYD = 1.20 USD (fixed since 1974) */
export const DEFAULT_KYD_TO_USD = 1.20

/** Round to 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Convert an amount between USD and KYD.
 * @param amount    Source amount
 * @param from      Source currency
 * @param to        Target currency
 * @param kydToUsd  Exchange rate (1 KYD = ? USD), defaults to the fixed peg
 */
export function convertAmount(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  kydToUsd: number = DEFAULT_KYD_TO_USD
): number {
  if (from === to) return amount
  if (from === 'KYD' && to === 'USD') return round2(amount * kydToUsd)
  if (from === 'USD' && to === 'KYD') return round2(amount / kydToUsd)
  return amount
}

/**
 * Format an amount as a currency string using the given currency's symbol.
 * @param amount        Numeric amount (already in the target currency)
 * @param currencyCode  Currency to format as
 */
export function formatCurrency(
  amount: number,
  currencyCode: CurrencyCode = 'USD'
): string {
  const cur = CURRENCIES[currencyCode]
  return `${cur.symbol}${amount.toFixed(2)}`
}
