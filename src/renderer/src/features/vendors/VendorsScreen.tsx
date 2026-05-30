import React, { useState, useEffect } from 'react'
import { Plus, Store, DollarSign, X, Check, Package, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Badge, Modal, Input, PageSpinner } from '../../components/ui'
import { useUiStore } from '../../stores/ui.store'
import { useAuthStore } from '../../stores/auth.store'
import { useCurrencyStore } from '../../stores/currency.store'
import type { Vendor } from '../../types'

// ─── Vendor Form Modal ────────────────────────────────────────────────────────
interface VendorFormModalProps {
  vendor: Vendor | null
  onClose: () => void
  onSave: () => void
}

function VendorFormModal({ vendor, onClose, onSave }: VendorFormModalProps) {
  const [form, setForm] = useState({
    name: vendor?.name ?? '',
    phone: vendor?.phone ?? '',
    email: vendor?.email ?? '',
    notes: vendor?.notes ?? ''
  })
  const [saving, setSaving] = useState(false)
  const showToast = useUiStore((s) => s.showToast)

  const f =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }))

  async function handleSave() {
    if (!form.name.trim()) {
      showToast('Vendor name is required', 'error')
      return
    }
    setSaving(true)
    try {
      if (vendor) {
        await api.vendors.update(vendor.id, {
          name: form.name.trim(),
          phone: form.phone || undefined,
          email: form.email || undefined,
          notes: form.notes || undefined
        })
      } else {
        await api.vendors.create({
          name: form.name.trim(),
          phone: form.phone || undefined,
          email: form.email || undefined,
          notes: form.notes || undefined
        })
      }
      showToast(vendor ? 'Vendor updated' : 'Vendor added', 'success')
      onSave()
    } catch {
      showToast('Failed to save vendor', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={vendor ? `Edit — ${vendor.name}` : 'Add Vendor'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Save Vendor
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Vendor Name *"
          value={form.name}
          onChange={f('name')}
          placeholder="e.g. J&R Snacks"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Phone"
            value={form.phone}
            onChange={f('phone')}
            placeholder="+1 345-000-0000"
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={f('email')}
            placeholder="vendor@example.com"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Notes</label>
          <textarea
            value={form.notes}
            onChange={f('notes')}
            placeholder="Payment terms, delivery schedule, etc."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </Modal>
  )
}

// ─── Payout Modal ─────────────────────────────────────────────────────────────
interface PayoutModalProps {
  vendor: Vendor
  onClose: () => void
  onPaid: () => void
}

function PayoutModal({ vendor, onClose, onPaid }: PayoutModalProps) {
  const fmtRaw = useCurrencyStore((s) => s.fmtRaw)
  const [amount, setAmount] = useState(vendor.balanceOwed.toFixed(2))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<
    Array<{ id: string; amount: number; note: string | null; createdAt: string }>
  >([])
  const [tab, setTab] = useState<'pay' | 'history'>('pay')
  const showToast = useUiStore((s) => s.showToast)
  const { staff } = useAuthStore()

  useEffect(() => {
    api.vendors
      .payoutHistory(vendor.id)
      .then((h) => setHistory(h as typeof history))
      .catch(() => {})
  }, [vendor.id])

  async function handlePay() {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) {
      showToast('Enter a valid amount', 'error')
      return
    }
    setSaving(true)
    try {
      await api.vendors.recordPayout({
        vendorId: vendor.id,
        amount: amt,
        note: note || undefined,
        staffId: staff?.id
      })
      showToast(`Payout of ${fmtRaw(amt)} recorded for ${vendor.name}`, 'success')
      onPaid()
    } catch {
      showToast('Failed to record payout', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Pay Vendor — ${vendor.name}`}
      footer={
        tab === 'pay' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handlePay} loading={saving} icon={<Check size={14} />}>
              Record Payment
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
        {(['pay', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'pay' ? 'Record Payment' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'pay' && (
        <div className="space-y-4">
          {/* Balance summary */}
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm">
            <div className="flex justify-between text-green-800 mb-1">
              <span>Total earned (from sales)</span>
              <strong>{fmtRaw(vendor.totalEarned)}</strong>
            </div>
            <div className="flex justify-between text-green-700 mb-2">
              <span>Already paid out</span>
              <strong>- {fmtRaw(vendor.totalPaid)}</strong>
            </div>
            <div className="flex justify-between text-green-900 font-bold border-t border-green-200 pt-2">
              <span>Balance owed</span>
              <span className={vendor.balanceOwed > 0 ? 'text-red-600' : 'text-green-700'}>
                {fmtRaw(vendor.balanceOwed)}
              </span>
            </div>
          </div>

          <Input
            label="Payment Amount ($)"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          <Input
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Weekly payout via cash"
          />
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">No payments recorded yet</p>
          ) : (
            history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-100"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-900">{fmtRaw(h.amount)}</p>
                  <p className="text-xs text-gray-400">{new Date(h.createdAt).toLocaleString()}</p>
                  {h.note && (
                    <p className="text-xs text-gray-500 mt-0.5 italic">"{h.note}"</p>
                  )}
                </div>
                <Badge color="green">Paid</Badge>
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── Vendor Detail Side Panel ─────────────────────────────────────────────────
interface VendorDetailProps {
  vendor: Vendor
  onClose: () => void
  onEdit: () => void
  onPay: () => void
}

function VendorDetail({ vendor, onClose, onEdit, onPay }: VendorDetailProps) {
  const fmtRaw = useCurrencyStore((s) => s.fmtRaw)
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; sku: string; basePrice: number; vendorCost: number | null }>
  >([])

  useEffect(() => {
    api.vendors
      .products(vendor.id)
      .then((p) => setProducts(p as typeof products))
      .catch(() => {})
  }, [vendor.id])

  return (
    <div className="bg-white border-l border-gray-200 w-80 shrink-0 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <Store size={14} className="text-green-700" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">{vendor.name}</p>
            {vendor.phone && <p className="text-xs text-gray-400">{vendor.phone}</p>}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Balance card */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs text-green-700 font-medium uppercase tracking-wide mb-3">
            Balance Summary
          </p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-green-800">
              <span>Total earned</span>
              <strong>{fmtRaw(vendor.totalEarned)}</strong>
            </div>
            <div className="flex justify-between text-green-700">
              <span>Paid out</span>
              <strong>- {fmtRaw(vendor.totalPaid)}</strong>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-green-200 pt-2 mt-2">
              <span className="text-green-900">Owed now</span>
              <span className={vendor.balanceOwed > 0 ? 'text-red-600' : 'text-green-700'}>
                {fmtRaw(vendor.balanceOwed)}
              </span>
            </div>
          </div>
          <Button
            className="w-full mt-3"
            icon={<DollarSign size={14} />}
            onClick={onPay}
            disabled={vendor.balanceOwed <= 0}
          >
            {vendor.balanceOwed > 0 ? 'Record Payment' : 'Fully Paid'}
          </Button>
        </div>

        {/* Products */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Package size={12} /> Products ({products.length})
          </p>
          {products.length === 0 ? (
            <p className="text-xs text-gray-400">
              No products assigned to this vendor yet. Go to Products and set the vendor on each
              consignment item.
            </p>
          ) : (
            <div className="space-y-1.5">
              {products.map((p) => (
                <div
                  key={p.id}
                  className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100"
                >
                  <div className="flex justify-between items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate leading-tight">
                        {p.name}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-xs font-semibold text-gray-700">
                        {fmtRaw(p.basePrice)}
                      </p>
                      {p.vendorCost != null && (
                        <p className="text-xs text-green-600">
                          vendor: {fmtRaw(p.vendorCost)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contact info */}
        {(vendor.email || vendor.notes) && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</p>
            {vendor.email && <p className="text-sm text-gray-700">{vendor.email}</p>}
            {vendor.notes && (
              <p className="text-xs text-gray-500 italic">"{vendor.notes}"</p>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-gray-200 p-4">
        <Button variant="secondary" className="w-full" onClick={onEdit}>
          Edit Vendor
        </Button>
      </div>
    </div>
  )
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export function VendorsScreen() {
  const fmtRaw = useCurrencyStore((s) => s.fmtRaw)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editVendor, setEditVendor] = useState<Vendor | null>(null)
  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null)
  const [payVendor, setPayVendor] = useState<Vendor | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const showToast = useUiStore((s) => s.showToast)

  async function load() {
    setLoading(true)
    try {
      const data = await api.vendors.list()
      setVendors(data)
      // Keep detail panel in sync
      if (detailVendor) {
        const refreshed = data.find((v) => v.id === detailVendor.id)
        setDetailVendor(refreshed ?? null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDelete(v: Vendor) {
    if (!window.confirm(`Delete vendor "${v.name}"? This cannot be undone.`)) return
    const result = await api.vendors.delete(v.id)
    if (result.ok) {
      showToast('Vendor deleted', 'success')
      if (detailVendor?.id === v.id) setDetailVendor(null)
      load()
    } else {
      showToast(result.reason ?? 'Cannot delete vendor', 'error')
    }
  }

  async function handleBatchDelete() {
    const count = selectedIds.size
    if (!window.confirm(`Delete ${count} vendor${count !== 1 ? 's' : ''}? This cannot be undone.`)) return
    const results = await Promise.all([...selectedIds].map((id) => api.vendors.delete(id)))
    const failed = results.filter((r) => !r.ok).length
    if (failed > 0) {
      showToast(`${count - failed} deleted, ${failed} could not be removed (have unpaid balances)`, 'error')
    } else {
      showToast(`${count} vendor${count !== 1 ? 's' : ''} deleted`, 'success')
    }
    setSelectedIds(new Set())
    if (detailVendor && selectedIds.has(detailVendor.id)) setDetailVendor(null)
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
    const allSelected = vendors.length > 0 && vendors.every((v) => selectedIds.has(v.id))
    setSelectedIds(allSelected ? new Set() : new Set(vendors.map((v) => v.id)))
  }

  const totalOwed = vendors.reduce((s, v) => s + v.balanceOwed, 0)

  if (loading) return <PageSpinner />

  return (
    <div className="flex h-full bg-gray-50">
      {/* Main list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Vendors</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {vendors.length} vendor{vendors.length !== 1 ? 's' : ''}
              {totalOwed > 0 && (
                <span className="ml-2 text-red-600 font-medium">
                  · {fmtRaw(totalOwed)} owed total
                </span>
              )}
            </p>
          </div>
          <Button
            icon={<Plus size={16} />}
            onClick={() => {
              setEditVendor(null)
              setShowForm(true)
            }}
          >
            Add Vendor
          </Button>
        </div>

        {/* Outstanding balance banner */}
        {totalOwed > 0 && (
          <div className="mx-6 mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-800 text-sm">
            <DollarSign size={15} className="shrink-0" />
            <span>
              <strong>{fmtRaw(totalOwed)}</strong> outstanding across{' '}
              {vendors.filter((v) => v.balanceOwed > 0).length} vendor
              {vendors.filter((v) => v.balanceOwed > 0).length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {vendors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-400">
              <Store size={48} className="opacity-40" />
              <div className="text-center">
                <p className="font-medium text-gray-500">No vendors yet</p>
                <p className="text-sm mt-1">
                  Add a vendor, then assign products to them in the Products screen.
                </p>
              </div>
              <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>
                Add First Vendor
              </Button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={vendors.length > 0 && vendors.every((v) => selectedIds.has(v.id))}
                        ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && !vendors.every((v) => selectedIds.has(v.id)) }}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        aria-label="Select all vendors"
                      />
                    </th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Vendor</th>
                    <th className="text-right px-4 py-3 text-gray-600 font-medium">
                      Total Earned
                    </th>
                    <th className="text-right px-4 py-3 text-gray-600 font-medium">Paid Out</th>
                    <th className="text-right px-4 py-3 text-gray-600 font-medium">
                      Balance Owed
                    </th>
                    <th className="text-right px-4 py-3 text-gray-600 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vendors.map((v) => (
                    <tr
                      key={v.id}
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                        selectedIds.has(v.id) ? 'bg-blue-50' : detailVendor?.id === v.id ? 'bg-slate-50' : ''
                      }`}
                      onClick={() =>
                        setDetailVendor(detailVendor?.id === v.id ? null : v)
                      }
                    >
                      <td
                        className="px-4 py-3 w-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(v.id)}
                          onChange={() => toggleSelect(v.id)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          aria-label={`Select ${v.name}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                            <Store size={13} className="text-green-700" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{v.name}</p>
                            {v.phone && (
                              <p className="text-xs text-gray-400">{v.phone}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {fmtRaw(v.totalEarned)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {fmtRaw(v.totalPaid)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-bold ${
                            v.balanceOwed > 0 ? 'text-red-600' : 'text-green-600'
                          }`}
                        >
                          {fmtRaw(v.balanceOwed)}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          {v.balanceOwed > 0 && (
                            <Button
                              size="sm"
                              icon={<DollarSign size={12} />}
                              onClick={() => setPayVendor(v)}
                            >
                              Pay
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditVendor(v)
                              setShowForm(true)
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDelete(v)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Detail side panel */}
      {detailVendor && (
        <VendorDetail
          vendor={detailVendor}
          onClose={() => setDetailVendor(null)}
          onEdit={() => {
            setEditVendor(detailVendor)
            setShowForm(true)
          }}
          onPay={() => setPayVendor(detailVendor)}
        />
      )}

      {/* Modals */}
      {showForm && (
        <VendorFormModal
          vendor={editVendor}
          onClose={() => setShowForm(false)}
          onSave={() => {
            setShowForm(false)
            load()
          }}
        />
      )}
      {payVendor && (
        <PayoutModal
          vendor={payVendor}
          onClose={() => setPayVendor(null)}
          onPaid={() => {
            setPayVendor(null)
            load()
          }}
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

