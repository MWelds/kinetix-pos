import React, { useState, useEffect } from 'react'
import { Plus, Search, Edit, User, Star } from 'lucide-react'
import { api } from '../../lib/api'
import { CsvImportExportBar } from '../../components/ui/CsvImportExportBar'
import { Input, Button, Badge, Modal, PageSpinner } from '../../components/ui'
import { formatCurrency } from '../../lib/currency'
import { formatDate } from '../../lib/dates'
import { useUiStore } from '../../stores/ui.store'
import type { Customer, Order } from '../../types'

export function CustomersScreen() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [history, setHistory] = useState<Order[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const showToast = useUiStore((s) => s.showToast)

  async function load() {
    setLoading(true)
    try {
      const data = search ? await api.customers.search(search) : await api.customers.list()
      setCustomers(data)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [search])

  async function viewCustomer(c: Customer) {
    setSelected(c)
    const h = await api.customers.purchaseHistory(c.id)
    setHistory(h)
  }

  const CUSTOMER_CSV_TEMPLATE = [
    'first_name,last_name,email,phone,address,loyalty_points,store_credit,notes',
    'Jane,Doe,jane@example.com,555-0100,"123 Main St",0,0.00,'
  ].join('\n')

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Customers</h1>
          <Button icon={<Plus size={16} />} onClick={() => { setEditCustomer(null); setShowForm(true) }}>
            Add Customer
          </Button>
        </div>
        <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} leftIcon={<Search size={14} />} className="max-w-sm" />
        <div className="mt-4">
          <CsvImportExportBar
            entityLabel="Customers"
            exportFilename="customers-export.csv"
            onImport={async (csvText) => { const r = await api.csv.importCustomers(csvText); await load(); return r }}
            onExport={async () => api.csv.exportCustomers()}
            templateCsv={CUSTOMER_CSV_TEMPLATE}
            templateFilename="customers-template.csv"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? <PageSpinner /> : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Customer', 'Contact', 'Loyalty Points', 'Store Credit', 'Joined', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-xs">
                          {c.firstName[0]}{c.lastName[0]}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{c.email ?? c.phone ?? '—'}</td>
                    <td className="px-4 py-3"><Badge color="purple">{c.loyaltyPoints} pts</Badge></td>
                    <td className="px-4 py-3 text-sm font-medium">{formatCurrency(c.storeCredit)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" icon={<User size={14} />} onClick={() => viewCustomer(c)}>View</Button>
                        <Button size="sm" variant="ghost" icon={<Edit size={14} />} onClick={() => { setEditCustomer(c); setShowForm(true) }}>Edit</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!customers.length && <div className="text-center py-12 text-gray-400 text-sm">No customers found</div>}
          </div>
        )}
      </div>

      {/* Customer detail */}
      {selected && (
        <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={`${selected.firstName} ${selected.lastName}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-600 font-medium">Loyalty Points</p>
                <p className="text-xl font-bold text-blue-700">{selected.loyaltyPoints}</p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3 text-center">
                <p className="text-xs text-emerald-600 font-medium">Store Credit</p>
                <p className="text-xl font-bold text-emerald-700">{formatCurrency(selected.storeCredit)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-600 font-medium">Orders</p>
                <p className="text-xl font-bold text-gray-700">{history.length}</p>
              </div>
            </div>
            <div className="text-sm space-y-1 text-gray-600">
              {selected.email && <p>Email: {selected.email}</p>}
              {selected.phone && <p>Phone: {selected.phone}</p>}
              {selected.address && <p>Address: {selected.address}</p>}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Purchase History</h3>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {history.map((o) => (
                  <div key={o.id} className="flex justify-between text-sm py-1.5 border-b border-gray-100">
                    <span className="font-mono text-blue-600">{o.orderNumber}</span>
                    <span className="text-gray-500">{formatDate(o.createdAt)}</span>
                    <span className="font-medium">{formatCurrency(o.total)}</span>
                  </div>
                ))}
                {!history.length && <p className="text-gray-400 text-sm">No orders yet</p>}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {showForm && (
        <CustomerFormModal
          customer={editCustomer}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); load(); showToast(editCustomer ? 'Customer updated' : 'Customer created', 'success') }}
        />
      )}
    </div>
  )
}

function CustomerFormModal({ customer, onClose, onSave }: { customer: Customer | null; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    firstName: customer?.firstName ?? '',
    lastName: customer?.lastName ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    address: customer?.address ?? '',
    notes: customer?.notes ?? ''
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim()) return
    setSaving(true)
    try {
      if (customer) await api.customers.update(customer.id, form)
      else await api.customers.create(form)
      onSave()
    } finally { setSaving(false) }
  }

  const f = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }))

  return (
    <Modal isOpen onClose={onClose} title={customer ? 'Edit Customer' : 'New Customer'} size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="First Name *" value={form.firstName} onChange={f('firstName')} autoFocus />
          <Input label="Last Name *" value={form.lastName} onChange={f('lastName')} />
        </div>
        <Input label="Email" type="email" value={form.email} onChange={f('email')} />
        <Input label="Phone" type="tel" value={form.phone} onChange={f('phone')} />
        <Input label="Address" value={form.address} onChange={f('address')} />
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Notes</label>
          <textarea value={form.notes} onChange={f('notes')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    </Modal>
  )
}
