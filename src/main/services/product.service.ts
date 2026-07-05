import { eq, like, or, and, inArray, sql, count, isNull } from 'drizzle-orm'
import { getDatabase, getSqlite } from '../database/connection'
import * as schema from '../database/schema'
import { generateId } from '../lib/id'

/**
 * Sentinel value placed in `imageUrl` on list responses when a product has a
 * locally-stored base64 image.  Sending the full data URI over IPC for every
 * product in a large catalog would serialize megabytes of JSON on every category
 * switch.  The renderer detects this sentinel and fetches the real URL lazily
 * via the PRODUCTS_IMAGE_URL channel.
 */
export const LOCAL_IMAGE_SENTINEL = '__local__'

/** Strip large base64 data-URIs from a row before serialising over IPC. */
function slimImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  return url.startsWith('data:') ? LOCAL_IMAGE_SENTINEL : url
}

export interface CreateProductInput {
  name: string
  sku: string
  barcode?: string
  description?: string
  categoryId?: string
  basePrice: number
  costPrice?: number
  imageUrl?: string | null
  isComposite?: boolean
  taxRate?: number
  /**
   * Number of individual units contained in one pack (e.g. 100 for a box of 100 spoons).
   * When > 1 the system auto-creates a linked individual product and tracks shared inventory
   * in individual units under that product.
   * Defaults to 1 (standalone / individual product - no pack link).
   */
  unitsPerPack?: number
  /** Consignment vendor ID (null = own stock) */
  vendorId?: string
  /** Per-unit cost owed to vendor on sale */
  vendorCost?: number
  /**
   * When false the product is a service item (no physical stock).
   * Out-of-stock checks and inventory deductions are skipped.
   */
  trackStock?: boolean
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
  isActive?: boolean
}

export interface ProductWithInventory {
  id: string
  name: string
  sku: string
  barcode: string | null
  description: string | null
  categoryId: string | null
  basePrice: number
  costPrice: number | null
  imageUrl: string | null
  isComposite: boolean
  isActive: boolean
  taxRate: number
  /** Units per pack (1 = standalone/individual, >1 = pack product) */
  unitsPerPack: number
  /** ID of the auto-created individual product for this pack (null if not a pack) */
  individualProductId: string | null
  /** ID of the parent pack product if this is an auto-created individual (null otherwise) */
  packProductId: string | null
  vendorId: string | null
  vendorCost: number | null
  /** When false the product is a service item — no stock tracking */
  trackStock: boolean
  createdAt: string
  updatedAt: string
  /** Display quantity: boxes for pack products, individual units for everything else */
  quantity: number
  categoryName: string | null
  categoryColor: string | null
  /** True if this product has at least one active variant (e.g. sizes) */
  hasVariants: boolean
}

export interface ProductComponentDetail {
  id: string
  compositeProductId: string
  componentProductId: string
  componentProductName: string
  componentSku: string
  quantity: number
}

// Shared SELECT shape reused across queries
function productSelect() {
  return {
    id: schema.products.id,
    name: schema.products.name,
    sku: schema.products.sku,
    barcode: schema.products.barcode,
    description: schema.products.description,
    categoryId: schema.products.categoryId,
    basePrice: schema.products.basePrice,
    costPrice: schema.products.costPrice,
    imageUrl: schema.products.imageUrl,
    isComposite: schema.products.isComposite,
    isActive: schema.products.isActive,
    taxRate: schema.products.taxRate,
    unitsPerPack: schema.products.unitsPerPack,
    individualProductId: schema.products.individualProductId,
    packProductId: schema.products.packProductId,
    vendorId: schema.products.vendorId,
    vendorCost: schema.products.vendorCost,
    trackStock: schema.products.trackStock,
    createdAt: schema.products.createdAt,
    updatedAt: schema.products.updatedAt,
    quantity: schema.inventory.quantity,
    categoryName: schema.categories.name,
    categoryColor: schema.categories.color
  }
}

/**
 * For pack products (unitsPerPack > 1), inventory is tracked in individual units under the
 * linked individual product. This helper patches the quantity field of every pack product
 * to floor(individualQty / unitsPerPack).
 */
