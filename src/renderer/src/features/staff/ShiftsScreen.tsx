import React, { useState, useEffect } from 'react'
import {
  Clock, ChevronDown, ChevronRight, RefreshCw, RotateCcw,
  ShoppingBag, AlertCircle, User, FileText
} from 'lucide-react'
import { api } from '../../lib/api'
import { Button, Badge, PageSpinner } from '../../components/ui'
import { useAuthStore } from '../../stores/auth.store'
import { useUiStore } from '../../stores/ui.store'
import { formatCurrency } from '../../lib/currency'
import { formatDate } from '../../lib/dates'
import type { ShiftWithStaff, ShiftOrder, AuditEntry } from '../../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function duration(openedAt: string, closedAt: string | null): string {
  const end = closedAt ? new Date(closedAt) : new Date()
  const ms = end.getTime() - new Date(openedAt).getTime()
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ─── ShiftsTab ────────────────────────────────────────────────────────────────

function ShiftsTab() {
  const [shifts, setShifts] = useState<ShiftWithStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [shiftOrders, setShiftOrders] = useState<Record<string, ShiftOrder[]>>({})
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null)
  const [reopening, setReopening] = useState<string | null>(null)

  const { shift: activeShift, setShift, staff } = useAuthStore()
  const showToast = useUiStore((s) => s.showToast)

  async function load() {
    setLoading(true)
    try {
      const data = await api.shifts.list()
      setShifts(data as ShiftWithStaff[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleExpand(shiftId: string) {
    if (expanded === shiftId) {
      setExpanded(null)
      return
    }
    setExpanded(shiftId)
    if (!shiftOrders[shiftId]) {
      setLoadingOrders(shiftId)
      try {
        const orders = await api.shifts.orders(shiftId)
        setShiftOrders((prev) => ({ ...prev, [shiftId]: orders as ShiftOrder[] }))
      } finally {
        setLoadingOrders(null)
      }
    }
  }

  async function handleReopen(s: ShiftWithStaff) {
    if (!window.confirm(`Reopen shift for ${s.staffName} from ${formatDate(s.openedAt)}? The shift will be marked as open again.`)) return
    setReopening(s.id)
    try {
      const reopened = await api.shifts.reopen(s.id)
      showToast('Shift reopened', 'success')
      // If this is the current user's shift, update auth store
      if (staff && s.staffId === staff.id) {
        setShift(reopened as Parameters<typeof setShift>[0])
      }
      load()
    } catch {
      showToast('Failed to reopen shift', 'error')
    } finally {
      setReopening(null)
    }
  }

  const cashVariance = (s: ShiftWithStaff) => {
    if (s.closingCash == null) return null
    return s.closingCash - s.openingCash
  }

  if (loading) return <PageSpinner />

  return (
    <div className="space-y-3">
      {shifts.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">No shifts recorded yet</div>
      )}

      {shifts.map((s) => {
        const isActive = activeShift && (activeShift as { id: string }).id === s.id
        const variance = cashVariance(s)
        const isExpanded = expanded === s.id
        const orders = shiftOrders[s.id] ?? []

        return (
          <div
            key={s.id}
            className={`bg-white rounded-xl border transition-all ${
              isActive ? 'border-emerald-300 shadow-sm' : 'border-gray-200'
            }`}
          >
            {/* Shift header row */}
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Expand toggle */}
              <button
                onClick={() => toggleExpand(s.id)}
                className="text-gray-400 hover:text-gray-600 shrink-0"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              {/* Staff avatar */}
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold shrink-0">
                {s.staffName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>

              {/* Main info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{s.staffName}</span>
                  {isActive && <Badge color="green">Active</Badge>}
                  {s.status === 'closed' && <Badge color="gray">Closed</Badge>}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                  <span>{formatDate(s.openedAt)}</span>
                  <span>⏱ {duration(s.openedAt, s.closedAt)}</span>
                  {s.closedAt && <span>→ {new Date(s.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                </div>
              </div>

              {/* Cash summary */}
              <div className="hidden sm:flex items-center gap-4 text-sm shrink-0">
                <div className="text-right">
                  <p className="text-xs text-gray-400">Opening</p>
                  <p className="font-medium text-gray-700">{formatCurrency(s.openingCash)}</p>
                </div>
                {s.closingCash != null && (
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Closing</p>
                    <p className="font-medium text-gray-700">{formatCurrency(s.closingCash)}</p>
                  </div>
                )}
                {variance != null && (
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Variance</p>
                    <p className={`font-semibold ${variance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                    </p>
                  </div>
                )}
              </div>

              {/* Reopen button — managers/admins only, closed shifts only */}
              {s.status === 'closed' && staff && ['manager', 'admin'].includes(staff.role) && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw size={13} />}
                  loading={reopening === s.id}
                  onClick={() => handleReopen(s)}
                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 shrink-0"
                >
                  Reopen
                </Button>
              )}
            </div>

            {/* Notes */}
            {s.notes && (
              <div className="px-11 pb-2">
                <p className="text-xs text-gray-500 italic">{s.notes}</p>
              </div>
            )}

            {/* Expanded: orders */}
            {isExpanded && (
              <div className="border-t border-gray-100 px-4 py-3">
                {loadingOrders === s.id ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                    <RefreshCw size={12} className="animate-spin" /> Loading orders…
                  </div>
                ) : orders.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">No orders in this shift</p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {orders.length} order{orders.length !== 1 ? 's' : ''} ·{' '}
                      {formatCurrency(
                        orders
                          .filter((o) => o.status === 'completed')
                          .reduce((sum, o) => sum + o.total, 0)
                      )} total sales
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {orders.map((o) => (
                        <div key={o.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50">
                          <div className="flex items-center gap-2">
                            <ShoppingBag size={12} className="text-gray-400" />
                            <span className="font-mono text-blue-600 text-xs">{o.orderNumber}</span>
                            <Badge color={o.status === 'completed' ? 'green' : o.status === 'refunded' ? 'red' : 'gray'}>
                              {o.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400">{new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(o.total)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── AuditTab ─────────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  login:  'bg-purple-100 text-purple-700',
  logout: 'bg-gray-100 text-gray-600',
  open:   'bg-amber-100 text-amber-700',
  close:  'bg-orange-100 text-orange-700',
}

function actionColor(action: string): string {
  const key = Object.keys(ACTION_COLORS).find((k) => action.toLowerCase().includes(k))
  return key ? ACTION_COLORS[key] : 'bg-gray-100 text-gray-600'
}

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(100)

  async function load(l = limit) {
    setLoading(true)
    try {
      const data = await api.audit.list(l)
      setEntries(data as AuditEntry[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function loadMore() {
    const next = limit + 100
    setLimit(next)
    load(next)
  }

  if (loading) return <PageSpinner />

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {['Time', 'Staff', 'Action', 'Entity', 'Details'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center py-12 text-gray-400">No audit log entries yet</td>
            </tr>
          )}
          {entries.map((e) => {
            let details: Record<string, unknown> = {}
            try { details = e.details ? JSON.parse(e.details) : {} } catch { /* ignore */ }
            const detailText = Object.entries(details)
              .filter(([k]) => !['staffId', 'id'].includes(k))
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')

            return (
              <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString([], {
                    month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </td>
                <td className="px-4 py-2.5">
                  {e.staffId ? (
                    <div className="flex items-center gap-1.5">
                      <User size={12} className="text-gray-400" />
                      <span className="text-xs text-gray-700 font-mono">{e.staffId.slice(0, 8)}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">System</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColor(e.action)}`}>
                    {e.action}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600 font-medium capitalize">{e.entityType}</span>
                    {e.entityId && (
                      <span className="text-xs text-gray-400 font-mono">#{e.entityId.slice(0, 6)}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs truncate" title={detailText}>
                  {detailText || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {entries.length === limit && (
        <div className="px-4 py-3 border-t border-gray-100 flex justify-center">
          <Button variant="secondary" size="sm" onClick={loadMore}>Load more</Button>
        </div>
      )}
    </div>
  )
}

// ─── ShiftsScreen ─────────────────────────────────────────────────────────────

type Tab = 'shifts' | 'audit'

export function ShiftsScreen() {
  const [tab, setTab] = useState<Tab>('shifts')

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3 mb-4">
          <Clock size={20} className="text-gray-500" />
          <h1 className="text-xl font-bold text-gray-900">Shift & Activity History</h1>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1">
          {([
            { key: 'shifts', label: 'Shift History', icon: <Clock size={14} /> },
            { key: 'audit',  label: 'Audit Log',     icon: <FileText size={14} /> },
          ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'shifts' ? <ShiftsTab /> : <AuditTab />}
      </div>
    </div>
  )
}
