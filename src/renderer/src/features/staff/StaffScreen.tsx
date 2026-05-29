import React, { useState, useEffect } from 'react'
import { Plus, Edit, Shield, Trash2, Monitor } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Badge, Modal, Input, PageSpinner } from '../../components/ui'
import { useUiStore } from '../../stores/ui.store'
import { ROLE_LABELS } from '../../constants'
import type { StaffMember } from '../../types'

export function StaffScreen() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [editMember, setEditMember] = useState<StaffMember | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const showToast = useUiStore((s) => s.showToast)

  async function load() {
    setLoading(true)
    try { setStaff(await api.staff.list()) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(member: StaffMember) {
    if (!window.confirm(`Remove ${member.firstName} ${member.lastName} from staff? They will be deactivated and can no longer log in.`)) return
    setDeletingId(member.id)
    try {
      await api.staff.delete(member.id)
      showToast(`${member.firstName} ${member.lastName} removed`, 'success')
      load()
    } catch {
      showToast('Failed to remove staff member', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const ROLE_COLORS: Record<string, 'red' | 'purple' | 'blue'> = { admin: 'red', manager: 'purple', cashier: 'blue' }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Staff</h1>
        <Button icon={<Plus size={16} />} onClick={() => { setEditMember(null); setShowForm(true) }}>
          Add Staff
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? <PageSpinner /> : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Name', 'Email', 'Role', 'Dashboard', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {staff.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-medium text-xs">
                          {s.firstName[0]}{s.lastName[0]}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{s.firstName} {s.lastName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{s.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge color={ROLE_COLORS[s.role] ?? 'blue'}>
                        <Shield size={10} className="mr-1" />{ROLE_LABELS[s.role] ?? s.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {s.canAccessDashboard ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <Monitor size={10} /> Enabled
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={s.isActive ? 'green' : 'gray'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" icon={<Edit size={14} />}
                          onClick={() => { setEditMember(s); setShowForm(true) }}>Edit</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={14} />}
                          loading={deletingId === s.id}
                          onClick={() => handleDelete(s)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          Remove
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

      {showForm && (
        <StaffFormModal
          member={editMember}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); load(); showToast(editMember ? 'Staff updated' : 'Staff created', 'success') }}
        />
      )}
    </div>
  )
}

function StaffFormModal({ member, onClose, onSave }: { member: StaffMember | null; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    firstName: member?.firstName ?? '',
    lastName: member?.lastName ?? '',
    email: member?.email ?? '',
    pin: '',
    role: (member?.role ?? 'cashier') as 'cashier' | 'manager' | 'admin',
    canAccessDashboard: member?.canAccessDashboard ?? false
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!form.firstName || !form.lastName) return
    if (!member && !form.pin) return
    setSaving(true)
    try {
      if (member) {
        await api.staff.update(member.id, { ...form, pin: form.pin || undefined })
      } else {
        await api.staff.create(form)
      }
      onSave()
    } finally { setSaving(false) }
  }

  const f = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }))

  return (
    <Modal isOpen onClose={onClose} title={member ? 'Edit Staff' : 'New Staff Member'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="First Name *" value={form.firstName} onChange={f('firstName')} autoFocus />
          <Input label="Last Name *" value={form.lastName} onChange={f('lastName')} />
        </div>
        <Input label="Email" type="email" value={form.email} onChange={f('email')} />
        <Input label={member ? 'New PIN (leave blank to keep current)' : 'PIN (4-6 digits) *'} type="password" value={form.pin} onChange={f('pin')} maxLength={6} />
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Role</label>
          <select value={form.role} onChange={f('role')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px]">
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="admin">Administrator</option>
          </select>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200">
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-gray-500" />
            <div>
              <p className="text-sm font-medium text-gray-800">Web Dashboard Access</p>
              <p className="text-xs text-gray-500">Allow this staff member to log into the browser dashboard using their PIN</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.canAccessDashboard}
            onClick={() => setForm((p) => ({ ...p, canAccessDashboard: !p.canAccessDashboard }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${form.canAccessDashboard ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${form.canAccessDashboard ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </div>
    </Modal>
  )
}
