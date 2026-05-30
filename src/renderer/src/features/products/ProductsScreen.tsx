import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, Edit, Trash2, Package, Layers, FolderOpen, X, Check, ImagePlus, Store, Loader, Tag, CheckSquare } from 'lucide-react'
import { api } from '../../lib/api'
import { CsvImportExportBar } from '../../components/ui/CsvImportExportBar'
import { Input, Button, Badge, Modal, PageSpinner } from '../../components/ui'
import { useCurrencyStore } from '../../stores/currency.store'
import { useUiStore } from '../../stores/ui.store'
import type { Product, Category, ProductComponent, Vendor } from '../../types'
import { PriceTagModal } from './PriceTagModal'

// ─── Preset category colours ──────────────────────────────────────────────────
const PRESET_COLORS = [
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#06b6d4', '#64748b', '#1e293b'
]

// ─── Category Manager Modal ───────────────────────────────────────────────────

interface CategoryManagerProps {
  onClose: () => void
  onChanged: () => void
}

function CategoryManagerModal({ onClose, onChanged }: CategoryManagerProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(PRESET_COLORS[0])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [saving, setSaving] = useState(false)
  const showToast = useUiStore((s) => s.showToast)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setCategories(await api.categories.list())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await api.categories.create({ name: newName.trim(), color: newColor })
      setNewName('')
      setNewColor(PRESET_COLORS[0])
      setAdding(false)
      showToast('Category added', 'success')
      await load()
      onChanged()
    } finally { setSaving(false) }
  }

  async function handleUpdate() {
    if (!editId || !editName.trim()) return
    setSaving(true)
    try {
      await api.categories.update(editId, { name: editName.trim(), color: editColor })
      setEditId(null)
      showToast('Category updated', 'success')
      await load()
      onChanged()
    } finally { setSaving(false) }
  }

  async function handleDelete(cat: Category) {
    if (!confirm(`Delete category "${cat.name}"? Products in this category will become uncategorised.`)) return
    await api.categories.delete(cat.id)
    showToast('Category deleted', 'success')
    await load()
    onChanged()
  }

  function startEdit(cat: Category) {
    setEditId(cat.id)
    setEditName(cat.name)
    setEditColor(cat.color)
    setAdding(false)
  }

  return (
    <Modal isOpen onClose={onClose} title="Manage Categories" size="md">
      <div className="space-y-3">
        {loading ? (
          <div className="py-8 flex justify-center"><PageSpinner /></div>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
            {categories.map((cat) => (
              <div key={cat.id} className="px-4 py-3 bg-white hover:bg-gray-50">
                {editId === cat.id ? (
                  <div className="space-y-2">
                    <input
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleUpdate()}
                    />
                    <ColorPicker value={editColor} onChange={setEditColor} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleUpdate} loading={saving} icon={<Check size={13} />}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" icon={<Edit size={13} />} onClick={() => startEdit(cat)}>Edit</Button>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => handleDelete(cat)}>Delete</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {categories.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-400">No categories yet</div>
            )}
          </div>
        )}

        {/* Add new category */}
        {adding ? (
          <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-2">
            <p className="text-sm font-medium text-gray-700">New Category</p>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <ColorPicker value={newColor} onChange={setNewColor} />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} loading={saving} icon={<Check size={13} />}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setAdding(true); setEditId(null) }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            <Plus size={15} /> Add Category
          </button>
        )}
      </div>
    </Modal>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
            value === c ? 'border-gray-800 scale-110' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
    </div>
  )
}

// ─── Products Screen ──────────────────────────────────────────────────────────