function applyPackQuantities<T extends { unitsPerPack: number; individualProductId: string | null; quantity: number }>(
  db: ReturnType<typeof getDatabase>,
  rows: T[]
): T[] {
  const packRows = rows.filter((r) => r.unitsPerPack > 1 && r.individualProductId)
  if (packRows.length === 0) return rows

  const indIds = packRows.map((r) => r.individualProductId as string)
  const indInv = db
    .select({ productId: schema.inventory.productId, quantity: schema.inventory.quantity })
    .from(schema.inventory)
    .where(inArray(schema.inventory.productId, indIds))
    .all()

  const indQtyMap = new Map(indInv.map((r) => [r.productId, r.quantity]))

  return rows.map((r) => {
    if (r.unitsPerPack > 1 && r.individualProductId) {
      const indQty = indQtyMap.get(r.individualProductId) ?? 0
      return { ...r, quantity: Math.floor(indQty / r.unitsPerPack) }
    }
    return r
  })
}

/**
 * Marks each row with `hasVariants` — one extra lightweight query (not a
 * per-row correlated subquery) so the renderer knows to show a size picker
 * instead of adding straight to cart.
 */
function attachHasVariants<T extends { id: string }>(
  db: ReturnType<typeof getDatabase>,
  rows: T[]
): (T & { hasVariants: boolean })[] {
  if (rows.length === 0) return rows as (T & { hasVariants: boolean })[]
  const ids = rows.map((r) => r.id)
  const withVariants = db
    .select({ productId: schema.productVariants.productId })
    .from(schema.productVariants)
    .where(and(inArray(schema.productVariants.productId, ids), eq(schema.productVariants.isActive, true)))
    .all()
  const idSet = new Set(withVariants.map((r) => r.productId))
  return rows.map((r) => ({ ...r, hasVariants: idSet.has(r.id) }))
}

