/**
 * CSV bulk import/export service for products and customers.
 *
 * Import strategy:
 *  - Products: upsert by SKU (update if found, create if not)
 *  - Customers: upsert by email (update if found, create if not)
 *
 * Export produces a header row followed by one data row per record.
 * All fields are quoted if they contain a comma, double-quote, or newline.
 */

import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportResult {
  imported: number
  updated: number
  failed: number
  errors: string[]
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

/** Wrap a value in quotes if it needs escaping; always quote for safety. */
function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  // Escape any double-quotes, then wrap in quotes
  return '"' + str.replace(/"/g, '""') + '"'
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',')
}

/**
 * Parse a CSV string into an array of row objects keyed by header names.
 * Handles quoted fields containing commas and embedded double-quotes.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = splitCsvLines(text.trim())
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cells = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = cells[idx]?.trim() ?? ''
    })
    rows.push(row)
  }
  return rows
}

/** Split CSV text into logical lines, respecting quoted newlines. */
function splitCsvLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
        current += ch
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      lines.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Parse a single CSV line into an array of field strings. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

// ─── Products ─────────────────────────────────────────────────────────────────

/**
 * Required CSV columns for product import:
 * name, sku, price
 *
 * Optional columns:
 * barcode, description, category_name, cost_price, tax_rate,
 * stock_quantity, low_stock_threshold, is_active
 */
export function importProductsCsv(csvText: string): ImportResult {
  const db = getDatabase()
  const rows = parseCsv(csvText)
  const result: ImportResult = { imported: 0, updated: 0, failed: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowLabel = `Row ${i + 2}` // +2 because row 1 is header

    try {
      const name = row['name'] || row['product_name']
      const sku = row['sku'] || row['sku_code']
      const price = parseFloat(row['price'] || row['base_price'] || row['unit_price'] || '')

      if (!name) { result.failed++; result.errors.push(`${rowLabel}: missing name`); continue }
      if (!sku) { result.failed++; result.errors.push(`${rowLabel}: missing sku`); continue }
      if (isNaN(price) || price < 0) { result.failed++; result.errors.push(`${rowLabel}: invalid price`); continue }

      const now = new Date().toISOString()

      // Resolve category by name
      let categoryId: string | null = null
      const categoryName = row['category_name'] || row['category']
      if (categoryName) {
        const cat = db.select().from(schema.categories).all()
          .find((c) => c.name.toLowerCase() === categoryName.toLowerCase())
        if (cat) {
          categoryId = cat.id
        } else {
          // Create the category on-the-fly
          const newCatId = generateId()
          db.insert(schema.categories)
            .values({ id: newCatId, name: categoryName, color: '#6b7280', sortOrder: 99, createdAt: now, updatedAt: now })
            .run()
          categoryId = newCatId
        }
      }

      // Check if product with this SKU already exists
      const existing = db.select().from(schema.products)
        .where(eq(schema.products.sku, sku))
        .get()

      const costPrice = row['cost_price'] ? parseFloat(row['cost_price']) : undefined
      const taxRate = row['tax_rate'] ? parseFloat(row['tax_rate']) : undefined
      const isActive = row['is_active'] ? row['is_active'].toLowerCase() !== 'false' && row['is_active'] !== '0' : true

      if (existing) {
        // Update existing product
        db.update(schema.products)
          .set({
            name,
            barcode: row['barcode'] || existing.barcode,
            description: row['description'] || existing.description,
            categoryId: categoryId ?? existing.categoryId,
            basePrice: price,
            costPrice: isNaN(costPrice ?? NaN) ? existing.costPrice : costPrice,
            taxRate: isNaN(taxRate ?? NaN) ? existing.taxRate : taxRate,
            isActive,
            updatedAt: now
          })
          .where(eq(schema.products.id, existing.id))
          .run()

        // Update inventory if stock_quantity provided
        const stockQty = row['stock_quantity'] !== undefined && row['stock_quantity'] !== ''
          ? parseInt(row['stock_quantity'], 10) : undefined
        const lowStock = row['low_stock_threshold'] !== undefined && row['low_stock_threshold'] !== ''
          ? parseInt(row['low_stock_threshold'], 10) : undefined

        if (stockQty !== undefined && !isNaN(stockQty)) {
          const inv = db.select().from(schema.inventory)
            .where(eq(schema.inventory.productId, existing.id)).get()
          if (inv) {
            db.update(schema.inventory)
              .set({
                quantity: stockQty,
                lowStockThreshold: (!lowStock || isNaN(lowStock)) ? inv.lowStockThreshold : lowStock,
                updatedAt: now
              })
              .where(eq(schema.inventory.productId, existing.id))
              .run()
          }
        }
        result.updated++
      } else {
        // Insert new product
        const id = generateId()
        db.insert(schema.products)
          .values({
            id, name, sku,
            barcode: row['barcode'] || null,
            description: row['description'] || null,
            categoryId,
            basePrice: price,
            costPrice: (!costPrice || isNaN(costPrice)) ? null : costPrice,
            taxRate: (!taxRate || isNaN(taxRate)) ? 0 : taxRate,
            isComposite: false,
            isActive,
            createdAt: now, updatedAt: now
          })
          .run()

        const stockQty = row['stock_quantity'] ? parseInt(row['stock_quantity'], 10) : 0
        const lowStock = row['low_stock_threshold'] ? parseInt(row['low_stock_threshold'], 10) : 5
        db.insert(schema.inventory)
          .values({
            id: generateId(), productId: id,
            quantity: isNaN(stockQty) ? 0 : stockQty,
            lowStockThreshold: isNaN(lowStock) ? 5 : lowStock,
            createdAt: now, updatedAt: now
          })
          .run()
        result.imported++
      }
    } catch (err) {
      result.failed++
      result.errors.push(`${rowLabel}: ${String(err)}`)
    }
  }

  return result
}

