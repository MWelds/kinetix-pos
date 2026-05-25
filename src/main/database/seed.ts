import { getDatabase } from './connection'
import * as schema from './schema'
import { generateId } from '../lib/id'
import { hashPin } from '../lib/pin'

/**
 * Seeds the database with demo data if it is empty.
 * Idempotent — checks for existing records before inserting.
 *
 * ⚠  PINs are hashed with hashPin() before insertion so the seed data never
 *    contains plaintext credentials.  The login screen still accepts the plain
 *    4-digit strings (1234 / 5678 / 0000); the service layer hashes on compare.
 */
export function seedDatabase(): void {
  const db = getDatabase()

  // Check if already seeded
  const existingStaff = db.select().from(schema.staff).limit(1).get()
  if (existingStaff) return

  const now = new Date().toISOString()

  // Staff — PINs hashed at seed time
  const adminId = generateId()
  const cashierId = generateId()
  const managerId = generateId()

  db.insert(schema.staff).values([
    {
      id: adminId,
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@store.com',
      pin: hashPin('1234'),
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: managerId,
      firstName: 'Jane',
      lastName: 'Manager',
      email: 'jane@store.com',
      pin: hashPin('5678'),
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: cashierId,
      firstName: 'John',
      lastName: 'Cashier',
      email: 'john@store.com',
      pin: hashPin('0000'),
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now
    }
  ]).run()

  // Categories
  const catBevId = generateId()
  const catFoodId = generateId()
  const catElecId = generateId()
  const catClothId = generateId()

  db.insert(schema.categories).values([
    { id: catBevId,   name: 'Beverages',   color: '#3b82f6', sortOrder: 0, createdAt: now, updatedAt: now },
    { id: catFoodId,  name: 'Food',        color: '#10b981', sortOrder: 1, createdAt: now, updatedAt: now },
    { id: catElecId,  name: 'Electronics', color: '#8b5cf6', sortOrder: 2, createdAt: now, updatedAt: now },
    { id: catClothId, name: 'Clothing',    color: '#f59e0b', sortOrder: 3, createdAt: now, updatedAt: now }
  ]).run()

  // Products
  const products = [
    { id: generateId(), name: 'Coffee',          sku: 'BEV-001', barcode: '111001', categoryId: catBevId,   basePrice: 3.50,  costPrice: 0.80,  taxRate: 0.08 },
    { id: generateId(), name: 'Green Tea',        sku: 'BEV-002', barcode: '111002', categoryId: catBevId,   basePrice: 2.75,  costPrice: 0.50,  taxRate: 0.08 },
    { id: generateId(), name: 'Orange Juice',     sku: 'BEV-003', barcode: '111003', categoryId: catBevId,   basePrice: 4.00,  costPrice: 1.20,  taxRate: 0.08 },
    { id: generateId(), name: 'Water Bottle',     sku: 'BEV-004', barcode: '111004', categoryId: catBevId,   basePrice: 1.50,  costPrice: 0.30,  taxRate: 0.08 },
    { id: generateId(), name: 'Sandwich',         sku: 'FOOD-001', barcode: '222001', categoryId: catFoodId, basePrice: 8.99,  costPrice: 3.00,  taxRate: 0.08 },
    { id: generateId(), name: 'Caesar Salad',     sku: 'FOOD-002', barcode: '222002', categoryId: catFoodId, basePrice: 12.50, costPrice: 4.50,  taxRate: 0.08 },
    { id: generateId(), name: 'Chocolate Cake',   sku: 'FOOD-003', barcode: '222003', categoryId: catFoodId, basePrice: 5.50,  costPrice: 2.00,  taxRate: 0.08 },
    { id: generateId(), name: 'Chips (Large)',    sku: 'FOOD-004', barcode: '222004', categoryId: catFoodId, basePrice: 3.25,  costPrice: 1.00,  taxRate: 0.08 },
    { id: generateId(), name: 'USB-C Cable',      sku: 'ELEC-001', barcode: '333001', categoryId: catElecId, basePrice: 19.99, costPrice: 5.00,  taxRate: 0.10 },
    { id: generateId(), name: 'Phone Case',       sku: 'ELEC-002', barcode: '333002', categoryId: catElecId, basePrice: 24.99, costPrice: 7.00,  taxRate: 0.10 },
    { id: generateId(), name: 'Wireless Earbuds', sku: 'ELEC-003', barcode: '333003', categoryId: catElecId, basePrice: 59.99, costPrice: 20.00, taxRate: 0.10 },
    { id: generateId(), name: 'Power Bank',       sku: 'ELEC-004', barcode: '333004', categoryId: catElecId, basePrice: 39.99, costPrice: 15.00, taxRate: 0.10 },
    { id: generateId(), name: 'T-Shirt (M)',      sku: 'CLO-001', barcode: '444001', categoryId: catClothId, basePrice: 29.99, costPrice: 8.00,  taxRate: 0.10 },
    { id: generateId(), name: 'Hoodie (L)',       sku: 'CLO-002', barcode: '444002', categoryId: catClothId, basePrice: 59.99, costPrice: 18.00, taxRate: 0.10 },
    { id: generateId(), name: 'Cap',              sku: 'CLO-003', barcode: '444003', categoryId: catClothId, basePrice: 19.99, costPrice: 5.00,  taxRate: 0.10 }
  ]

  for (const p of products) {
    db.insert(schema.products).values({
      ...p,
      isComposite: false,
      isActive: true,
      createdAt: now,
      updatedAt: now
    }).run()

    db.insert(schema.inventory).values({
      id: generateId(),
      productId: p.id,
      quantity: Math.floor(Math.random() * 50) + 10,
      lowStockThreshold: 5,
      createdAt: now,
      updatedAt: now
    }).run()
  }

  // Customers
  db.insert(schema.customers).values([
    {
      id: generateId(),
      firstName: 'Alice',
      lastName: 'Johnson',
      email: 'alice@example.com',
      phone: '555-0101',
      loyaltyPoints: 120,
      storeCredit: 10.00,
      createdAt: now,
      updatedAt: now
    },
    {
      id: generateId(),
      firstName: 'Bob',
      lastName: 'Smith',
      email: 'bob@example.com',
      phone: '555-0102',
      loyaltyPoints: 45,
      storeCredit: 0,
      createdAt: now,
      updatedAt: now
    },
    {
      id: generateId(),
      firstName: 'Carol',
      lastName: 'Williams',
      email: 'carol@example.com',
      phone: '555-0103',
      loyaltyPoints: 250,
      storeCredit: 25.00,
      createdAt: now,
      updatedAt: now
    }
  ]).run()

  // Settings
  const defaultSettings = [
    { key: 'storeName',              value: 'Kinetix POS' },
    { key: 'storeAddress',           value: '123 Main St, City, State 12345' },
    { key: 'storePhone',             value: '(555) 123-4567' },
    { key: 'taxRate',                value: '0.08' },
    { key: 'taxName',                value: 'Sales Tax' },
    { key: 'taxEnabled',             value: 'true' },
    { key: 'currency',               value: 'USD' },
    { key: 'currencySymbol',         value: '$' },
    { key: 'kydToUsdRate',           value: '1.20' },
    { key: 'receiptFooter',          value: 'Thank you for your purchase!' },
    { key: 'loyaltyPointsPerDollar', value: '1' }
  ]

  for (const s of defaultSettings) {
    db.insert(schema.settings).values({ ...s, updatedAt: now }).run()
  }
}