export const productService = {
  /** List all active products with current inventory levels */
  listWithInventory(categoryId?: string): ProductWithInventory[] {
    const db = getDatabase()
    const rows = db
      .select(productSelect())
      .from(schema.products)
      // Only the product's own (non-variant) inventory row — a variant product
      // has one inventory row per size, and joining on productId alone would
      // fan out into one result row per size instead of one row per product.
      .leftJoin(
        schema.inventory,
        and(eq(schema.products.id, schema.inventory.productId), isNull(schema.inventory.variantId))
      )
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(
        and(
          eq(schema.products.isActive, true),
          categoryId ? eq(schema.products.categoryId, categoryId) : undefined
        )
      )
      .all()
    const base = rows.map((r) => ({
      ...r,
      imageUrl: slimImageUrl(r.imageUrl),
      unitsPerPack: r.unitsPerPack ?? 1,
      individualProductId: r.individualProductId ?? null,
      packProductId: r.packProductId ?? null,
      trackStock: r.trackStock ?? true,
      quantity: r.quantity ?? 0
    }))
    return attachHasVariants(db, applyPackQuantities(db, base))
  },

  /** Search products by name, SKU, or barcode */
  search(query: string): ProductWithInventory[] {
    const db = getDatabase()
    const like_ = `%${query}%`
    const rows = db
      .select(productSelect())
      .from(schema.products)
      // Only the product's own (non-variant) inventory row — a variant product
      // has one inventory row per size, and joining on productId alone would
      // fan out into one result row per size instead of one row per product.
      .leftJoin(
        schema.inventory,
        and(eq(schema.products.id, schema.inventory.productId), isNull(schema.inventory.variantId))
      )
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(
        and(
          eq(schema.products.isActive, true),
          or(
            like(schema.products.name, like_),
            like(schema.products.sku, like_),
            like(schema.products.barcode, like_)
          )
        )
      )
      .limit(50)
      .all()
    const base = rows.map((r) => ({
      ...r,
      imageUrl: slimImageUrl(r.imageUrl),
      unitsPerPack: r.unitsPerPack ?? 1,
      individualProductId: r.individualProductId ?? null,
      packProductId: r.packProductId ?? null,
      trackStock: r.trackStock ?? true,
      quantity: r.quantity ?? 0
    }))
    return attachHasVariants(db, applyPackQuantities(db, base))
  },

  /** Look up a product by barcode */
  findByBarcode(barcode: string): ProductWithInventory | null {
    const db = getDatabase()
    const rows = db
      .select(productSelect())
      .from(schema.products)
      // Only the product's own (non-variant) inventory row — a variant product
      // has one inventory row per size, and joining on productId alone would
      // fan out into one result row per size instead of one row per product.
      .leftJoin(
        schema.inventory,
        and(eq(schema.products.id, schema.inventory.productId), isNull(schema.inventory.variantId))
      )
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(eq(schema.products.barcode, barcode), eq(schema.products.isActive, true)))
      .limit(1)
      .all()
    if (!rows.length) return null
    const base = [{
      ...rows[0],
      unitsPerPack: rows[0].unitsPerPack ?? 1,
      individualProductId: rows[0].individualProductId ?? null,
      packProductId: rows[0].packProductId ?? null,
      quantity: rows[0].quantity ?? 0
    }]
    return attachHasVariants(db, applyPackQuantities(db, base))[0]
  },

  /** Get a single product by ID (includes full imageUrl) */
  getById(id: string): ProductWithInventory | null {
    const db = getDatabase()
    const rows = db
      .select(productSelect())
      .from(schema.products)
      // Only the product's own (non-variant) inventory row — a variant product
      // has one inventory row per size, and joining on productId alone would
      // fan out into one result row per size instead of one row per product.
      .leftJoin(
        schema.inventory,
        and(eq(schema.products.id, schema.inventory.productId), isNull(schema.inventory.variantId))
      )
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(eq(schema.products.id, id))
      .limit(1)
      .all()
    if (!rows.length) return null
    const base = [{
      ...rows[0],
      unitsPerPack: rows[0].unitsPerPack ?? 1,
      individualProductId: rows[0].individualProductId ?? null,
      packProductId: rows[0].packProductId ?? null,
      quantity: rows[0].quantity ?? 0
    }]
    return attachHasVariants(db, applyPackQuantities(db, base))[0]
  },

  /**
   * Return only the imageUrl for a single product.
   * Used by the renderer to lazily load large base64 images after the product
   * grid has already painted — avoids serialising megabytes of base64 over IPC
   * on every category switch.
   */
  getImageUrl(id: string): string | null {
    const row = getSqlite()
      .prepare('SELECT image_url FROM products WHERE id = ?')
      .get(id) as { image_url: string | null } | undefined
    return row?.image_url ?? null
  },

  /**
   * Paginated product list — used by the Products management screen.
   * Filtering (search + category) is applied in SQL so only the requested
   * page is transferred over IPC, keeping loads fast even with 2000+ products.
   */
  listPaginated(opts: {
    search?: string
    categoryId?: string
    offset: number
    limit: number
  }): { items: ProductWithInventory[]; total: number } {
    const db = getDatabase()
    const { search, categoryId, offset, limit } = opts

    // Build the shared WHERE predicate
    const searchLike = search ? `%${search}%` : null
    const where = and(
      eq(schema.products.isActive, true),
      categoryId ? eq(schema.products.categoryId, categoryId) : undefined,
      searchLike
        ? or(
            like(schema.products.name, searchLike),
            like(schema.products.sku, searchLike),
            like(schema.products.barcode, searchLike)
          )
        : undefined
    )

    // Total count for pagination bar (uses the index — fast)
    const [{ total }] = db
      .select({ total: count() })
      .from(schema.products)
      .where(where)
      .all()

    // Fetch only the requested page
    const rows = db
      .select(productSelect())
      .from(schema.products)
      // Only the product's own (non-variant) inventory row — a variant product
      // has one inventory row per size, and joining on productId alone would
      // fan out into one result row per size instead of one row per product.
      .leftJoin(
        schema.inventory,
        and(eq(schema.products.id, schema.inventory.productId), isNull(schema.inventory.variantId))
      )
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(where)
      .orderBy(schema.products.name)
      .limit(limit)
      .offset(offset)
      .all()

    const base = rows.map((r) => ({
      ...r,
      imageUrl: slimImageUrl(r.imageUrl),
      unitsPerPack: r.unitsPerPack ?? 1,
      individualProductId: r.individualProductId ?? null,
      packProductId: r.packProductId ?? null,
      trackStock: r.trackStock ?? true,
      quantity: r.quantity ?? 0
    }))

    return { items: attachHasVariants(db, applyPackQuantities(db, base)), total }
  },

  /**
   * Create a new product and its inventory record.
   *
   * When unitsPerPack > 1 the system automatically creates a linked individual product:
   *   Name:  ${name} (Individual)
   *   SKU:   ${sku}-IND
   *   Price: basePrice / unitsPerPack  (per-unit price)
   * Inventory is tracked only on the individual product (in individual units).
   * The pack product itself has no inventory record.
   */
  create(input: CreateProductInput): ProductWithInventory {
    const db = getDatabase()
    const packId = generateId()
    const now = new Date().toISOString()
    const unitsPerPack = (input.unitsPerPack && input.unitsPerPack > 1) ? input.unitsPerPack : 1

    if (unitsPerPack > 1) {
      const indId = generateId()

      // 1. Insert the pack product (no inventory record)
      db.insert(schema.products)
        .values({
          id: packId,
          name: input.name,
          sku: input.sku,
          barcode: input.barcode,
          description: input.description,
          categoryId: input.categoryId,
          basePrice: input.basePrice,
          costPrice: input.costPrice,
          imageUrl: input.imageUrl,
          isComposite: false,
          isActive: true,
          taxRate: input.taxRate ?? 0,
          unitsPerPack,
          individualProductId: indId,
          packProductId: null,
          trackStock: input.trackStock ?? true,
          createdAt: now,
          updatedAt: now
        })
        .run()

      // 2. Insert the individual product (owns the shared inventory pool)
      db.insert(schema.products)
        .values({
          id: indId,
          name: input.name + ' (Individual)',
          sku: input.sku + '-IND',
          barcode: null,
          description: input.description ? 'Individual unit from ' + input.name : null,
          categoryId: input.categoryId,
          basePrice: Math.round((input.basePrice / unitsPerPack) * 100) / 100,
          costPrice: input.costPrice != null
            ? Math.round((input.costPrice / unitsPerPack) * 100) / 100
            : null,
          imageUrl: input.imageUrl,
          isComposite: false,
          isActive: true,
          taxRate: input.taxRate ?? 0,
          unitsPerPack: 1,
          individualProductId: null,
          packProductId: packId,
          createdAt: now,
          updatedAt: now
        })
        .run()

      // 3. Inventory record belongs only to the individual product
      db.insert(schema.inventory)
        .values({ id: generateId(), productId: indId, quantity: 0, lowStockThreshold: 5, createdAt: now, updatedAt: now })
        .run()

      return this.getById(packId)!
    }

    // Standard (non-pack) product
    db.insert(schema.products)
      .values({
        id: packId,
        name: input.name,
        sku: input.sku,
        barcode: input.barcode,
        description: input.description,
        categoryId: input.categoryId,
        basePrice: input.basePrice,
        costPrice: input.costPrice,
        imageUrl: input.imageUrl,
        isComposite: input.isComposite ?? false,
        isActive: true,
        taxRate: input.taxRate ?? 0,
        unitsPerPack: 1,
        individualProductId: null,
        packProductId: null,
        trackStock: input.trackStock ?? true,
        createdAt: now,
        updatedAt: now
      })
      .run()
    db.insert(schema.inventory)
      .values({ id: generateId(), productId: packId, quantity: 0, lowStockThreshold: 5, createdAt: now, updatedAt: now })
      .run()
    return this.getById(packId)!
  },

  /** Update an existing product */
  update(id: string, input: UpdateProductInput): ProductWithInventory {
    const db = getDatabase()
    db.update(schema.products)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(schema.products.id, id))
      .run()
    return this.getById(id)!
  },

  /** Soft-delete a product and hard-delete its inventory record. */
  delete(id: string): void {
    const db = getDatabase()
    db.update(schema.products)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(schema.products.id, id))
      .run()
    // Remove the inventory row — no longer relevant once the product is deleted.
    // inventory_adjustments reference product_id directly so history is preserved.
    db.delete(schema.inventory)
      .where(eq(schema.inventory.productId, id))
      .run()
  },

  // Bundle / Composite

  /**
   * Return all components of a composite (bundle) product, joined with component
   * product name and SKU for display.
   */
  getComponents(compositeProductId: string): ProductComponentDetail[] {
    const db = getDatabase()
    const componentProduct = schema.products
    const rows = db
      .select({
        id: schema.productComponents.id,
        compositeProductId: schema.productComponents.compositeProductId,
        componentProductId: schema.productComponents.componentProductId,
        quantity: schema.productComponents.quantity,
        componentProductName: componentProduct.name,
        componentSku: componentProduct.sku
      })
      .from(schema.productComponents)
      .leftJoin(
        componentProduct,
        eq(schema.productComponents.componentProductId, componentProduct.id)
      )
      .where(eq(schema.productComponents.compositeProductId, compositeProductId))
      .all()

    return rows.map((r) => ({
      id: r.id,
      compositeProductId: r.compositeProductId,
      componentProductId: r.componentProductId,
      quantity: r.quantity,
      componentProductName: r.componentProductName ?? '',
      componentSku: r.componentSku ?? ''
    }))
  },

  /**
   * Replace all components of a composite product. Deletes existing rows then
   * inserts the new set atomically.
   */
  setComponents(
    compositeProductId: string,
    components: Array<{ componentProductId: string; quantity: number }>
  ): void {
    const db = getDatabase()
    db.delete(schema.productComponents)
      .where(eq(schema.productComponents.compositeProductId, compositeProductId))
      .run()
    for (const c of components) {
      db.insert(schema.productComponents)
        .values({
          id: generateId(),
          compositeProductId,
          componentProductId: c.componentProductId,
          quantity: c.quantity
        })
        .run()
    }
  },

  // Category operations

  listCategories() {
    const db = getDatabase()
    return db.select().from(schema.categories).orderBy(schema.categories.sortOrder).all()
  },

  createCategory(input: { name: string; color?: string }) {
    const db = getDatabase()
    const id = generateId()
    const now = new Date().toISOString()
    db.insert(schema.categories)
      .values({ id, name: input.name, color: input.color ?? '#3b82f6', createdAt: now, updatedAt: now })
      .run()
    return db.select().from(schema.categories).where(eq(schema.categories.id, id)).get()
  },

  updateCategory(id: string, input: { name?: string; color?: string; sortOrder?: number }) {
    const db = getDatabase()
    db.update(schema.categories)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(schema.categories.id, id))
      .run()
    return db.select().from(schema.categories).where(eq(schema.categories.id, id)).get()
  },

  deleteCategory(id: string) {
    const db = getDatabase()
    db.delete(schema.categories)
      .where(eq(schema.categories.id, id))
      .run()
  },

  // ── Variants ────────────────────────────────────────────────────────────────

  /** List a product's active variants, joined with their own inventory levels. */
  listVariants(productId: string): Array<{
    id: string
    productId: string
    name: string
    sku: string
    barcode: string | null
    priceModifier: number
    isActive: boolean
    quantity: number
    lowStockThreshold: number
  }> {
    const db = getDatabase()
    const rows = db
      .select({
        id: schema.productVariants.id,
        productId: schema.productVariants.productId,
        name: schema.productVariants.name,
        sku: schema.productVariants.sku,
        barcode: schema.productVariants.barcode,
        priceModifier: schema.productVariants.priceModifier,
        isActive: schema.productVariants.isActive,
        quantity: schema.inventory.quantity,
        lowStockThreshold: schema.inventory.lowStockThreshold,
      })
      .from(schema.productVariants)
      .leftJoin(schema.inventory, eq(schema.inventory.variantId, schema.productVariants.id))
      .where(and(eq(schema.productVariants.productId, productId), eq(schema.productVariants.isActive, true)))
      .orderBy(schema.productVariants.name)
      .all()
    return rows.map((r) => ({ ...r, quantity: r.quantity ?? 0, lowStockThreshold: r.lowStockThreshold ?? 5 }))
  },

  /** Create a variant and its own inventory record (mirrors create()'s product+inventory pairing). */
  createVariant(productId: string, input: {
    name: string; sku: string; barcode?: string; priceModifier?: number; isActive?: boolean
    /** Starting stock count for this size — defaults to 0. */
    initialQuantity?: number
  }) {
    const db = getDatabase()
    const id = generateId()
    const now = new Date().toISOString()
    db.insert(schema.productVariants)
      .values({
        id, productId,
        name: input.name,
        sku: input.sku,
        barcode: input.barcode ?? null,
        priceModifier: input.priceModifier ?? 0,
        isActive: input.isActive ?? true,
        createdAt: now, updatedAt: now
      })
      .run()
    db.insert(schema.inventory)
      .values({
        id: generateId(),
        productId,
        variantId: id,
        quantity: input.initialQuantity ?? 0,
        lowStockThreshold: 5,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return db.select().from(schema.productVariants)
      .where(eq(schema.productVariants.id, id)).get()
  },

  updateVariant(variantId: string, input: {
    name?: string; sku?: string; barcode?: string; priceModifier?: number; isActive?: boolean
  }) {
    const db = getDatabase()
    db.update(schema.productVariants)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(schema.productVariants.id, variantId))
      .run()
    return db.select().from(schema.productVariants)
      .where(eq(schema.productVariants.id, variantId)).get()
  },

  /**
   * Soft-delete a variant and remove its inventory record — mirrors delete()'s
   * product-level convention. Not a hard delete: historical order_items may
   * still reference this variant_id.
   */
  deleteVariant(variantId: string): void {
    const db = getDatabase()
    db.update(schema.productVariants)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(schema.productVariants.id, variantId))
      .run()
    db.delete(schema.inventory)
      .where(eq(schema.inventory.variantId, variantId))
      .run()
  }
}
