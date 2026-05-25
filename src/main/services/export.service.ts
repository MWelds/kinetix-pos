/**
 * Export service — generates accounting-ready export files from order data.
 *
 * Supported formats:
 *   - Transactions CSV: full order/payment detail for any accounting software
 *   - QuickBooks IIF:   legacy Intuit Interchange Format for QB Desktop import
 */

import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { eq, and, gte, lte } from 'drizzle-orm'

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function csvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    .join(',')
}

// ─── Public service ───────────────────────────────────────────────────────────

export const exportService = {
  /**
   * Generate a detailed transactions CSV covering all completed orders in the
   * given date range.  Each row is one order-item line.
   */
  transactionsCsv(fromDate: string, toDate: string): string {
    const db = getDatabase()

    const orders = db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, 'completed'),
          gte(schema.orders.createdAt, fromDate),
          lte(schema.orders.createdAt, toDate)
        )
      )
      .all()

    const headers = [
      'Order #', 'Date', 'Customer ID', 'Staff ID',
      'Product', 'SKU', 'Qty', 'Unit Price', 'Line Discount', 'Line Total',
      'Order Subtotal', 'Order Discount', 'Order Tax', 'Order Total',
      'Payment Method', 'Payment Amount', 'Notes'
    ]

    const rows: string[] = [csvRow(headers)]

    for (const order of orders) {
      const items = db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id))
        .all()

      const payments = db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, order.id))
        .all()

      const paymentSummary = payments
        .map((p) => `${p.method}:${p.amount.toFixed(2)}`)
        .join('; ')

      const paymentTotal = payments.reduce((s, p) => s + p.amount, 0)

      for (const item of items) {
        rows.push(
          csvRow([
            order.orderNumber,
            order.createdAt.split('T')[0],
            order.customerId ?? '',
            order.staffId ?? '',
            item.productName + (item.variantName ? ` (${item.variantName})` : ''),
            item.sku,
            item.quantity,
            item.unitPrice.toFixed(2),
            item.discountAmount.toFixed(2),
            item.lineTotal.toFixed(2),
            order.subtotal.toFixed(2),
            order.discountAmount.toFixed(2),
            order.taxAmount.toFixed(2),
            order.total.toFixed(2),
            paymentSummary,
            paymentTotal.toFixed(2),
            order.notes ?? ''
          ])
        )
      }
    }

    return rows.join('\n')
  },

  /**
   * Generate a QuickBooks IIF file (Intuit Interchange Format) for QB Desktop.
   * Each completed order becomes a Sales Receipt transaction.
   */
  quickbooksIif(fromDate: string, toDate: string): string {
    const db = getDatabase()

    const orders = db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, 'completed'),
          gte(schema.orders.createdAt, fromDate),
          lte(schema.orders.createdAt, toDate)
        )
      )
      .all()

    const lines: string[] = []

    // IIF header definitions
    lines.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tTOPRINT')
    lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR')
    lines.push('!ENDTRNS')

    for (const order of orders) {
      const items = db
        .select()
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, order.id))
        .all()

      const payments = db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, order.id))
        .all()

      const dateStr = order.createdAt.split('T')[0].replace(/-/g, '/')
      const primaryPayment = payments[0]?.method ?? 'cash'
      const depositAcct = primaryPayment === 'cash' ? 'Cash Drawer' : 'Undeposited Funds'

      // TRNS line (the deposit / debit side)
      lines.push(
        [
          'TRNS', '', 'CASH SALE', dateStr,
          depositAcct, '', '',
          order.total.toFixed(2), order.orderNumber,
          `POS Sale ${order.orderNumber}`, 'N', 'N'
        ].join('\t')
      )

      // SPL lines — one per item (credit to Sales account)
      for (const item of items) {
        lines.push(
          [
            'SPL', '', 'CASH SALE', dateStr,
            'Sales', '', '',
            (-item.lineTotal).toFixed(2), order.orderNumber,
            item.productName.replace(/\t/g, ' '), 'N'
          ].join('\t')
        )
      }

      // Tax line if applicable
      if (order.taxAmount > 0) {
        lines.push(
          [
            'SPL', '', 'CASH SALE', dateStr,
            'Sales Tax Payable', '', '',
            (-order.taxAmount).toFixed(2), order.orderNumber,
            'Sales Tax', 'N'
          ].join('\t')
        )
      }

      lines.push('ENDTRNS')
    }

    return lines.join('\n')
  },

  /**
   * Generate a daily sales summary CSV — one row per day.
   */
  dailySummaryCsv(fromDate: string, toDate: string): string {
    const db = getDatabase()

    // Group completed orders by date
    const orders = db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, 'completed'),
          gte(schema.orders.createdAt, fromDate),
          lte(schema.orders.createdAt, toDate)
        )
      )
      .all()

    const byDate: Record<string, { count: number; subtotal: number; discount: number; tax: number; total: number }> = {}

    for (const order of orders) {
      const date = order.createdAt.split('T')[0]
      if (!byDate[date]) byDate[date] = { count: 0, subtotal: 0, discount: 0, tax: 0, total: 0 }
      byDate[date].count++
      byDate[date].subtotal += order.subtotal
      byDate[date].discount += order.discountAmount
      byDate[date].tax += order.taxAmount
      byDate[date].total += order.total
    }

    const headers = ['Date', 'Orders', 'Subtotal', 'Discounts', 'Tax', 'Net Revenue']
    const rows = [
      csvRow(headers),
      ...Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, s]) =>
          csvRow([date, s.count, s.subtotal.toFixed(2), s.discount.toFixed(2), s.tax.toFixed(2), s.total.toFixed(2)])
        )
    ]

    return rows.join('\n')
  }
}
