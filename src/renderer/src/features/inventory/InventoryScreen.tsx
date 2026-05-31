import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, AlertTriangle, Barcode, X, Search, Package, ChevronRight, ChevronLeft } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Badge, Modal, Input, PageSpinner, Spinner } from '../../components/ui'
import { useUiStore } from '../../stores/ui.store'
import { useAuthStore } from '../../stores/auth.store'
import { BARCODE_SCAN_TIMEOUT_MS } from '../../constants'
import type { InventoryItem, Product } from '../../types'

const PAGE_SIZE = 50

export function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [lowStockCount, setLowStockCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [form, setForm] = useState({
    type: 'receive' as 'receive' | 'transfer' | 'loss' | 'adjustment',
    quantity: '',
    note: ''
  })
  const [saving, setSaving] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeRef = useRef<HTMLInputElement>(null)
  const showToast = useUiStore((s) => s.showToast)
  const { staff } = useAuthStore()

  // 250 ms debounce for search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  // Reset to page 0 when search changes (skip on first mount)
  const prevSearchRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevSearchRef.current === null) {
      prevSearchRef.current = debouncedSearch
      return
    }
    if (prevSearchRef.current !== debouncedSearch) {
      prevSearchRef.current = debouncedSearch
      setPage(0)
    }
  }, [debouncedSearch])

  // Keyboard-wedge barcode scanner listener
  const scanBuffer = useRef('')
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Open adjust modal for the item matching the scanned barcode */
  const handleBarcodeScan = useCallback(
    async (barcode: string) => {
      if (!barcode.trim()) return
      setBarcodeInput(barcode)
      setBarcodeError('')
      try {
        const product = await api.products.byBarcode(barcode.trim())
        if (!product) {
          setBarcodeError(`No product found for barcode: ${barcode}`)
          return
        }
        // Search the current page first; if not found, fetch by product lookup
        const inventoryItem = items.find((i) => i.productId === product.id)
        if (!inventoryItem) {
          setBarcodeError(`"${product.name}" is not on the current page — use the search box to find it`)
          return
        }
        setAdjustItem(inventoryItem)
        setForm({ type: 'receive', quantity: '', note: '' })
        setBarcodeInput('')
      } catch {
        setBarcodeError('Error looking up barcode')
      }
    },
    [items]
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Enter') {
        if (scanBuffer.current) {
          const code = scanBuffer.current
          scanBuffer.current = ''
          if (scanTimer.current) clearTimeout(scanTimer.current)
          handleBarcodeScan(code)
        }
        return
      }

      if (e.key.length === 1) {
        scanBuffer.current += e.key
        if (scanTimer.current) clearTimeout(scanTimer.current)
        scanTimer.current = setTimeout(() => {
          scanBuffer.current = ''
        }, BARCODE_SCAN_TIMEOUT_MS)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleBarcodeScan])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.inventory.listPaginated({
        search: debouncedSearch || undefined,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE
      })
      setItems(result.items)
      setTotal(result.total)
      setLowStockCount(result.lowStockCount)
    } catch {
      showToast('Failed to load inventory', 'error')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, page, showToast])

  useEffect(() => {
    load()
  }, [load])

  async function handleAdjust() {
    if (!adjustItem) return
    const qty = parseInt(form.quantity, 10)
    if (isNaN(qty) || qty <= 0) {
      showToast('Enter a valid quantity', 'error')
      return
    }
    setSaving(true)
    try {
      await api.inventory.adjust({
        productId: adjustItem.productId,
        type: form.type,
        quantity: qty,
        note: form.note || undefined,
        staffId: staff?.id
      })
      showToast('Inventory adjusted', 'success')
      setAdjustItem(null)
      await load()
    } catch {
      showToast('Failed to adjust inventory', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleManualBarcode(e: React.FormEvent) {
    e.preventDefault()
    if (!barcodeInput.trim()) return
    await handleBarcodeScan(barcodeInput.trim())
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  /** Whether this inventory item is the individual product of a pack */
  function isPackIndividual(item: InventoryItem) {
    return item.packProductId != null && item.packUnitsPerPack != null
  }

  function packStockLabel(item: InventoryItem) {
    const ppu = item.packUnitsPerPack!
    const fullBoxes = Math.floor(item.quantity / ppu)
    const remaining = item.quantity % ppu
    return (
      <span>
        <span className="font-bold text-base text-gray-900">{item.quantity}</span>
        <span className="text-xs text-gray-400 ml-1">units</span>
        <span className="ml-2 text-xs text-indigo-700 bg-indigo-50 rounded px-1.5 py-0.5">
          📦 {fullBoxes} box{fullBoxes !== 1 ? 'es' : ''} + {remaining} pcs remaining
        </span>
      </span>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${total} product${total !== 1 ? 's' : ''} tracked`}
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setShowReceiveModal(true)}>
          Receive Stock
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Low stock alert */}
        {lowStockCount > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="text-sm font-medium">
              {lowStockCount} product{lowStockCount > 1 ? 's' : ''} low in stock
            </span>
          </div>
        )}

        {/* Search + Barcode bar */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
            />
          </div>

          <form onSubmit={handleManualBarcode} className="flex gap-2">
            <div className="relative">
              <Barcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={barcodeRef}
                type="text"
                placeholder="Scan or type barcode..."
                value={barcodeInput}
                onChange={(e) => { setBarcodeInput(e.target.value); setBarcodeError('') }}
                className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] w-52"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={!barcodeInput.trim()}>
              Find
            </Button>
            {barcodeInput && (
              <button
                type="button"
                onClick={() => { setBarcodeInput(''); setBarcodeError('') }}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </form>
        </div>

        {barcodeError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {barcodeError}
          </div>
        )}

        {/* Inventory table */}
        {loading ? (
          <PageSpinner />
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Product</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">SKU</th>
                    <th className="text-center px-4 py-3 text-gray-600 font-medium">In Stock</th>
                    <th className="text-center px-4 py-3 text-gray-600 font-medium">Low Stock At</th>
                    <th className="text-center px-4 py-3 text-gray-600 font-medium">Status</th>
                    <th className="text-right px-4 py-3 text-gray-600 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray-400">
                        {debouncedSearch ? 'No products match your search' : 'No inventory records'}
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => {
                      const isLow = item.quantity <= item.lowStockThreshold
                      const packInd = isPackIndividual(item)
                      return (
                        <tr key={item.id} className={`hover:bg-gray-50 ${packInd ? 'bg-indigo-50/30' : ''}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.productName ?? ''}
                                  className="w-8 h-8 rounded-lg object-cover shrink-0 border border-gray-100"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                                  <Package size={13} className="text-gray-400" />
                                </div>
                              )}
                              <div className="flex items-center gap-1.5">
                                {packInd && <Package size={13} className="text-indigo-500 shrink-0" />}
                                <span className="font-medium text-gray-900">{item.productName}</span>
                                {packInd && (
                                  <span className="text-xs text-indigo-600 bg-indigo-100 rounded px-1 py-0.5 shrink-0">
                                    pack-linked
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.sku}</td>
                          <td className="px-4 py-3 text-center">
                            {packInd
                              ? packStockLabel(item)
                              : <span className={`font-bold text-base ${isLow ? 'text-red-600' : 'text-gray-900'}`}>{item.quantity}</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-center text-gray-500">{item.lowStockThreshold}</td>
                          <td className="px-4 py-3 text-center">
                            {isLow
                              ? <Badge color="red">Low Stock</Badge>
                              : <Badge color="green">In Stock</Badge>
                            }
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setAdjustItem(item)
                                setForm({ type: 'receive', quantity: '', note: '' })
                                setBarcodeError('')
                              }}
                            >
                              Adjust
                            </Button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination bar */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-1">
                <p className="text-sm text-gray-500">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm text-gray-700 font-medium">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Receive Stock modal */}
      <ReceiveStockModal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        onReceived={() => { setShowReceiveModal(false); load() }}
        staffId={staff?.id}
      />

      {/* Adjust modal */}
      <Modal
        isOpen={!!adjustItem}
        onClose={() => setAdjustItem(null)}
        title={`Adjust Inventory — ${adjustItem?.productName ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjustItem(null)}>Cancel</Button>
            <Button onClick={handleAdjust} loading={saving}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Current stock summary */}
          {adjustItem && isPackIndividual(adjustItem) ? (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm">
              <div className="flex items-center gap-1.5 text-indigo-800 font-medium mb-1">
                <Package size={14} /> Pack-linked product
              </div>
              <p className="text-indigo-700 text-xs leading-relaxed">
                This is the individual unit product for a pack. Stock is tracked in <strong>individual units</strong>.
                {adjustItem.packUnitsPerPack && (
                  <> Each pack contains <strong>{adjustItem.packUnitsPerPack} units</strong>. To receive 2 boxes, enter <strong>{2 * adjustItem.packUnitsPerPack}</strong>.</>
                )}
              </p>
              <p className="mt-2 text-indigo-900 font-semibold">
                Current stock: {adjustItem.quantity} units
                {adjustItem.packUnitsPerPack && (
                  <span className="text-indigo-600 font-normal ml-2">
                    ({Math.floor(adjustItem.quantity / adjustItem.packUnitsPerPack)} full boxes + {adjustItem.quantity % adjustItem.packUnitsPerPack} pcs)
                  </span>
                )}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Current stock: <strong className="text-gray-900">{adjustItem?.quantity ?? 0}</strong>
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Adjustment Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(['receive', 'adjustment', 'loss', 'transfer'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                  className={`py-2 px-3 rounded-lg border text-sm font-medium capitalize transition-colors ${
                    form.type === t
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Input
              label={
                adjustItem && isPackIndividual(adjustItem) && adjustItem.packUnitsPerPack
                  ? `Quantity (individual units — ${adjustItem.packUnitsPerPack} units = 1 box)`
                  : 'Quantity'
              }
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder={
                adjustItem && isPackIndividual(adjustItem) && adjustItem.packUnitsPerPack
                  ? `e.g. ${2 * adjustItem.packUnitsPerPack} for 2 boxes`
                  : 'Enter quantity'
              }
              autoFocus
            />
            {adjustItem && isPackIndividual(adjustItem) && adjustItem.packUnitsPerPack && form.quantity && (
              (() => {
                const n = parseInt(form.quantity, 10)
                if (isNaN(n) || n <= 0) return null
                const boxes = Math.floor(n / adjustItem.packUnitsPerPack!)
                const rem = n % adjustItem.packUnitsPerPack!
                return (
                  <p className="text-xs text-indigo-700 mt-1">
                    = {boxes} box{boxes !== 1 ? 'es' : ''}{rem > 0 ? ` + ${rem} individual unit${rem !== 1 ? 's' : ''}` : ''}
                  </p>
                )
              })()
            )}
            <Input
              label="Note (optional)"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Reason for adjustment..."
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

// --- Receive Stock Modal ---

interface ReceiveStockModalProps {
  isOpen: boolean
  onClose: () => void
  onReceived: () => void
  staffId?: string
}

function ReceiveStockModal({ isOpen, onClose, onReceived, staffId }: ReceiveStockModalProps) {
  const [step, setStep] = useState<'search' | 'quantity'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const showToast = useUiStore((s) => s.showToast)

  useEffect(() => {
    if (!isOpen) {
      setStep('search')
      setQuery('')
      setResults([])
      setSelected(null)
      setQuantity('')
      setNote('')
    }
  }, [isOpen])

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.products.search(query.trim())
        setResults(r)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  async function handleReceive() {
    if (!selected) return
    const qty = parseInt(quantity, 10)
    if (isNaN(qty) || qty <= 0) {
      showToast('Enter a valid quantity', 'error')
      return
    }
    setSaving(true)
    try {
      await api.inventory.adjust({
        productId: selected.id,
        type: 'receive',
        quantity: qty,
        note: note || undefined,
        staffId
      })
      showToast(`Received ${qty} units of "${selected.name}"`, 'success')
      onReceived()
    } catch {
      showToast('Failed to receive stock', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Receive Stock"
      footer={
        step === 'quantity' ? (
          <>
            <Button variant="secondary" onClick={() => setStep('search')}>Back</Button>
            <Button onClick={handleReceive} loading={saving}>Confirm Receipt</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        )
      }
    >
      {step === 'search' ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Search for the product you want to receive stock for.</p>
          <Input
            label="Product name, SKU, or barcode"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Spoon, BOX-100..."
            autoFocus
          />
          {searching && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner size="sm" /> Searching...
            </div>
          )}
          {results.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p); setStep('quantity') }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-100 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500">SKU: {p.sku}</p>
                  </div>
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-2">No products found</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <p className="text-sm font-medium text-blue-900">{selected?.name}</p>
            <p className="text-xs text-blue-600">SKU: {selected?.sku}</p>
          </div>
          <Input
            label="Quantity to receive"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Enter quantity..."
            autoFocus
          />
          <Input
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Supplier delivery, PO #1234..."
          />
        </div>
      )}
    </Modal>
  )
}
