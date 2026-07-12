import React, { useState, useEffect } from 'react'
import { Search, UserPlus } from 'lucide-react'
import { api } from '../../lib/api'
import { Input, Button, Badge } from '../../components/ui'
import type { Customer } from '../../types'
import { formatCurrency } from '../../lib/currency'

interface Props {
  onSelect: (customer: Customer) => void
  selectedId?: string
}

export function CustomerSearch({ onSelect, selectedId }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setLoading(true)
      api.customers.list().then(setResults).finally(() => setLoading(false))
      return
    }
    const t = setTimeout(async () => {
      setLoading(true)
      const r = await api.customers.search(query)
      setResults(r)
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  async function handleCreate() {
    if (!form.firstName.trim() || !form.lastName.trim()) return
    setCreating(true)
    try {
      const customer = await api.customers.create(form)
      onSelect(customer)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search by name, email, or phone..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        leftIcon={<Search size={14} />}
        autoFocus
      />

      {!showCreate ? (
        <>
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">No customers found</div>
            ) : (
              results.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-blue-50 transition-colors ${selectedId === c.id ? 'bg-blue-50' : ''}`}
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm shrink-0">
                    {c.firstName[0]}{c.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{c.email ?? c.phone ?? ''}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge color="purple">{c.loyaltyPoints} pts</Badge>
                    {c.storeCredit > 0 && (
                      <Badge color="green">{formatCurrency(c.storeCredit)} credit</Badge>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
          <Button variant="secondary" size="sm" icon={<UserPlus size={14} />} onClick={() => setShowCreate(true)} fullWidth>
            New Customer
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First Name"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              autoFocus
            />
            <Input
              label="Last Name"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </div>
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <Input
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)} fullWidth>Cancel</Button>
            <Button onClick={handleCreate} loading={creating} fullWidth>Create Customer</Button>
          </div>
        </div>
      )}
    </div>
  )
}
