import { eq, sql } from 'drizzle-orm'
import { getDatabase } from '../database/connection'
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
