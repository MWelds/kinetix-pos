/** Currency code — any ISO 4217 string the app supports */
export type CurrencyCode = string

export interface CurrencyDef {
  code: string
  symbol: string
  name: string
  /** ISO 3166-1 alpha-2 region hint, used for grouping */
  region: string
}

/**
 * Supported currency definitions.
 * Covers the most widely used currencies across all world regions.
 * Rate data is entered by the user — we only store the symbol and display name here.
 */
export const CURRENCIES: Record<string, CurrencyDef> = {
  // ── Americas ─────────────────────────────────────────────────────────────
  USD: { code: 'USD', symbol: '$',    name: 'US Dollar',                 region: 'Americas' },
  CAD: { code: 'CAD', symbol: 'CA$',  name: 'Canadian Dollar',           region: 'Americas' },
  MXN: { code: 'MXN', symbol: 'MX$',  name: 'Mexican Peso',              region: 'Americas' },
  BRL: { code: 'BRL', symbol: 'R$',   name: 'Brazilian Real',            region: 'Americas' },
  ARS: { code: 'ARS', symbol: '$',    name: 'Argentine Peso',            region: 'Americas' },
  CLP: { code: 'CLP', symbol: 'CL$',  name: 'Chilean Peso',              region: 'Americas' },
  COP: { code: 'COP', symbol: 'CO$',  name: 'Colombian Peso',            region: 'Americas' },
  PEN: { code: 'PEN', symbol: 'S/',   name: 'Peruvian Sol',              region: 'Americas' },
  JMD: { code: 'JMD', symbol: 'J$',   name: 'Jamaican Dollar',           region: 'Americas' },
  TTD: { code: 'TTD', symbol: 'TT$',  name: 'Trinidad & Tobago Dollar',  region: 'Americas' },
  BBD: { code: 'BBD', symbol: 'Bds$', name: 'Barbadian Dollar',          region: 'Americas' },
  KYD: { code: 'KYD', symbol: 'CI$',  name: 'Cayman Islands Dollar',     region: 'Americas' },
  XCD: { code: 'XCD', symbol: 'EC$',  name: 'Eastern Caribbean Dollar',  region: 'Americas' },
  HTG: { code: 'HTG', symbol: 'G',    name: 'Haitian Gourde',            region: 'Americas' },
  BSD: { code: 'BSD', symbol: 'B$',   name: 'Bahamian Dollar',           region: 'Americas' },
  BMD: { code: 'BMD', symbol: 'BD$',  name: 'Bermudian Dollar',          region: 'Americas' },
  // ── Europe ───────────────────────────────────────────────────────────────
  EUR: { code: 'EUR', symbol: '€',    name: 'Euro',                      region: 'Europe' },
  GBP: { code: 'GBP', symbol: '£',    name: 'British Pound',             region: 'Europe' },
  CHF: { code: 'CHF', symbol: 'Fr',   name: 'Swiss Franc',               region: 'Europe' },
  NOK: { code: 'NOK', symbol: 'kr',   name: 'Norwegian Krone',           region: 'Europe' },
  SEK: { code: 'SEK', symbol: 'kr',   name: 'Swedish Krona',             region: 'Europe' },
  DKK: { code: 'DKK', symbol: 'kr',   name: 'Danish Krone',              region: 'Europe' },
  PLN: { code: 'PLN', symbol: 'zł',   name: 'Polish Złoty',              region: 'Europe' },
  CZK: { code: 'CZK', symbol: 'Kč',   name: 'Czech Koruna',              region: 'Europe' },
  HUF: { code: 'HUF', symbol: 'Ft',   name: 'Hungarian Forint',          region: 'Europe' },
  RON: { code: 'RON', symbol: 'lei',  name: 'Romanian Leu',              region: 'Europe' },
  BGN: { code: 'BGN', symbol: 'лв',   name: 'Bulgarian Lev',             region: 'Europe' },
  RUB: { code: 'RUB', symbol: '₽',    name: 'Russian Ruble',             region: 'Europe' },
  // ── Middle East & Africa ─────────────────────────────────────────────────
  AED: { code: 'AED', symbol: 'د.إ',  name: 'UAE Dirham',                region: 'Middle East' },
  SAR: { code: 'SAR', symbol: '﷼',    name: 'Saudi Riyal',               region: 'Middle East' },
  QAR: { code: 'QAR', symbol: '﷼',    name: 'Qatari Riyal',              region: 'Middle East' },
  KWD: { code: 'KWD', symbol: 'KD',   name: 'Kuwaiti Dinar',             region: 'Middle East' },
  BHD: { code: 'BHD', symbol: '.د.ب', name: 'Bahraini Dinar',            region: 'Middle East' },
  OMR: { code: 'OMR', symbol: '﷼',    name: 'Omani Rial',                region: 'Middle East' },
  JOD: { code: 'JOD', symbol: 'JD',   name: 'Jordanian Dinar',           region: 'Middle East' },
  ILS: { code: 'ILS', symbol: '₪',    name: 'Israeli New Shekel',        region: 'Middle East' },
  TRY: { code: 'TRY', symbol: '₺',    name: 'Turkish Lira',              region: 'Middle East' },
  ZAR: { code: 'ZAR', symbol: 'R',    name: 'South African Rand',        region: 'Africa' },
  NGN: { code: 'NGN', symbol: '₦',    name: 'Nigerian Naira',            region: 'Africa' },
  KES: { code: 'KES', symbol: 'KSh',  name: 'Kenyan Shilling',           region: 'Africa' },
  GHS: { code: 'GHS', symbol: 'GH₵',  name: 'Ghanaian Cedi',             region: 'Africa' },
  EGP: { code: 'EGP', symbol: '£',    name: 'Egyptian Pound',            region: 'Africa' },
  // ── Asia-Pacific ─────────────────────────────────────────────────────────
  JPY: { code: 'JPY', symbol: '¥',    name: 'Japanese Yen',              region: 'Asia-Pacific' },
  CNY: { code: 'CNY', symbol: '¥',    name: 'Chinese Yuan',              region: 'Asia-Pacific' },
  HKD: { code: 'HKD', symbol: 'HK$',  name: 'Hong Kong Dollar',          region: 'Asia-Pacific' },
  SGD: { code: 'SGD', symbol: 'S$',   name: 'Singapore Dollar',          region: 'Asia-Pacific' },
  AUD: { code: 'AUD', symbol: 'A$',   name: 'Australian Dollar',         region: 'Asia-Pacific' },
  NZD: { code: 'NZD', symbol: 'NZ$',  name: 'New Zealand Dollar',        region: 'Asia-Pacific' },
  INR: { code: 'INR', symbol: '₹',    name: 'Indian Rupee',              region: 'Asia-Pacific' },
  PKR: { code: 'PKR', symbol: '₨',    name: 'Pakistani Rupee',           region: 'Asia-Pacific' },
  BDT: { code: 'BDT', symbol: '৳',    name: 'Bangladeshi Taka',          region: 'Asia-Pacific' },
  LKR: { code: 'LKR', symbol: '₨',    name: 'Sri Lankan Rupee',          region: 'Asia-Pacific' },
  MYR: { code: 'MYR', symbol: 'RM',   name: 'Malaysian Ringgit',         region: 'Asia-Pacific' },
  THB: { code: 'THB', symbol: '฿',    name: 'Thai Baht',                 region: 'Asia-Pacific' },
  IDR: { code: 'IDR', symbol: 'Rp',   name: 'Indonesian Rupiah',         region: 'Asia-Pacific' },
  PHP: { code: 'PHP', symbol: '₱',    name: 'Philippine Peso',           region: 'Asia-Pacific' },
  VND: { code: 'VND', symbol: '₫',    name: 'Vietnamese Dong',           region: 'Asia-Pacific' },
  KRW: { code: 'KRW', symbol: '₩',    name: 'South Korean Won',          region: 'Asia-Pacific' },
  TWD: { code: 'TWD', symbol: 'NT$',  name: 'New Taiwan Dollar',         region: 'Asia-Pacific' },
}

