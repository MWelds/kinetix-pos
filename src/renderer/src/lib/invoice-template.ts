/**
 * Shared A4 invoice HTML builder.
 *
 * Single source of truth for invoice rendering — used by the Orders screen
 * (reprint), the Payment modal (print/email after sale), the POS screen
 * (unpaid/layaway invoices) and the Settings live preview. All appearance
 * options come from the `invoice*` keys in settings.
 *
 * Supported settings keys (all optional, sensible defaults):
 *   invoiceTemplate          'classic' | 'modern' | 'compact'
 *   invoiceTitleLabel        e.g. 'INVOICE', 'RECEIPT', 'TAX INVOICE'
 *   invoiceNumberPrefix      prepended to the order number, e.g. 'INV-'
 *   invoiceFontSize          'small' | 'normal' | 'large'
 *   invoiceMargin            'narrow' | 'normal' | 'wide'
 *   invoiceLogoSize          'small' | 'medium' | 'large'
 *   invoiceShowLogo          'true' | 'false'
 *   invoicePrimaryColor      hex color for headings/accents
 *   invoiceAccentColor       hex color for discounts/positive amounts
 *   invoiceHeaderMessage     tagline under the store name
 *   invoiceFooterText        footer / payment terms
 *   invoiceShowTaxLine       'true' | 'false'
 *   invoiceShowDiscountLine  'true' | 'false'
 *   invoiceShowSku           'true' | 'false' — SKU column in the items table
 *   invoiceShowCustomer      'true' | 'false' — Bill To section
 *   invoiceShowPayments      'true' | 'false' — payment details section
 *   invoiceShowPaidStamp     'true' | 'false' — PAID / UNPAID stamp
 *   invoiceShowSignatureLine 'true' | 'false' — signature + date lines
 *   invoiceWatermarkText     large diagonal watermark text ('' = none)
 *   invoiceDueDays           days until payment due ('' = hide due date)
 *   invoiceCustomField1..3   extra footer lines (bank details, policy, website)
 */

export interface InvoiceItem {
  name: string
  variantName?: string
  sku?: string
  quantity: number
  unitPrice: number
  discountAmount: number
}

export interface InvoicePayment {
  method: string
  amount: number
  changeGiven?: number
}

export interface InvoiceData {
  orderNumber: string
  date: Date
  isPaid: boolean
  customerName?: string
  items: InvoiceItem[]
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  payments: InvoicePayment[]
  notes?: string
}

export interface InvoiceBrand {
  storeName: string
  storeAddress: string
  storePhone: string
  logoBase64: string
  currencySymbol: string
}

type SettingsMap = Record<string, string | undefined>

