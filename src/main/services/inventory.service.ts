import { eq, sql } from 'drizzle-orm'
import { getDatabase, getSqlite } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'

export const inventoryService = {
  /**
   * Return all inventory rows joined with product and category info.
   *
   * Pack products (unitsPerPack > 1) have no inventory record of their own -
   * their inventory is tracked through the linked individual product.
   * This method returns inventory records for individual and standalone products only.
   *
   * For individual products linked to a pack, a packUnitsPerPack field is populated
   * so the UI can display "N units = X full boxes + Y remaining".
   */
  list(): Array<{
    id: string
    productId: string
    variantId: string | null
    quantity: number
    lowStockThreshold: number
    productName: string | null
    sku: string | null
    categoryName: string | null
    imageUrl: string | null
    unitsPerPack: number
    individualProductId: string | null
    packProductId: string | null
    packUnitsPerPack: number | null
  }> {
    const db = getDatabase()
    const rows = db
      .select({
        id: schema.inventory.id,
        productId: schema.inventory.productId,
        variantId: schema.inventory.variantId,
        quantity: schema.inventory.quantity,
        lowStockThreshold: schema.inventory.lowStockThreshold,
        productName: schema.products.name,
        sku: schema.products.sku,
        categoryName: schema.categories.name,
        imageUrl: schema.products.imageUrl,
        unitsPerPack: schema.products.unitsPerPack,
        individualProductId: schema.products.individualProductId,
        packProductId: schema.products.packProductId,
        trackStock: schema.products.trackStock,
      })
      .from(schema.inventory)
      .leftJoin(schema.products, eq(schema.inventory.productId, schema.products.id))
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .all()
      // Exclude service/non-tracked products from inventory view
      .filter((r) => r.trackStock !== false)
      .map(({ trackStock: _ts, ...r }) => ({
        ...r,
        unitsPerPack: r.unitsPerPack ?? 1,
        individualProductId: r.individualProductId ?? null,
        packProductId: r.packProductId ?? null,
        packUnitsPerPack: null as number | null
      }))

    // Resolve packUnitsPerPack for individual products linked to a pack
    const packIds = rows
      .filter((r) => r.packProductId != null)
      .map((r) => r.packProductId as string)

    if (packIds.length > 0) {
      const packProducts = db
        .select({ id: schema.products.id, unitsPerPack: schema.products.unitsPerPack })
        .from(schema.products)
        .all()
        .filter((p) => packIds.includes(p.id))
      const packMap = new Map(packProducts.map((p) => [p.id, p.unitsPerPack ?? 1]))
      return rows.map((r) =>
        r.packProductId ? { ...r, packUnitsPerPack: packMap.get(r.packProductId) ?? null } : r
      )
    }

    return rows
  },

  /**
   * Server-side paginated inventory list with optional name/SKU search.
   * Returns only `limit` rows and the total matching count.
   * Also returns `lowStockCount` so the UI alert banner needs no extra round-trip.
   * Only shows inventory for active (non-deleted) products.
   */
  listPaginated(opts: {
    search?: string
    offset: number
    limit: number
  }): {
    items: Array<{
      id: string
      productId: string
      variantId: string | null
      quantity: number
      lowStockThreshold: number
      productName: string | null
      sku: string | null
      categoryName: string | null
      imageUrl: string | null
      unitsPerPack: number
      individualProductId: string | null
      packProductId: string | null
      packUnitsPerPack: number | null
    }>
    total: number
    lowStockCount: number
  } {
    const db = getSqlite()
    const { search, offset, limit } = opts

    const likePat = search ? `%${search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%` : null

    const whereClause = likePat
      ? `AND p.is_active = 1 AND (LOWER(p.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(p.sku) LIKE LOWER(?) ESCAPE '\\')`
      : `AND p.is_active = 1`
    const params: unknown[] = likePat ? [likePat, likePat] : []

    // Total count matching the search (for pagination bar)
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.track_stock = 1 ${whereClause}`
    ).get(...params) as { cnt: number }
    const total = totalRow?.cnt ?? 0

    // Low stock count (always across all active products, ignoring search)
    const lowRow = db.prepare(
      `SELECT COUNT(*) as cnt
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE p.is_active = 1 AND p.track_stock = 1 AND i.quantity <= i.low_stock_threshold`
    ).get() as { cnt: number }
    const lowStockCount = lowRow?.cnt ?? 0

    // Paginated rows
    type RawRow = {
      id: string; product_id: string; variant_id: string | null
      quantity: number; low_stock_threshold: number
      product_name: string | null; sku: string | null
      category_name: string | null; image_url: string | null
      units_per_pack: number; individual_product_id: string | null
      pack_product_id: string | null
    }
    const rows = db.prepare(
      `SELECT i.id, i.product_id, i.variant_id, i.quantity, i.low_stock_threshold,
              p.name AS product_name, p.sku, p.image_url, p.units_per_pack,
              p.individual_product_id, p.pack_product_id,
              c.name AS category_name
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.track_stock = 1 ${whereClause}
       ORDER BY p.name ASC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as RawRow[]

    // Resolve packUnitsPerPack for pack-linked individual products
    const packIds = rows.filter((r) => r.pack_product_id).map((r) => r.pack_product_id as string)
    const packMap = new Map<string, number>()
    if (packIds.length > 0) {
      const placeholders = packIds.map(() => '?').join(',')
      const packRows = db.prepare(
        `SELECT id, units_per_pack FROM products WHERE id IN (${placeholders})`
      ).all(...packIds) as Array<{ id: string; units_per_pack: number }>
      for (const p of packRows) packMap.set(p.id, p.units_per_pack ?? 1)
    }

    const items = rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      variantId: r.variant_id,
      quantity: r.quantity,
      lowStockThreshold: r.low_stock_threshold,
      productName: r.product_name,
      sku: r.sku,
      categoryName: r.category_name,
      imageUrl: r.image_url,
      unitsPerPack: r.units_per_pack ?? 1,
      individualProductId: r.individual_product_id,
      packProductId: r.pack_product_id,
      packUnitsPerPack: r.pack_product_id ? (packMap.get(r.pack_product_id) ?? null) : null
    }))

    return { items, total, lowStockCount }
  },

  lowStock() {
    const db = getDatabase()
    return db
      .select({
        id: schema.inventory.id,
        productId: schema.inventory.productId,
        quantity: schema.inventory.quantity,
        lowStockThreshold: schema.inventory.lowStockThreshold,
        productName: schema.products.name,
        sku: schema.products.sku
      })
      .from(schema.inventory)
      .leftJoin(schema.products, eq(schema.inventory.productId, schema.products.id))
      .where(sql`${schema.inventory.quantity} <= ${schema.inventory.lowStockThreshold}`)
      .all()
  },

  /**
   * Adjust inventory for a product.
   *
   * - **Composite/bundle products**: the adjustment cascades to all component
   *   products (each component's quantity is multiplied by its quantity-per-bundle).
   * - **Pack products** (unitsPerPack > 1): the adjustment is redirected to the
   *   linked individual product and the quantity is multiplied by unitsPerPack.
   *
   * Examples:
   *   - Adjusting a composite bundle by 3 adds 3 × component.quantity to each component.
   *   - Receiving 2 packs of 100 spoons adds 200 to the individual spoon product.
   */
  adjust(input: {
    productId: string
    variantId?: string
    type: 'receive' | 'transfer' | 'loss' | 'adjustment'
    quantity: number
    note?: string
    staffId?: string
  }) {
    const db = getDatabase()
    const now = new Date().toISOString()

    // Resolve the actual product to adjust (redirect packs to their individual product)
    const product = db
      .select({
        unitsPerPack: schema.products.unitsPerPack,
        individualProductId: schema.products.individualProductId,
        isComposite: schema.products.isComposite,
      })
      .from(schema.products)
      .where(eq(schema.products.id, input.productId))
      .get()

    // ── Composite/bundle: cascade adjustment to every component product ─────
    if (product?.isComposite) {
      const components = db
        .select({
          componentProductId: schema.productComponents.componentProductId,
          quantity: schema.productComponents.quantity,
        })
        .from(schema.productComponents)
        .where(eq(schema.productComponents.compositeProductId, input.productId))
        .all()

      for (const comp of components) {
        const componentQty = Math.round(input.quantity * comp.quantity)
        if (componentQty > 0) {
          inventoryService.adjust({
            productId: comp.componentProductId,
            type: input.type,
            quantity: componentQty,
            note: input.note
              ? `${input.note} (bundle ×${input.quantity})`
              : `Bundle adjustment ×${input.quantity}`,
            staffId: input.staffId,
          })
        }
      }
      // Return null — composite products don't carry their own stock record
      return null
    }

    const unitsPerPack = product?.unitsPerPack ?? 1
    const resolvedProductId =
      unitsPerPack > 1 && product?.individualProductId
        ? product.individualProductId
        : input.productId
    const resolvedQuantity =
      unitsPerPack > 1 ? input.quantity * unitsPerPack : input.quantity

    // Find or create inventory record for the resolved product
    let inv = db
      .select()
      .from(schema.inventory)
      .where(eq(schema.inventory.productId, resolvedProductId))
      .get()

    if (!inv) {
      const invId = generateId()
      db.insert(schema.inventory)
        .values({
          id: invId,
          productId: resolvedProductId,
          variantId: input.variantId,
          quantity: 0,
          lowStockThreshold: 5,
          createdAt: now,
          updatedAt: now
        })
        .run()
      inv = db.select().from(schema.inventory).where(eq(schema.inventory.id, invId)).get()!
    }

    const delta =
      input.type === 'receive'
        ? resolvedQuantity
        : input.type === 'loss' || input.type === 'transfer'
          ? -resolvedQuantity
          : resolvedQuantity

    db.update(schema.inventory)
      .set({ quantity: Math.max(0, inv.quantity + delta), updatedAt: now })
      .where(eq(schema.inventory.id, inv.id))
      .run()

    const noteText = input.note
      ? (unitsPerPack > 1 ? input.note + ' (' + input.quantity + ' pack(s) x ' + unitsPerPack + ' units)' : input.note)
      : (unitsPerPack > 1 ? input.quantity + ' pack(s) x ' + unitsPerPack + ' units each' : undefined)

    db.insert(schema.inventoryAdjustments)
      .values({
        id: generateId(),
        productId: resolvedProductId,
        variantId: input.variantId,
        type: input.type,
        quantity: delta,
        note: noteText,
        staffId: input.staffId,
        createdAt: now
      })
      .run()

    return db.select().from(schema.inventory).where(eq(schema.inventory.id, inv.id)).get()
  },

  setLowStockThreshold(productId: string, threshold: number) {
    const db = getDatabase()
    db.update(schema.inventory)
      .set({ lowStockThreshold: threshold, updatedAt: new Date().toISOString() })
      .where(eq(schema.inventory.productId, productId))
      .run()
  }
}
