import {
  sqliteTable, text, integer, real
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const timestamps = {
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
}

// ─── Categories ───────────────────────────────────────────────────────────────
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#3b82f6'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps
})

// ─── Products ─────────────────────────────────────────────────────────────────
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').notNull().unique(),
  barcode: text('barcode'),
  description: text('description'),
  categoryId: text('category_id').references(() => categories.id),
  basePrice: real('base_price').notNull(),
  costPrice: real('cost_price'),
  imageUrl: text('image_url'),
  isComposite: integer('is_composite', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  taxRate: real('tax_rate').notNull().default(0),
  unitsPerPack: integer('units_per_pack').notNull().default(1),
  individualProductId: text('individual_product_id'),
  packProductId: text('pack_product_id'),
  vendorId: text('vendor_id'),
  vendorCost: real('vendor_cost'),
  trackStock: integer('track_stock', { mode: 'boolean' }).notNull().default(true),
  ...timestamps
})

// ─── Product Variants ─────────────────────────────────────────────────────────
export const productVariants = sqliteTable('product_variants', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id),
  name: text('name').notNull(),
  sku: text('sku').notNull().unique(),
  barcode: text('barcode'),
  priceModifier: real('price_modifier').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps
})

// ─── Product Components (for composite/bundle products) ───────────────────────
export const productComponents = sqliteTable('product_components', {
  id: text('id').primaryKey(),
  compositeProductId: text('composite_product_id').notNull().references(() => products.id),
  componentProductId: text('component_product_id').notNull().references(() => products.id),
  quantity: real('quantity').notNull().default(1),
  // V8: added so sync can filter by timestamp
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
})

// ─── Inventory ────────────────────────────────────────────────────────────────
export const inventory = sqliteTable('inventory', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id),
  variantId: text('variant_id').references(() => productVariants.id),
  quantity: real('quantity').notNull().default(0),
  lowStockThreshold: real('low_stock_threshold').notNull().default(5),
  ...timestamps
})

// ─── Inventory Adjustments ────────────────────────────────────────────────────
export const inventoryAdjustments = sqliteTable('inventory_adjustments', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id),
  variantId: text('variant_id').references(() => productVariants.id),
  type: text('type').notNull(), // 'receive'|'transfer'|'loss'|'adjustment'
  quantity: real('quantity').notNull(),
  note: text('note'),
  staffId: text('staff_id'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
})

// ─── Customers ────────────────────────────────────────────────────────────────
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  loyaltyPoints: integer('loyalty_points').notNull().default(0),
  storeCredit: real('store_credit').notNull().default(0),
  notes: text('notes'),
  ...timestamps
})

// ─── Staff ────────────────────────────────────────────────────────────────────
export const staff = sqliteTable('staff', {
  id: text('id').primaryKey(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email'),
  pin: text('pin').notNull(), // SHA-256 hashed
  role: text('role').notNull().default('cashier'), // 'cashier'|'manager'|'admin'
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps
})

// ─── Shifts ───────────────────────────────────────────────────────────────────
export const shifts = sqliteTable('shifts', {
  id: text('id').primaryKey(),
  staffId: text('staff_id').notNull().references(() => staff.id),
  openedAt: text('opened_at').notNull(),
  closedAt: text('closed_at'),
  openingCash: real('opening_cash').notNull().default(0),
  closingCash: real('closing_cash'),
  notes: text('notes'),
  status: text('status').notNull().default('open') // 'open'|'closed'
})

// ─── Discount Rules ───────────────────────────────────────────────────────────
export const discountRules = sqliteTable('discount_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'percentage' | 'fixed' | 'bogo' | 'category'
  value: real('value').notNull(),
  minOrderAmount: real('min_order_amount'),
  categoryId: text('category_id').references(() => categories.id),
  productId: text('product_id').references(() => products.id),
  couponCode: text('coupon_code'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  validFrom: text('valid_from'),
  validUntil: text('valid_until'),
  ...timestamps
})

// ─── Orders ───────────────────────────────────────────────────────────────────
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  orderNumber: text('order_number').notNull().unique(),
  status: text('status').notNull().default('pending'),
  orderType: text('order_type').notNull().default('instore'),
  customerId: text('customer_id').references(() => customers.id),
  staffId: text('staff_id').references(() => staff.id),
  shiftId: text('shift_id').references(() => shifts.id),
  subtotal: real('subtotal').notNull().default(0),
  discountAmount: real('discount_amount').notNull().default(0),
  taxAmount: real('tax_amount').notNull().default(0),
  total: real('total').notNull().default(0),
  notes: text('notes'),
  discountId: text('discount_id').references(() => discountRules.id),
  manualDiscountType: text('manual_discount_type'),
  manualDiscountValue: real('manual_discount_value'),
  loyaltyPointsEarned: integer('loyalty_points_earned').notNull().default(0),
  loyaltyPointsRedeemed: integer('loyalty_points_redeemed').notNull().default(0),
  syncStatus: text('sync_status').notNull().default('pending'),
  terminalId: text('terminal_id').notNull().default('unknown'),
  ...timestamps
})

// ─── Order Items ──────────────────────────────────────────────────────────────
export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id),
  productId: text('product_id').notNull().references(() => products.id),
  variantId: text('variant_id').references(() => productVariants.id),
  productName: text('product_name').notNull(),
  variantName: text('variant_name'),
  sku: text('sku').notNull(),
  quantity: real('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  discountAmount: real('discount_amount').notNull().default(0),
  taxAmount: real('tax_amount').notNull().default(0),
  lineTotal: real('line_total').notNull(),
  notes: text('notes'),
  ...timestamps
})

// ─── Payments ─────────────────────────────────────────────────────────────────
export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id),
  method: text('method').notNull(),
  amount: real('amount').notNull(),
  reference: text('reference'),
  changeGiven: real('change_given'),
  status: text('status').notNull().default('completed'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
})

// ─── Gift Cards ───────────────────────────────────────────────────────────────
export const giftCards = sqliteTable('gift_cards', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  balance: real('balance').notNull(),
  initialBalance: real('initial_balance').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  // V8: added so HAS_UPDATED_AT sync set is consistent
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
})

// ─── Audit Log ────────────────────────────────────────────────────────────────
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  staffId: text('staff_id').references(() => staff.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  details: text('details'), // JSON string
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
})

// ─── App Settings ─────────────────────────────────────────────────────────────
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
})

// ─── Vendors (consignment / reselling) ───────────────────────────────────────
export const vendors = sqliteTable('vendors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  ...timestamps
})

// ─── Vendor Payouts ───────────────────────────────────────────────────────────
export const vendorPayouts = sqliteTable('vendor_payouts', {
  id: text('id').primaryKey(),
  vendorId: text('vendor_id').notNull().references(() => vendors.id),
  amount: real('amount').notNull(),
  note: text('note'),
  staffId: text('staff_id'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
})
