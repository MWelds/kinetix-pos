/**
 * Customer-display data shapes shared between the main process
 * (display/customer-display.ts) and the renderer (App.tsx, CustomerDisplayScreen).
 * Lives in src/shared so both tsconfig projects can include it.
 */

export interface DisplayItem {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface DisplayData {
  state: 'idle' | 'shopping' | 'payment_processing' | 'complete'
  storeName?: string
  items?: DisplayItem[]
  subtotal?: number
  discountAmount?: number
  tax?: number
  total?: number
  currency?: string
  symbol?: string
  /** Equivalent total in the other currency (shown when KYD is active) */
  altTotal?: number
  altCurrency?: string
  altSymbol?: string
  customer?: string
  change?: number
  changeCurrency?: string
  changeSymbol?: string
  loyaltyEarned?: number
  /** Display appearance settings — pushed once on open */
  displayBgColor?: string
  displayBgImage?: string
  /** Receipt HTML from the just-completed order — used by display for email-to-customer */
  completedReceiptHtml?: string
  /** Order number of the just-completed order */
  orderNumber?: string
  /** Store logo as base64 data URL — attached automatically by pushData when a logo is cached */
  logoBase64?: string
}
