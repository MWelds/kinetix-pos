import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
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
 * Number of columns in the product grid.
 * Must match the Tailwind class used on the grid container below.
 * xl screens get 4 columns; everything else gets 3.
 */
const COLS_DEFAULT = 3
const COLS_XL = 4

/** Approximate rendered height of one card row in pixels (card + gap). */
const ROW_HEIGHT_PX = 160

/**
 * Module-level cache for product lists.
 * Key: category id (or '' for "All"). Expires after CACHE_TTL_MS.
 */
const CACHE_TTL_MS = 60_000
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

  // The scrollable container — virtualizer needs a ref to it
  const scrollParentRef = useRef<HTMLDivElement>(null)

  // Determine column count from container width
  const [cols, setCols] = useState(COLS_DEFAULT)
  useEffect(() => {
    const el = scrollParentRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setCols(entry.contentRect.width >= 1280 ? COLS_XL : COLS_DEFAULT)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Chunk products into rows for the virtualizer
  const rows = useMemo(() => {
    const result: Product[][] = []
    for (let i = 0; i < products.length; i += cols) {
      result.push(products.slice(i, i + cols))
    }
    return result
  }, [products, cols])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 3, // render 3 extra rows above/below the viewport
  })

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
    // Scroll back to top whenever the category or search changes
    scrollParentRef.current?.scrollTo({ top: 0 })

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

  const virtualItems = virtualizer.getVirtualItems()
  const totalHeight = virtualizer.getTotalSize()

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
              selectedCategory === cat.id ? 'text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            style={selectedCategory === cat.id ? { backgroundColor: cat.color } : {}}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Virtualised product grid */}
      <div ref={scrollParentRef} className="flex-1 overflow-y-auto p-4">
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
          /* Outer div holds the full virtual height so the scrollbar is correct */
          <div style={{ height: totalHeight, position: 'relative' }}>
            {virtualItems.map((virtualRow) => {
              const rowProducts = rows[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    className="grid gap-3 pb-3"
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                  >
                    {rowProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onAdd={() => handleAddProduct(product)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
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
 * Lazy-loads base64 images that were stripped from the list IPC response.
 */
const ProductCard = memo(function ProductCard({ product, onAdd }: ProductCardProps) {
  const fmtRaw = useCurrencyStore((s) => s.fmtRaw)
  const isOutOfStock = product.trackStock && product.quantity <= 0

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

      <p className="text-xs font-medium text-gray-900 leading-tight line-clamp-2 mb-1">
        {product.name}
      </p>
      <p className="text-sm font-bold text-blue-600 mt-auto">
        {fmtRaw(product.basePrice)}
      </p>

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