function esc(s: string | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Escape + preserve line breaks typed in multi-line settings (footer, notes). */
function escMultiline(s: string | undefined): string {
  return esc(s).replace(/\r\n|\r|\n/g, '<br>')
}

const FONT_SIZES: Record<string, string> = { small: '11px', normal: '13px', large: '15px' }
const MARGINS: Record<string, string> = { narrow: '16px 20px', normal: '32px 40px', wide: '56px 64px' }
const LOGO_HEIGHTS: Record<string, number> = { small: 40, medium: 60, large: 90 }

function bool(s: SettingsMap, key: string, def: boolean): boolean {
  const v = s[key]
  if (v == null || v === '') return def
  return v === 'true'
}

export function buildInvoiceHtml(data: InvoiceData, brand: InvoiceBrand, s: SettingsMap): string {
  const template = s.invoiceTemplate === 'modern' || s.invoiceTemplate === 'compact' ? s.invoiceTemplate : 'classic'
  const compact = template === 'compact'

  const titleLabel = (s.invoiceTitleLabel ?? '').trim() || 'INVOICE'
  const numberPrefix = s.invoiceNumberPrefix ?? ''
  const fontSize = FONT_SIZES[s.invoiceFontSize ?? 'normal'] ?? FONT_SIZES.normal
  const margin = MARGINS[s.invoiceMargin ?? 'normal'] ?? MARGINS.normal
  const logoHeight = LOGO_HEIGHTS[s.invoiceLogoSize ?? 'medium'] ?? LOGO_HEIGHTS.medium

  const showLogo = bool(s, 'invoiceShowLogo', true)
  const primary = s.invoicePrimaryColor || '#1e293b'
  const accent = s.invoiceAccentColor || '#10b981'
  const headerMessage = s.invoiceHeaderMessage ?? ''
  const footerText = s.invoiceFooterText ?? 'Payment due on receipt. Thank you!'
  const showTaxLine = bool(s, 'invoiceShowTaxLine', true)
  const showDiscountLine = bool(s, 'invoiceShowDiscountLine', true)
  const showSku = bool(s, 'invoiceShowSku', false)
  const showCustomer = bool(s, 'invoiceShowCustomer', true)
  const showPayments = bool(s, 'invoiceShowPayments', true)
  const showStamp = bool(s, 'invoiceShowPaidStamp', true)
  const showSignature = bool(s, 'invoiceShowSignatureLine', false)
  const watermark = (s.invoiceWatermarkText ?? '').trim()
  const dueDays = parseInt(s.invoiceDueDays ?? '', 10)
  const customLines = [s.invoiceCustomField1, s.invoiceCustomField2, s.invoiceCustomField3]
    .map((f) => (f ?? '').trim())
    .filter(Boolean)

  const sym = brand.currencySymbol
  const fmt = (n: number) => `${sym}${Math.abs(n).toFixed(2)}`
  const hasDiscountCol = showDiscountLine && data.discountAmount > 0

  const dueDate = !data.isPaid && !isNaN(dueDays) && dueDays >= 0
    ? new Date(data.date.getTime() + dueDays * 86400000)
    : null

  // ── Shared fragments ───────────────────────────────────────────────────────
  const logoHtml = showLogo && brand.logoBase64
    ? `<img src="${brand.logoBase64}" alt="Logo" style="max-height:${logoHeight}px;max-width:${Math.round(logoHeight * 3.4)}px;object-fit:contain;display:block;margin-bottom:8px"/>`
    : ''

  const stampHtml = showStamp
    ? `<div class="stamp ${data.isPaid ? 'paid' : 'unpaid'}">${data.isPaid ? 'PAID' : 'UNPAID'}</div>`
    : ''

  const watermarkHtml = watermark
    ? `<div class="watermark">${esc(watermark)}</div>`
    : ''

  const customerHtml = showCustomer && data.customerName
    ? `<div class="billto"><div class="billto-label">Bill To</div><strong>${esc(data.customerName)}</strong></div>`
    : ''

  const skuTh = showSku ? `<th>SKU</th>` : ''
  const discTh = hasDiscountCol ? `<th class="r">Discount</th>` : ''
  const itemRows = data.items.map((i) => `
    <tr>
      <td>${esc(i.name)}${i.variantName ? ` (${esc(i.variantName)})` : ''}</td>
      ${showSku ? `<td class="muted">${esc(i.sku ?? '')}</td>` : ''}
      <td class="c">${i.quantity}</td>
      <td class="r">${fmt(i.unitPrice)}</td>
      ${hasDiscountCol ? `<td class="r">${i.discountAmount > 0 ? `-${fmt(i.discountAmount)}` : '&mdash;'}</td>` : ''}
      <td class="r b">${fmt((i.unitPrice - i.discountAmount) * i.quantity)}</td>
    </tr>`).join('')

  const totalsHtml = `
    <div class="totals">
      ${data.taxAmount > 0 && showTaxLine ? `<div class="trow"><span>Subtotal</span><span>${fmt(data.subtotal)}</span></div>` : ''}
      ${showDiscountLine && data.discountAmount > 0 ? `<div class="trow" style="color:${accent}"><span>Discount</span><span>-${fmt(data.discountAmount)}</span></div>` : ''}
      ${showTaxLine && data.taxAmount > 0 ? `<div class="trow"><span>Tax</span><span>${fmt(data.taxAmount)}</span></div>` : ''}
      <div class="ttotal"><span>${data.isPaid ? 'Total' : 'Amount Due'}</span><span>${fmt(data.total)}</span></div>
    </div>`

  const payRows = data.payments.map((p) => {
    const change = (p.changeGiven ?? 0) > 0.005
      ? `<div class="prow" style="color:${accent};font-size:0.92em"><span style="padding-left:12px">&#8627; Change given</span><span>${fmt(p.changeGiven!)}</span></div>`
      : ''
    return `<div class="prow"><span class="cap">${esc(p.method.replace(/_/g, ' '))}</span><span>${fmt(p.amount)}</span></div>${change}`
  }).join('')
  const paymentsHtml = showPayments && data.payments.length > 0
    ? `<div class="payments"><h3>Payment Details</h3>${payRows}</div>`
    : ''

  const notesHtml = data.notes
    ? `<p class="notes"><strong>Notes:</strong> ${escMultiline(data.notes)}</p>`
    : ''

  const signatureHtml = showSignature
    ? `<div class="signature"><div class="sig-block"><div class="sig-line"></div>Authorized Signature</div><div class="sig-block"><div class="sig-line"></div>Date</div></div>`
    : ''

  const footerHtml = footerText || customLines.length
    ? `<div class="footer">${escMultiline(footerText)}${customLines.map((f) => `<div style="margin-top:4px">${esc(f)}</div>`).join('')}</div>`
    : ''

  const metaHtml = `
    <p><strong>${esc(numberPrefix)}#${esc(data.orderNumber)}</strong></p>
    <p>Date: <strong>${data.date.toLocaleDateString()}</strong></p>
    ${compact ? '' : `<p>Time: <strong>${data.date.toLocaleTimeString()}</strong></p>`}
    ${dueDate ? `<p>Due: <strong>${dueDate.toLocaleDateString()}</strong></p>` : ''}
    ${stampHtml}`

  // ── Template-specific CSS ────────────────────────────────────────────────────
  const baseCss = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:${fontSize};color:#1e293b;background:#fff;padding:${margin}}
  .page{max-width:750px;margin:0 auto;position:relative}
  .c{text-align:center}.r{text-align:right}.b{font-weight:600}.cap{text-transform:capitalize}.muted{color:#64748b}
  .watermark{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font-size:90px;font-weight:900;color:${primary};opacity:0.06;letter-spacing:6px;white-space:nowrap;pointer-events:none;z-index:0}
  .stamp{display:inline-block;font-weight:900;letter-spacing:2px;padding:4px 16px;border-radius:4px;transform:rotate(-8deg);margin-top:8px;opacity:0.85;border:3px solid}
  .stamp.paid{border-color:#10b981;color:#10b981}
  .stamp.unpaid{border-color:#ef4444;color:#ef4444}
  .billto{background:#f8fafc;border-radius:8px;padding:12px 16px;margin-bottom:16px}
  .billto-label{font-weight:600;color:#64748b;font-size:0.8em;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
  .totals{margin-left:auto;width:260px}
  .trow{display:flex;justify-content:space-between;padding:5px 0;color:#475569;border-bottom:1px solid #f1f5f9}
  .ttotal{display:flex;justify-content:space-between;font-size:1.25em;font-weight:800;color:${primary};border-top:2px solid ${primary};padding-top:10px;margin-top:4px}
  .payments{margin-top:24px;background:#f8fafc;border-radius:8px;padding:14px 18px}
  .payments h3{font-size:0.85em;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:8px}
  .prow{display:flex;justify-content:space-between;color:#475569;padding:3px 0}
  .notes{margin-top:20px;font-size:0.95em;color:#64748b}
  .signature{display:flex;gap:48px;margin-top:56px}
  .sig-block{flex:1;font-size:0.85em;color:#64748b;text-align:center}
  .sig-line{border-bottom:1px solid #94a3b8;margin-bottom:6px;height:28px}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;font-size:0.9em;color:#94a3b8}
  @media print{body{padding:20px} @page{margin:1cm}}`

  const classicCss = `
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #e2e8f0}
  .store h1{font-size:1.7em;font-weight:800;margin-bottom:4px}
  .store p{color:#64748b;line-height:1.6;font-size:0.95em}
  .tagline{font-style:italic;color:#64748b;font-size:0.95em;margin-top:2px}
  .meta{text-align:right}
  .meta p{color:#64748b;margin-top:4px;font-size:0.95em}
  .title{font-size:2.1em;font-weight:900;color:${primary};letter-spacing:-1px}
  table{width:100%;border-collapse:collapse;margin:20px 0}
  thead tr{background:#f8fafc;border-bottom:2px solid #e2e8f0}
  th{padding:10px 12px;text-align:left;font-size:0.85em;text-transform:uppercase;color:#64748b;letter-spacing:0.5px}
  th.r{text-align:right}
  td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}`

  const modernCss = `
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px}
  .store h1{font-size:1.4em;font-weight:800}
  .store p{color:#64748b;font-size:0.95em;margin-top:2px}
  .tagline{font-style:italic;color:#64748b;font-size:0.95em;margin-top:2px}
  .meta{text-align:right}
  .meta p{color:#64748b;margin-top:4px;font-size:0.95em}
  .title{font-size:1.9em;font-weight:800;color:${primary};letter-spacing:-0.5px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  thead tr{background:${primary};color:#fff}
  th{padding:9px 12px;text-align:left;font-weight:600;font-size:0.9em}
  th.r{text-align:right}
  td{padding:8px 12px;vertical-align:top}
  tbody tr:nth-child(even){background:#f8fafc}`

  const compactCss = `
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0}
  .store h1{font-size:1.25em;font-weight:800}
  .store p{color:#64748b;font-size:0.9em;line-height:1.4}
  .tagline{font-style:italic;color:#64748b;font-size:0.9em}
  .meta{text-align:right}
  .meta p{color:#64748b;margin-top:2px;font-size:0.9em}
  .title{font-size:1.5em;font-weight:900;color:${primary}}
  table{width:100%;border-collapse:collapse;margin:12px 0}
  thead tr{border-bottom:2px solid ${primary}}
  th{padding:6px 8px;text-align:left;font-size:0.8em;text-transform:uppercase;color:#64748b}
  th.r{text-align:right}
  td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  .billto{padding:8px 12px;margin-bottom:10px}
  .payments{margin-top:14px;padding:10px 14px}
  .footer{margin-top:24px;padding-top:10px}
  .signature{margin-top:36px}`

  const templateCss = template === 'modern' ? modernCss : compact ? compactCss : classicCss

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(titleLabel)} ${esc(numberPrefix)}#${esc(data.orderNumber)}</title>
<style>${baseCss}${templateCss}</style>
</head><body>
${watermarkHtml}
<div class="page">
  <div class="header">
    <div class="store">
      ${logoHtml}
      <h1>${esc(brand.storeName)}</h1>
      ${headerMessage ? `<div class="tagline">${escMultiline(headerMessage)}</div>` : ''}
      <p>${brand.storeAddress ? esc(brand.storeAddress) + '<br>' : ''}${esc(brand.storePhone)}</p>
    </div>
    <div class="meta">
      <div class="title">${esc(titleLabel)}</div>
      ${metaHtml}
    </div>
  </div>
  ${customerHtml}
  <table>
    <thead><tr><th>Description</th>${skuTh}<th class="c" style="text-align:center">Qty</th><th class="r">Unit Price</th>${discTh}<th class="r">Amount</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  ${totalsHtml}
  ${paymentsHtml}
  ${notesHtml}
  ${signatureHtml}
  ${footerHtml}
</div>
</body></html>`
}

/** Sample data used by the Settings live preview. */
export function sampleInvoiceData(): InvoiceData {
  return {
    orderNumber: '1042',
    date: new Date(),
    isPaid: true,
    customerName: 'John Smith',
    items: [
      { name: 'Product A', sku: 'SKU-A', quantity: 2, unitPrice: 6, discountAmount: 0 },
      { name: 'Product B', sku: 'SKU-B', quantity: 1, unitPrice: 8.5, discountAmount: 1 },
      { name: 'Product C', sku: 'SKU-C', quantity: 3, unitPrice: 9, discountAmount: 0 }
    ],
    subtotal: 47.5,
    discountAmount: 1,
    taxAmount: 4.65,
    total: 51.15,
    payments: [{ method: 'cash', amount: 60, changeGiven: 8.85 }],
    notes: ''
  }
}