/** Export all active products to a CSV string. */
export function exportProductsCsv(): string {
  const db = getDatabase()

  const products = db
    .select({
      name: schema.products.name,
      sku: schema.products.sku,
      barcode: schema.products.barcode,
      description: schema.products.description,
      categoryName: schema.categories.name,
      basePrice: schema.products.basePrice,
      costPrice: schema.products.costPrice,
      taxRate: schema.products.taxRate,
      isActive: schema.products.isActive,
    })
    .from(schema.products)
    .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
    .where(eq(schema.products.isActive, true))
    .all()

  // Fetch inventory quantities
  const inventoryMap = new Map<string, { quantity: number; lowStockThreshold: number }>()
  const allInv = db.select().from(schema.inventory).all()
  const allProds = db.select({ id: schema.products.id, sku: schema.products.sku }).from(schema.products).all()
  for (const inv of allInv) {
    const prod = allProds.find((p) => p.id === inv.productId)
    if (prod) inventoryMap.set(prod.sku, { quantity: inv.quantity, lowStockThreshold: inv.lowStockThreshold })
  }

  const headers = ['name', 'sku', 'barcode', 'description', 'category_name', 'price', 'cost_price', 'tax_rate', 'stock_quantity', 'low_stock_threshold', 'is_active']
  const rows = [headers.join(',')]

  for (const p of products) {
    const inv = inventoryMap.get(p.sku)
    rows.push(csvRow([
      p.name, p.sku, p.barcode ?? '', p.description ?? '',
      p.categoryName ?? '', p.basePrice, p.costPrice ?? '',
      p.taxRate, inv?.quantity ?? 0, inv?.lowStockThreshold ?? 5,
      p.isActive ? 'true' : 'false'
    ]))
  }

  return rows.join('\n')
}

// ─── Customers ────────────────────────────────────────────────────────────────

/**
 * Required CSV columns: first_name, last_name
 * Optional: email, phone, address, notes, loyalty_points, store_credit
 */
export function importCustomersCsv(csvText: string): ImportResult {
  const db = getDatabase()
  const rows = parseCsv(csvText)
  const result: ImportResult = { imported: 0, updated: 0, failed: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowLabel = `Row ${i + 2}`

    try {
      const firstName = row['first_name'] || row['firstname']
      const lastName = row['last_name'] || row['lastname']

      if (!firstName) { result.failed++; result.errors.push(`${rowLabel}: missing first_name`); continue }
      if (!lastName) { result.failed++; result.errors.push(`${rowLabel}: missing last_name`); continue }

      const email = row['email'] || null
      const now = new Date().toISOString()

      // Try to find existing by email, then by name if no email
      let existing = null
      if (email) {
        existing = db.select().from(schema.customers)
          .all().find((c) => c.email?.toLowerCase() === email.toLowerCase()) ?? null
      } else {
        existing = db.select().from(schema.customers)
          .all().find((c) =>
            c.firstName.toLowerCase() === firstName.toLowerCase() &&
            c.lastName.toLowerCase() === lastName.toLowerCase()
          ) ?? null
      }

      const loyaltyPoints = row['loyalty_points'] ? parseInt(row['loyalty_points'], 10) : undefined
      const storeCredit = row['store_credit'] ? parseFloat(row['store_credit']) : undefined

      if (existing) {
        db.update(schema.customers)
          .set({
            firstName, lastName,
            email: email ?? existing.email,
            phone: row['phone'] || existing.phone,
            address: row['address'] || existing.address,
            notes: row['notes'] || existing.notes,
            loyaltyPoints: (loyaltyPoints !== undefined && !isNaN(loyaltyPoints)) ? loyaltyPoints : existing.loyaltyPoints,
            storeCredit: (storeCredit !== undefined && !isNaN(storeCredit)) ? storeCredit : existing.storeCredit,
            updatedAt: now
          })
          .where(eq(schema.customers.id, existing.id))
          .run()
        result.updated++
      } else {
        db.insert(schema.customers)
          .values({
            id: generateId(), firstName, lastName,
            email: email ?? undefined,
            phone: row['phone'] || undefined,
            address: row['address'] || undefined,
            notes: row['notes'] || undefined,
            loyaltyPoints: (loyaltyPoints !== undefined && !isNaN(loyaltyPoints)) ? loyaltyPoints : 0,
            storeCredit: (storeCredit !== undefined && !isNaN(storeCredit)) ? storeCredit : 0,
            createdAt: now, updatedAt: now
          })
          .run()
        result.imported++
      }
    } catch (err) {
      result.failed++
      result.errors.push(`${rowLabel}: ${String(err)}`)
    }
  }

  return result
}

/** Export all customers to a CSV string. */
export function exportCustomersCsv(): string {
  const db = getDatabase()
  const customers = db.select().from(schema.customers).all()

  const headers = ['first_name', 'last_name', 'email', 'phone', 'address', 'loyalty_points', 'store_credit', 'notes']
  const rows = [headers.join(',')]

  for (const c of customers) {
    rows.push(csvRow([
      c.firstName, c.lastName, c.email ?? '', c.phone ?? '',
      c.address ?? '', c.loyaltyPoints, c.storeCredit, c.notes ?? ''
    ]))
  }

  return rows.join('\n')
}

export const csvImportExportService = {
  importProducts: importProductsCsv,
  exportProducts: exportProductsCsv,
  importCustomers: importCustomersCsv,
  exportCustomers: exportCustomersCsv
}