/** Currencies grouped by region, in display order. */
export const CURRENCY_REGIONS: Record<string, string[]> = {
  Americas:       ['USD','CAD','MXN','BRL','ARS','CLP','COP','PEN','JMD','TTD','BBD','KYD','XCD','HTG','BSD','BMD'],
  Europe:         ['EUR','GBP','CHF','NOK','SEK','DKK','PLN','CZK','HUF','RON','BGN','RUB'],
  'Middle East':  ['AED','SAR','QAR','KWD','BHD','OMR','JOD','ILS','TRY'],
  Africa:         ['ZAR','NGN','KES','GHS','EGP'],
  'Asia-Pacific': ['JPY','CNY','HKD','SGD','AUD','NZD','INR','PKR','BDT','LKR','MYR','THB','IDR','PHP','VND','KRW','TWD'],
}

/** Official Cayman Islands peg: 1 KYD = 1.20 USD (fixed since 1974) — kept for backward compat */
export const DEFAULT_KYD_TO_USD = 1.20

/** Default exchange rate between two currencies when no user rate is set. */
export const DEFAULT_EXCHANGE_RATE = 1.0

/** Round to 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Convert an amount between two currencies using a provided exchange rate.
 *
 * @param amount        Source amount
 * @param from          Source currency code
 * @param to            Target currency code
 * @param rateOneToTwo  Exchange rate: how many `to` units equal 1 `from` unit
 *                      (i.e. 1 primary = X secondary). Pass the inverse when
 *                      converting in the opposite direction.
 * @param primaryCode   Which currency the rate is expressed in terms of.
 *                      Defaults to 'KYD' for backward compatibility.
 *                      When from === primaryCode the rate is applied as-is;
 *                      when from is the secondary the rate is inverted.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rateOneToTwo: number = DEFAULT_KYD_TO_USD,
  primaryCode: string = 'KYD'
): number {
  if (from === to) return amount
  // primary → secondary: multiply
  if (from === primaryCode) return round2(amount * rateOneToTwo)
  // secondary → primary: divide
  return round2(amount / rateOneToTwo)
}

/**
 * Format an amount as a currency string using the given currency's symbol.
 * Falls back to the ISO code as the symbol if the currency is not in CURRENCIES.
 *
 * @param amount        Numeric amount
 * @param currencyCode  Currency to format as (ISO 4217)
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = 'USD'
): string {
  const cur = CURRENCIES[currencyCode]
  const symbol = cur?.symbol ?? currencyCode
  return `${symbol}${Math.abs(amount).toFixed(2)}`
}