export function ProductsScreen() {
  const fmtRaw = useCurrencyStore((s) => s.fmtRaw)
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showCatManager, setShowCatManager] = useState(false)
  const [tagProduct, setTagProduct] = useState<Product | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchTagProducts, setBatchTagProducts] = useState<Product[] | null>(null)
  const showToast = useUiStore((s) => s.showToast)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [prods, cats] = await Promise.all([api.products.list(), api.categories.list()])
      setProducts(prods)
      setCategories(cats)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete(product: Product) {
    if (!confirm(`Delete "${product.name}"?`)) return
    await api.products.delete(product.id)
    showToast('Product deleted', 'success')
    load()
  }

  async function handleBatchDelete() {
    const count = selectedIds.size
    if (!confirm(`Delete ${count} product${count !== 1 ? 's' : ''}? This cannot be undone.`)) return
    await Promise.all([...selectedIds].map((id) => api.products.delete(id)))
    showToast(`${count} product${count !== 1 ? 's' : ''} deleted`, 'success')
    setSelectedIds(new Set())
    load()
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id))
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((p) => p.id)))
  }

  const filtered = products.filter((p) => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
    const matchCat = !filterCategory || p.categoryId === filterCategory
    return matchSearch && matchCat
  })

  const PRODUCT_CSV_TEMPLATE = [
    'name,sku,barcode,description,category_name,price,cost_price,tax_rate,stock_quantity,low_stock_threshold,is_active,image_url',
    'Example Product,PROD-001,123456789,A sample product,General,9.99,4.00,0.08,50,5,true,https://example.com/image.jpg'
  ].join('\n')

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Products</h1>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon={<FolderOpen size={15} />}
              onClick={() => setShowCatManager(true)}
            >
              Categories
            </Button>
            <Button
              icon={<Plus size={16} />}
              onClick={() => { setEditProduct(null); setShowForm(true) }}
            >
              Add Product
            </Button>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search size={14} />}
            className="max-w-sm"
          />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="mt-4">
          <CsvImportExportBar
            entityLabel="Products"
            exportFilename="products-export.csv"
            onImport={async (csvText) => { const r = await api.csv.importProducts(csvText); await load(); return r }}
            onExport={async () => api.csv.exportProducts()}
            templateCsv={PRODUCT_CSV_TEMPLATE}
            templateFilename="products-template.csv"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? <PageSpinner /> : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id))}
                      ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && !filtered.every((p) => selectedIds.has(p.id)) }}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      aria-label="Select all products"
                    />
                  </th>
                  {['Product', 'SKU', 'Category', 'Price', 'Stock', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((product) => (
                  <tr key={product.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(product.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        aria-label={`Select ${product.name}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {product.imageUrl && product.imageUrl !== '__local__' ? (
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            loading="lazy"
                            decoding="async"
                            className="w-8 h-8 rounded-lg object-cover shrink-0 border border-gray-100"
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: product.categoryColor ? `${product.categoryColor}20` : '#f1f5f9' }}
                          >
                            {product.isComposite
                              ? <Layers size={14} style={{ color: product.categoryColor ?? '#94a3b8' }} />
                              : <Package size={14} style={{ color: product.categoryColor ?? '#94a3b8' }} />
                            }
                          </div>
                        )}
                        <div>
                          <span className="text-sm font-medium text-gray-900">{product.name}</span>
                          {product.isComposite && (
                            <Badge color="purple" className="ml-2">Bundle</Badge>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{product.sku}</td>
                    <td className="px-4 py-3">
                      {product.categoryName ? (
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${product.categoryColor ?? '#3b82f6'}18`,
                            color: product.categoryColor ?? '#3b82f6'
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: product.categoryColor ?? '#3b82f6' }} />
                          {product.categoryName}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">{fmtRaw(product.basePrice)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-medium ${product.quantity <= 5 ? 'text-red-600' : 'text-gray-900'}`}>
                        {product.quantity}
                        {product.quantity <= 5 && product.quantity > 0 && (
                          <span className="text-xs text-red-400 ml-1">low</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={product.isActive ? 'green' : 'gray'}>
                        {product.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Edit size={14} />}
                          onClick={() => { setEditProduct(product); setShowForm(true) }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Tag size={14} />}
                          onClick={() => setTagProduct(product)}
                        >
                          Tag
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={14} />}
                          onClick={() => handleDelete(product)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <div className="text-center py-12 text-gray-400 text-sm">No products found</div>
            )}
          </div>
        )}
      </div>

      {showForm && (
        <ProductFormModal
          product={editProduct}
          categories={categories}
          onClose={() => setShowForm(false)}
          onSave={() => {
            setShowForm(false)
            load()
            showToast(editProduct ? 'Product updated' : 'Product created', 'success')
          }}
        />
      )}

      {showCatManager && (
        <CategoryManagerModal
          onClose={() => setShowCatManager(false)}
          onChanged={load}
        />
      )}

      {tagProduct && (
        <PriceTagModal
          products={[tagProduct]}
          onClose={() => setTagProduct(null)}
        />
      )}

      {batchTagProducts && batchTagProducts.length > 0 && (
        <PriceTagModal
          products={batchTagProducts}
          onClose={() => setBatchTagProducts(null)}
        />
      )}

      {/* Floating multi-select action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3">
          <span className="text-sm font-medium text-gray-300">
            {selectedIds.size} selected
          </span>
          <div className="w-px h-4 bg-gray-700" />
          <button
            onClick={() => setBatchTagProducts(filtered.filter((p) => selectedIds.has(p.id)))}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Tag size={14} /> Print Tags
          </button>
          <button
            onClick={handleBatchDelete}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Trash2 size={14} /> Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"
            title="Clear selection"
            aria-label="Clear selection"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Product Form Modal ───────────────────────────────────────────────────────

interface ProductFormModalProps {
  product: Product | null
  categories: Category[]
  onClose: () => void
  onSave: () => void
}

interface ComponentRow {
  componentProductId: string
  componentProductName: string
  componentSku: string
  quantity: number
}

function ProductFormModal({ product, categories, onClose, onSave }: ProductFormModalProps) {
  const fmtRaw = useCurrencyStore((s) => s.fmtRaw)
  const [form, setForm] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    categoryId: product?.categoryId ?? '',
    basePrice: String(product?.basePrice ?? ''),
    costPrice: String(product?.costPrice ?? ''),
    taxRate: String(product?.taxRate ?? '0.08'),
    description: product?.description ?? '',
    isComposite: product?.isComposite ?? false,
    unitsPerPack: String(product?.unitsPerPack && product.unitsPerPack > 1 ? product.unitsPerPack : ''),
    imageUrl: product?.imageUrl ?? '',
    vendorId: product?.vendorId ?? '',
    vendorCost: String(product?.vendorCost ?? ''),
    trackStock: product?.trackStock ?? true
  })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Bundle components state
  const [components, setComponents] = useState<ComponentRow[]>([])
  const [compSearch, setCompSearch] = useState('')
  const [compResults, setCompResults] = useState<Product[]>([])
  const [compSearching, setCompSearching] = useState(false)
  const [componentsLoaded, setComponentsLoaded] = useState(false)

  // Vendor list for consignment dropdown
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [imageUploading, setImageUploading] = useState(false)

  useEffect(() => {
    api.vendors.list().then(setVendors).catch(() => {})
  }, [])

  /** Open file picker and store image as base64 data URL in form state */
  async function handleImageUpload() {
    setImageUploading(true)
    try {
      const dataUrl = await api.images.pick()
      if (dataUrl) setForm((p) => ({ ...p, imageUrl: dataUrl }))
    } finally {
      setImageUploading(false)
    }
  }

  // Load existing components when editing a composite product
  useEffect(() => {
    if (product?.isComposite && product.id && !componentsLoaded) {
      api.products.getComponents(product.id).then((comps: ProductComponent[]) => {
        setComponents(
          comps.map((c) => ({
            componentProductId: c.componentProductId,
            componentProductName: c.componentProductName,
            componentSku: c.componentSku,
            quantity: c.quantity
          }))
        )
        setComponentsLoaded(true)
      })
    }
  }, [product, componentsLoaded])

  // Debounced component search
  useEffect(() => {
    if (!compSearch.trim() || compSearch.length < 2) {
      setCompResults([])
      return
    }
    const timer = setTimeout(async () => {
      setCompSearching(true)
      try {
        const results = await api.products.search(compSearch)
        const addedIds = new Set(components.map((c) => c.componentProductId))
        setCompResults(
          results.filter(
            (r) => r.id !== product?.id && !addedIds.has(r.id) && !r.isComposite
          )
        )
      } finally {
        setCompSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [compSearch, components, product])

  function addComponent(p: Product) {
    setComponents((prev) => [
      ...prev,
      {
        componentProductId: p.id,
        componentProductName: p.name,
        componentSku: p.sku,
        quantity: 1
      }
    ])
    setCompSearch('')
    setCompResults([])
  }

  function removeComponent(productId: string) {
    setComponents((prev) => prev.filter((c) => c.componentProductId !== productId))
  }

  function updateComponentQty(productId: string, qty: number) {
    setComponents((prev) =>
      prev.map((c) => c.componentProductId === productId ? { ...c, quantity: Math.max(0.001, qty) } : c)
    )
  }

  function validate() {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!form.sku.trim()) e.sku = 'SKU is required'
    if (!form.basePrice || isNaN(parseFloat(form.basePrice))) e.basePrice = 'Valid price required'
    if (form.isComposite && components.length === 0) e.components = 'Add at least one component'
    return e
  }

  async function handleSave() {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setSaving(true)
    try {
      const parsedUnitsPerPack = parseInt(form.unitsPerPack, 10)
      const data = {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode || undefined,
        categoryId: form.categoryId || undefined,
        basePrice: parseFloat(form.basePrice),
        costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined,
        taxRate: parseFloat(form.taxRate) || 0,
        description: form.description || undefined,
        isComposite: form.isComposite,
        unitsPerPack: (!isNaN(parsedUnitsPerPack) && parsedUnitsPerPack > 1) ? parsedUnitsPerPack : 1,
        imageUrl: form.imageUrl || null,
        vendorId: form.vendorId || undefined,
        vendorCost: form.vendorId && form.vendorCost ? parseFloat(form.vendorCost) : undefined,
        trackStock: form.trackStock
      }
      let savedId = product?.id
      if (product) {
        await api.products.update(product.id, data)
      } else {
        const created = await api.products.create(data)
        savedId = created.id
      }
      if (form.isComposite && savedId) {
        await api.products.setComponents(
          savedId,
          components.map((c) => ({ componentProductId: c.componentProductId, quantity: c.quantity }))
        )
      } else if (!form.isComposite && savedId && product?.isComposite) {
        await api.products.setComponents(savedId, [])
      }
      onSave()
    } finally { setSaving(false) }
  }

  const f =
    (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [field]: e.target.value }))

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={product ? 'Edit Product' : 'New Product'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save Product</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Name *" value={form.name} onChange={f('name')} error={errors.name} />
          <Input label="SKU *" value={form.sku} onChange={f('sku')} error={errors.sku} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Barcode" value={form.barcode} onChange={f('barcode')} />
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Category</label>
            <select
              value={form.categoryId}
              onChange={f('categoryId')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Price ($) *" type="number" step="0.01" value={form.basePrice} onChange={f('basePrice')} error={errors.basePrice} />
          <Input label="Cost ($)" type="number" step="0.01" value={form.costPrice} onChange={f('costPrice')} />
          <Input label="Tax Rate" type="number" step="0.001" value={form.taxRate} onChange={f('taxRate')} />
        </div>

        {/* Product image */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">Product Image</label>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
              {form.imageUrl ? (
                <img src={form.imageUrl} alt="Product" className="w-full h-full object-contain" />
              ) : (
                <Package size={28} className="text-gray-300" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleImageUpload}
                disabled={imageUploading}
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 min-h-[44px]"
              >
                {imageUploading ? <Loader size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {imageUploading ? 'Loading…' : 'Choose Image'}
              </button>
              {form.imageUrl && (
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, imageUrl: '' }))}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:text-red-700"
                >
                  <X size={12} /> Remove image
                </button>
              )}
              <p className="text-xs text-gray-400">JPG, PNG, WebP · Shown on sales screen</p>
            </div>
          </div>
        </div>

        {/* Pack size */}
        {!product && !form.isComposite && (
          <div className="border border-amber-200 rounded-xl p-4 bg-amber-50">
            <p className="text-sm font-semibold text-amber-900 mb-1">Pack / Bulk Product (optional)</p>
            <p className="text-xs text-amber-700 mb-3">
              If this product is sold in packs (e.g. a box of 100 spoons), enter the number of individual
              units per pack. The system will automatically create a linked <strong>Individual</strong> product
              so you can also sell single units. Both share the same inventory pool.
            </p>
            <div className="flex items-center gap-3">
              <div className="w-40">
                <Input
                  label="Units per pack"
                  type="number"
                  min="2"
                  step="1"
                  value={form.unitsPerPack}
                  onChange={f('unitsPerPack')}
                  placeholder="e.g. 100"
                />
              </div>
              {form.unitsPerPack && parseInt(form.unitsPerPack, 10) > 1 && (
                <div className="mt-5 text-xs text-amber-800 bg-amber-100 rounded-lg px-3 py-2 leading-relaxed">
                  Will create: <strong>{form.name || 'Product'} (Individual)</strong> at{' '}
                  <strong>
                    ${form.basePrice
                      ? (parseFloat(form.basePrice) / parseInt(form.unitsPerPack, 10)).toFixed(2)
                      : '—'}
                  </strong>{' '}
                  each
                </div>
              )}
            </div>
          </div>
        )}
        {product && (product.unitsPerPack ?? 1) > 1 && (
          <div className="border border-blue-200 rounded-xl p-3 bg-blue-50 text-xs text-blue-800">
            📦 Pack product — {product.unitsPerPack} units per pack. Inventory is shared with the linked individual product.
            Pack size cannot be changed after creation.
          </div>
        )}

        {/* Vendor / Consignment */}
        <div className="border border-green-200 rounded-xl p-4 bg-green-50">
          <div className="flex items-center gap-2 mb-1">
            <Store size={14} className="text-green-700" />
            <p className="text-sm font-semibold text-green-900">Consignment / Vendor Product (optional)</p>
          </div>
          <p className="text-xs text-green-700 mb-3">
            If you are selling this on behalf of a vendor, select them and enter their cut per unit.
            Every sale will automatically accrue that amount to the vendor's balance so you know exactly what to pay at the end of the week.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Vendor</label>
              <select
                value={form.vendorId}
                onChange={(e) => setForm((p) => ({ ...p, vendorId: e.target.value, vendorCost: '' }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white"
              >
                <option value="">Not a consignment product</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            {form.vendorId && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Vendor cost per unit ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.vendorCost}
                  onChange={(e) => setForm((p) => ({ ...p, vendorCost: e.target.value }))}
                  placeholder="e.g. 10.00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]"
                />
              </div>
            )}
          </div>
          {form.vendorId && form.vendorCost && form.basePrice && (
            <div className="mt-2 text-xs text-green-800 bg-green-100 rounded-lg px-3 py-2">
              Store keeps{' '}
              <strong>
                {fmtRaw(parseFloat(form.basePrice || '0') - parseFloat(form.vendorCost || '0'))}
              </strong>{' '}
              per unit · Vendor earns{' '}
              <strong>{fmtRaw(parseFloat(form.vendorCost || '0'))}</strong> per unit
            </div>
          )}
          {vendors.length === 0 && (
            <p className="text-xs text-green-600 mt-2">
              No vendors yet — add one in the <strong>Vendors</strong> section first.
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={f('description')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Track stock toggle */}
        <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={form.trackStock}
              onClick={() => setForm((p) => ({ ...p, trackStock: !p.trackStock }))}
              className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                form.trackStock ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                form.trackStock ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
            <div>
              <p className="text-sm font-medium text-gray-800">Track inventory</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {form.trackStock
                  ? 'Stock levels are tracked and deducted on each sale.'
                  : 'Service item — no stock count, never out of stock (e.g. Print Services, labour).'}
              </p>
            </div>
          </label>
        </div>

        {/* Bundle toggle */}
        <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={form.isComposite}
              onClick={() => setForm((p) => ({ ...p, isComposite: !p.isComposite }))}
              className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                form.isComposite ? 'bg-purple-600' : 'bg-gray-300'
              }`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                form.isComposite ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
            <div>
              <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                <Layers size={14} className="text-purple-600" /> Bundle product
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Selling this product will automatically deduct its components from inventory.
              </p>
            </div>
          </label>
        </div>

        {/* Bundle components */}
        {form.isComposite && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Layers size={14} /> Bundle Components
              {errors.components && (
                <span className="text-xs text-red-500 ml-2">{errors.components}</span>
              )}
            </p>

            {components.length > 0 && (
              <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                {components.map((comp) => (
                  <div key={comp.componentProductId} className="flex items-center gap-3 px-3 py-2.5 bg-white">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{comp.componentProductName}</p>
                      <p className="text-xs text-gray-400 font-mono">{comp.componentSku}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-gray-500">Qty:</span>
                      <input
                        type="number"
                        min="0.001"
                        step="1"
                        value={comp.quantity}
                        onChange={(e) => updateComponentQty(comp.componentProductId, parseFloat(e.target.value) || 1)}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => removeComponent(comp.componentProductId)}
                        className="p-1 text-gray-400 hover:text-red-500 rounded"
                        aria-label="Remove component"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              <Input
                placeholder="Search products to add as components..."
                value={compSearch}
                onChange={(e) => setCompSearch(e.target.value)}
                leftIcon={<Search size={14} />}
              />
              {(compResults.length > 0 || compSearching) && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                  {compSearching ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500">
                      <Loader size={14} className="animate-spin" /> Searching...
                    </div>
                  ) : (
                    compResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addComponent(p)}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors text-left border-b border-gray-100 last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                        </div>
                        <Plus size={14} className="text-blue-500 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </Modal>
  )
}
