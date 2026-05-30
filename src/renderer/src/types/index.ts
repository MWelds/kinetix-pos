/** Shared domain types for the renderer */

export interface Product {
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
  /** Units of the individual item contained in one pack (1 = standalone/individual, >1 = pack) */
  unitsPerPack: number
  /** ID of the auto-created individual product linked to this pack (null for non-pack products) */
  individualProductId: string | null
  /** ID of the parent pack product if this is an auto-created individual (null otherwise) */
  packProductId: string | null
  /** Consignment vendor ID (null = own stock) */
  vendorId: string | null
  /** Per-unit cost owed to vendor on sale */
  vendorCost: number | null
  /**
   * When false the product is a non-physical service item (e.g. "Print Services").
   * Out-of-stock checks and stock deductions are skipped.
   */
  trackStock: boolean
  createdAt: string
  updatedAt: string
  /** Display quantity: boxes for pack products, individual units for everything else */
  quantity: number
  categoryName: string | null
  categoryColor: string | null
}

export interface Category {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CartItem {
  id: string // local cart item ID
  productId: string
  variantId?: string
  productName: string
  variantName?: string
  sku: string
  quantity: number
  unitPrice: number
  discountAmount: number
  notes?: string
  taxRate: number
}

export interface Customer {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  address: string | null
  loyaltyPoints: number
  storeCredit: number
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface StaffMember {
  id: string
  firstName: string
  lastName: string
  email: string | null
  role: 'cashier' | 'manager' | 'admin'
  isActive: boolean
  canAccessDashboard: boolean
  createdAt: string
}

export interface Shift {
  id: string
  staffId: string
  openedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  status: 'open' | 'closed'
}

export interface ShiftWithStaff extends Shift {
  notes: string | null
  staffName: string
}

export interface ShiftOrder {
  id: string
  orderNumber: string
  total: number
  status: string
  createdAt: string
}

export interface AuditEntry {
  id: string
  staffId: string | null
  action: string
  entityType: string
  entityId: string | null
  details: string | null
  createdAt: string
}

export interface Order {
  id: string
  orderNumber: string
  status: 'pending' | 'held' | 'completed' | 'refunded' | 'voided'
  customerId: string | null
  staffId: string | null
  shiftId: string | null
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  notes: string | null
  manualDiscountType: 'percentage' | 'fixed' | null
  manualDiscountValue: number | null
  loyaltyPointsEarned: number
  loyaltyPointsRedeemed: number
  createdAt: string
  updatedAt: string
}

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  variantId: string | null
  productName: string
  variantName: string | null
  sku: string
  quantity: number
  unitPrice: number
  discountAmount: number
  taxAmount: number
  lineTotal: number
  notes: string | null
}

export interface Payment {
  id: string
  orderId: string
  method: 'cash' | 'card' | 'store_credit' | 'gift_card' | 'layaway'
  amount: number
  reference: string | null
  changeGiven: number | null
  status: 'completed' | 'pending' | 'failed'
  createdAt: string
}

export interface InventoryItem {
  id: string
  productId: string
  variantId: string | null
  /** Raw quantity in individual units (always individual units, regardless of product type) */
  quantity: number
  lowStockThreshold: number
  productName: string | null
  sku: string | null
  categoryName: string | null
  imageUrl: string | null
  /** 1 for standalone/individual products; >1 for pack products */
  unitsPerPack: number
  /** ID of the auto-created individual product linked to this pack (null for non-pack products) */
  individualProductId: string | null
  /** ID of the parent pack product if this is an auto-created individual (null otherwise) */
  packProductId: string | null
  /** unitsPerPack of the parent pack (used for pack-stock display); null when not a pack individual */
  packUnitsPerPack: number | null
}

export interface Vendor {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  /** Total earned from completed sales (vendorCost × qty) */
  totalEarned: number
  /** Total already paid out */
  totalPaid: number
  /** Outstanding balance (totalEarned - totalPaid) */
  balanceOwed: number
}

export interface VendorPayout {
  id: string
  vendorId: string
  amount: number
  note: string | null
  staffId: string | null
  createdAt: string
}

/** Daily cost-of-goods-sold breakdown per vendor, returned by the EOD report. */
export interface VendorPayable {
  vendorId: string
  vendorName: string
  unitsSold: number
  /** Sum of (quantity × vendor_cost) for all items sold today belonging to this vendor */
  cogsToday: number
}

