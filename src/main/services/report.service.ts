import { eq, gte, lte, and, isNotNull } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'

export interface VendorPayable {
  vendorId: string
  vendorName: string
  unitsSold: number
  /** Cost of goods sold today for this vendor (sum of quantity × vendor_cost) */
  cogsToday: number
}

export const reportService = {
  /** Summary totals for a date range */
  salesSummary(fromDate: string, toDate: string) {
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

    const totalRevenue = orders.reduce((s, o) => s + o.total, 0)
    const totalDiscount = orders.reduce((s, o) => s + o.discountAmount, 0)
    const totalTax = orders.reduce((s, o) => s + o.taxAmount, 0)

    return {
      orderCount: orders.length,
      totalRevenue,
      totalDiscount,
      totalTax,
      averageOrderValue: orders.length ? totalRevenue / orders.length : 0
    }
  },

  /** Revenue broken down by product */
  salesByProduct(fromDate: string, toDate: string) {
    const db = getDatabase()
    const items = db
      .select({
        productId: schema.orderItems.productId,
        productName: schema.orderItems.productName,
        sku: schema.orderItems.sku,
        quantity: schema.orderItems.quantity,
        lineTotal: schema.orderItems.lineTotal,
        orderCreatedAt: schema.orders.createdAt
      })
      .from(schema.orderItems)
      .leftJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(
        and(
          eq(schema.orders.status, 'completed'),
          gte(schema.orders.createdAt, fromDate),
          lte(schema.orders.createdAt, toDate)
        )
      )
      .all()

    const map = new Map<
      string,
      { productId: string; productName: string; sku: string; quantity: number; revenue: number }
    >()

    for (const item of items) {
      const existing = map.get(item.productId)
      if (existing) {
        existing.quantity += item.quantity
        existing.revenue += item.lineTotal
      } else {
        map.set(item.productId, {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          revenue: item.lineTotal
        })
      }
    }

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
  },

  /** Revenue broken down by staff member */
  salesByStaff(fromDate: string, toDate: string) {
    const db = getDatabase()
    const orders = db
      .select({
        staffId: schema.orders.staffId,
        firstName: schema.staff.firstName,
        lastName: schema.staff.lastName,
        total: schema.orders.total,
        createdAt: schema.orders.createdAt
      })
      .from(schema.orders)
      .leftJoin(schema.staff, eq(schema.orders.staffId, schema.staff.id))
      .where(
        and(
          eq(schema.orders.status, 'completed'),
          gte(schema.orders.createdAt, fromDate),
          lte(schema.orders.createdAt, toDate)
        )
      )
      .all()

    const map = new Map<
      string,
      { staffId: string; name: string; orderCount: number; revenue: number }
    >()

    for (const o of orders) {
      const key = o.staffId ?? 'unknown'
      const name = o.firstName ? `${o.firstName} ${o.lastName}` : 'Unknown'
      const existing = map.get(key)
      if (existing) {
        existing.orderCount++
        existing.revenue += o.total
      } else {
        map.set(key, { staffId: key, name, orderCount: 1, revenue: o.total })
      }
    }

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
  },

  /** Payment method breakdown */
  paymentBreakdown(fromDate: string, toDate: string) {
    const db = getDatabase()
    const payments = db
      .select({
        method: schema.payments.method,
        amount: schema.payments.amount,
        orderCreatedAt: schema.orders.createdAt
      })
      .from(schema.payments)
      .leftJoin(schema.orders, eq(schema.payments.orderId, schema.orders.id))
      .where(
        and(
          eq(schema.orders.status, 'completed'),
          gte(schema.orders.createdAt, fromDate),
          lte(schema.orders.createdAt, toDate)
        )
      )
      .all()

    const map = new Map<string, { method: string; count: number; total: number }>()
    for (const p of payments) {
      const existing = map.get(p.method)
      if (existing) {
        existing.count++
        existing.total += p.amount
      } else {
        map.set(p.method, { method: p.method, count: 1, total: p.amount })
      }
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  },


  /** Revenue broken down by register (terminal). */
  salesByTerminal(fromDate: string, toDate: string) {
    const db = getDatabase()
    const orders = db
      .select({
        terminalId: schema.orders.terminalId,
        total: schema.orders.total,
        createdAt: schema.orders.createdAt
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, 'completed'),
          gte(schema.orders.createdAt, fromDate),
          lte(schema.orders.createdAt, toDate)
        )
      )
      .all()

    const map = new Map<string, { terminalId: string; orderCount: number; revenue: number }>()

    for (const o of orders) {
      const key = o.terminalId ?? 'unknown'
      const existing = map.get(key)
      if (existing) {
        existing.orderCount++
        existing.revenue += o.total
      } else {
        map.set(key, { terminalId: key, orderCount: 1, revenue: o.total })
      }
    }

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
  },
  /** Inventory valuation (cost * quantity) */
  inventoryValuation() {
    const db = getDatabase()
    return db
      .select({
        productId: schema.products.id,
        productName: schema.products.name,
        sku: schema.products.sku,
        quantity: schema.inventory.quantity,
        costPrice: schema.products.costPrice,
        basePrice: schema.products.basePrice
      })
      .from(schema.inventory)
      .leftJoin(schema.products, eq(schema.inventory.productId, schema.products.id))
      .all()
      .map((r) => ({
        ...r,
        costValue: (r.costPrice ?? 0) * r.quantity,
        retailValue: r.basePrice * r.quantity
      }))
  },

  /**
   * For each vendor, return today's cost of goods sold (COGS):
   * sum(order_item.quantity × product.vendor_cost) for completed orders
   * in [fromDate, toDate] where the product has a vendor assigned.
   */
  vendorPayables(fromDate: string, toDate: string): VendorPayable[] {
    const db = getDatabase()

    const rows = db
      .select({
        vendorId: schema.vendors.id,
        vendorName: schema.vendors.name,
        quantity: schema.orderItems.quantity,
        vendorCost: schema.products.vendorCost,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .innerJoin(schema.vendors, eq(schema.products.vendorId, schema.vendors.id))
      .where(
        and(
          eq(schema.orders.status, 'completed'),
          gte(schema.orders.createdAt, fromDate),
          lte(schema.orders.createdAt, toDate),
          isNotNull(schema.products.vendorId),
          isNotNull(schema.products.vendorCost)
        )
      )
      .all()

    const map = new Map<string, VendorPayable>()
    for (const row of rows) {
      const cost = (row.vendorCost ?? 0) * row.quantity
      const existing = map.get(row.vendorId)
      if (existing) {
        existing.unitsSold += row.quantity
        existing.cogsToday += cost
      } else {
        map.set(row.vendorId, {
          vendorId: row.vendorId,
          vendorName: row.vendorName,
          unitsSold: row.quantity,
          cogsToday: cost,
        })
      }
    }

    return Array.from(map.values())
      .filter((v) => v.cogsToday > 0)
      .sort((a, b) => b.cogsToday - a.cogsToday)
  }
}
