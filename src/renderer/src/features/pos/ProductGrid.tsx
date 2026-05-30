import React, { useState, useEffect, useRef, useCallback, memo } from 'react'
import { Search, Grid, Tag } from 'lucide-react'
import { api } from '../../lib/api'
import { useCartStore } from '../../stores/cart.store'
import { useUiStore } from '../../stores/ui.store'
import { Input, Spinner, Badge } from '../../components/ui'
import { useCurrencyStore } from '../../stores/currency.store'
import type { Product, Category } from '../../types'
import { BARCODE_SCAN_TIMEOUT_MS } from '../../constants'

/** Sentinel placed in imageUrl when the actual data is a large base64 blob stored locally. */
const LOCAL_IMAGE_SENTINEL = '__local__'

/**
 * Module-level cache for product lists.
 * Key: category id (or '' for "All"). Value: { data, fetchedAt }.
 * Entries expire after CACHE_TTL_MS. Call invalidateProductCache() after mutations.
 */
const CACHE_TTL_MS = 60_000 // 1 minute
interface CacheEntry { data: Product[]; fetchedAt: number }
const productCache = new Map<string, CacheEntry>()

export function invalidateProductCache(): void {
  productCache.clear()
}

function getCached(key: string): Product[] | null {
  const entry = productCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    productCache.delete(key)
    return null
  }
  return entry.data
}

export function ProductGrid() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const addItem = useCartStore((s) => s.addItem)
  const showToast = useUiStore((s) => s.showToast)

  // Barcode scanner support (keyboard wedge accumulates chars rapidly)
  const barcodeBuffer = useRef('')
  const barcodeTimer = useRef<ReturnType<typeof setTimeout>>()

  const loadProducts = useCallback(async () => {
    const cacheKey = selectedCategory ?? ''
    const cached = getCached(cacheKey)
    if (cached) {
      setProducts(cached)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await api.products.list(selectedCategory ?? undefined)
      productCache.set(cacheKey, { data, fetchedAt: Date.now() })
      setProducts(data)
    } catch {
      showToast('Failed to load products', 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedCategory, showToast])

  useEffect(() => {
    api.categories.list().then(setCategories).catch(console.error)
  }, [])

  useEffect(() => {
    if (!search) {
      loadProducts()
    } else {
      const timer = setTimeout(async () => {
        setLoading(true)
        try {
          const data = await api.products.search(search)
          setProducts(data)
        } finally {
          setLoading(false)
        }
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [search, loadProducts])

  // Global barcode scanner listener
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && barcodeBuffer.current.length > 3) {
        const code = barcodeBuffer.current
        barcodeBuffer.current = ''
        api.products.byBarcode(code).then((product) => {
          if (product) {
            handleAddProduct(product)
            setSearch('')
          } else {
            showToast(`No product found for barcode: ${code}`, 'warning')
            setSearch('')
          }
        })
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key
        clearTimeout(barcodeTimer.current)
        barcodeTimer.current = setTimeout(() => {
          barcodeBuffer.current = ''
        }, BARCODE_SCAN_TIMEOUT_MS)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  function handleAddProduct(product: Product) {
    addItem({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantity: 1,
      unitPrice: product.basePrice,
      taxRate: product.taxRate
    })
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Search bar */}
      <div className="p-4 bg-white border-b border-gray-200">
        <Input
          placeholder="Search products or scan barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search size={16} />}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-200 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => { setSelectedCategory(null); setSearch('') }}
          className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
            !selectedCategory
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => { setSelectedCategory(cat.id); setSearch('') }}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
              selectedCategory === cat.id
                ? 'text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            style={selectedCategory === cat.id ? { backgroundColor: cat.color } : {}}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Spinner size="lg" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
            <Grid size={40} />
            <p className="text-sm">No products found</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAdd={() => handleAddProduct(product)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface ProductCardProps {
  product: Product
  onAdd: () => void
}

/**
 * Memoised product card — only re-renders when its own product data changes.
 *
 * Base64 images are stripped from the list IPC response to keep payloads small.
 * When the card detects the LOCAL_IMAGE_SENTINEL it fetches the real image lazily
 * so the grid paints immediately and images trickle in afterwards.
 */
const ProductCard = memo(function ProductCard({ product, onAdd }: ProductCardProps) {
  const fmtRaw = useCurrencyStore((s) => s.fmtRaw)
  const isOutOfStock = product.trackStock && product.quantity <= 0

  // Start with whatever the list gave us. If it's the sentinel, we'll fetch lazily.
  const [imgSrc, setImgSrc] = useState<string | null>(
    product.imageUrl === LOCAL_IMAGE_SENTINEL ? null : product.imageUrl
  )

  useEffect(() => {
    if (product.imageUrl !== LOCAL_IMAGE_SENTINEL) {
      setImgSrc(product.imageUrl)
      return
    }
    let cancelled = false
    api.products.imageUrl(product.id).then((url) => {
      if (!cancelled) setImgSrc(url)
    })
    return () => { cancelled = true }
  }, [product.id, product.imageUrl])

  return (
    <button
      onClick={onAdd}
      disabled={isOutOfStock}
      className={[
        'flex flex-col bg-white rounded-xl border shadow-sm p-3 text-left transition-all',
        'hover:shadow-md hover:border-blue-300 active:scale-[0.97]',
        'focus:outline-none focus:ring-2 focus:ring-blue-500',
        'min-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed'
      ].join(' ')}
    >
      {/* Product image / colour swatch */}
      <div
        className="w-full h-16 rounded-lg mb-2 flex items-center justify-center overflow-hidden"
        style={{ backgroundColor: product.categoryColor ? `${product.categoryColor}20` : '#f1f5f9' }}
      >
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-contain rounded-lg"
          />
        ) : (
          <Tag size={24} style={{ color: product.categoryColor ?? '#94a3b8' }} />
        )}
      </div>

      {/* Info */}
      <p className="text-xs font-medium text-gray-900 leading-tight line-clamp-2 mb-1">
        {product.name}
      </p>
      <p className="text-sm font-bold text-blue-600 mt-auto">
        {fmtRaw(product.basePrice)}
      </p>

      {/* Stock badge — only for tracked products */}
      {product.trackStock && product.quantity <= 5 && product.quantity > 0 && (
        <Badge color="yellow" className="mt-1 text-[10px]">
          Low: {product.quantity} left
        </Badge>
      )}

      {isOutOfStock && (
        <Badge color="red" className="mt-1 text-[10px]">Out of stock</Badge>
      )}
    </button>
  )
})
