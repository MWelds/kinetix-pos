import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ShoppingCart, Package, Users, Archive, BarChart3, Settings,
  ClipboardList, UserCircle, LogOut, ChevronRight, Clock, Sun, Store,
  RefreshCw, WifiOff, CheckCircle2, AlertCircle, History
} from 'lucide-react'
import { useAuthStore } from '../../stores/auth.store'
import { useLogoStore } from '../../stores/logo.store'
import { api } from '../../lib/api'
import { ROUTES, ROLE_LEVEL } from '../../constants'
import { ShiftModal } from '../../features/staff/ShiftModal'
import { EndOfDayModal } from '../../features/staff/EndOfDayModal'

type SyncShape = { status: string; error: string | null; lastSyncAt: string | null }

/** Sync status bar + manual Sync Now button shown at the bottom of the sidebar.
 *  Automatically shows v2 state when syncVersion is set to 'v2'. */
function SyncIndicator() {
  const [syncVersion, setSyncVersion] = useState<string>('')
  const [syncState, setSyncState] = useState<SyncShape | null>(null)
  const [syncV2State, setSyncV2State] = useState<SyncShape | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    // Load initial version setting
    api.settings.get('syncVersion').then((v) => setSyncVersion(v ?? '')).catch(() => {})

    // Subscribe to both protocol state streams; only one will be active at a time
    api.sync.getState().then(setSyncState).catch(() => {})
    const unsubV1 = api.sync.onStateChange((s: unknown) => setSyncState(s as SyncShape))

    api.syncV2.getState().then(setSyncV2State).catch(() => {})
    const unsubV2 = api.syncV2.onStateChange((s: unknown) => {
      setSyncV2State(s as SyncShape)
      // When v2 fires state, we're definitely on v2
      setSyncVersion('v2')
    })

    return () => { unsubV1(); unsubV2() }
  }, [])

  const isV2 = syncVersion === 'v2'
  const activeState = isV2 ? syncV2State : syncState

  if (!activeState || activeState.status === 'disabled') return null

  const isSyncing = activeState.status === 'syncing' || syncing

  const icon =
    isSyncing                        ? <RefreshCw size={11} className="animate-spin" /> :
    activeState.status === 'synced'  ? <CheckCircle2 size={11} /> :
    activeState.status === 'error'   ? <AlertCircle size={11} /> :
    <WifiOff size={11} />

  const color =
    activeState.status === 'synced'  ? 'text-green-400' :
    isSyncing                        ? 'text-blue-400'  :
    activeState.status === 'error'   ? 'text-red-400'   : 'text-slate-400'

  const label =
    isSyncing                        ? 'Syncing\u2026' :
    activeState.status === 'synced'  ? `Synced${activeState.lastSyncAt ? ' ' + new Date(activeState.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}${isV2 ? ' \u00b7v2' : ''}` :
    activeState.status === 'error'   ? 'Sync error' : 'Offline'

  async function handleSyncNow() {
    if (isSyncing) return
    setSyncing(true)
    try {
      if (isV2) {
        await api.syncV2.runNow()
      } else {
        await api.sync.runNow()
      }
    } catch { /* error state shown via onStateChange */ }
    finally { setSyncing(false) }
  }

  return (
    <div className="border-t border-gray-800 px-3 py-2 flex items-center justify-between gap-2">
      <div className={`flex items-center gap-1.5 ${color} text-xs min-w-0`} title={activeState.error ?? label}>
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <button
        type="button"
        onClick={handleSyncNow}
        disabled={isSyncing}
        title="Sync now"
        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <RefreshCw size={10} className={isSyncing ? 'animate-spin' : ''} />
        Sync
      </button>
    </div>
  )
}

interface NavItem {
  to: string
  icon: React.ReactNode
  label: string
  minRole?: number
}

const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.POS, icon: <ShoppingCart size={18} />, label: 'Point of Sale' },
  { to: ROUTES.ORDERS, icon: <ClipboardList size={18} />, label: 'Orders' },
  { to: ROUTES.PRODUCTS, icon: <Package size={18} />, label: 'Products', minRole: 2 },
  { to: ROUTES.CUSTOMERS, icon: <Users size={18} />, label: 'Customers' },
  { to: ROUTES.INVENTORY, icon: <Archive size={18} />, label: 'Inventory', minRole: 2 },
  { to: ROUTES.EOD_REPORT, icon: <Sun size={18} />, label: 'End of Day Report' },
  { to: ROUTES.REPORTS, icon: <BarChart3 size={18} />, label: 'Reports', minRole: 2 },
  { to: ROUTES.VENDORS, icon: <Store size={18} />, label: 'Vendors', minRole: 2 },
  { to: ROUTES.SHIFTS, icon: <History size={18} />, label: 'Shifts & Logs', minRole: 2 },
  { to: ROUTES.STAFF, icon: <UserCircle size={18} />, label: 'Staff', minRole: 3 },
  { to: ROUTES.SETTINGS, icon: <Settings size={18} />, label: 'Settings', minRole: 3 }
]

export function Sidebar() {
  const { staff, shift, logout } = useAuthStore()
  const logoBase64 = useLogoStore((s) => s.logoBase64)
  const navigate = useNavigate()
  const [showShift, setShowShift] = useState(false)
  const [showEod, setShowEod] = useState(false)
  const [terminalName, setTerminalName] = useState('Terminal 1')

  useEffect(() => {
    api.settings.get('terminalName').then((v) => { if (v) setTerminalName(v) }).catch(() => {})
  }, [])
  const roleLevel = ROLE_LEVEL[staff?.role ?? 'cashier'] ?? 1

  function handleLogout() {
    logout()
    navigate(ROUTES.LOGIN)
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-gray-900 text-white h-full">
      {/* Logo / branding */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800">
        {logoBase64 ? (
          <img
            src={logoBase64}
            alt="Store logo"
            className="h-9 w-auto max-w-[140px] object-contain rounded"
          />
        ) : (
          <>
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <ShoppingCart size={16} className="text-white" />
            </div>
            <span className="font-bold text-sm text-white truncate">Kinetix POS</span>
          </>
        )}
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {NAV_ITEMS.filter((item) => !item.minRole || roleLevel >= item.minRole).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-gray-800 p-4 space-y-3">
        {/* End of Day */}
        <button
          onClick={() => setShowEod(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 transition-colors"
        >
          <Sun size={14} />
          <span className="flex-1 text-left">End of Day</span>
        </button>

        <button
          onClick={() => setShowShift(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <Clock size={14} />
          <span className="flex-1 text-left">
            Shift:{' '}
            {shift ? (
              <span className="text-emerald-400">Open</span>
            ) : (
              <span className="text-slate-400">Closed</span>
            )}
          </span>
          <ChevronRight size={12} />
        </button>

        <div className="flex items-center gap-3 px-3">
          <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-xs font-medium text-white shrink-0">
            {staff?.firstName[0]}{staff?.lastName[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {staff?.firstName} {staff?.lastName}
            </p>
            <p className="text-[10px] text-slate-400 capitalize">{staff?.role}</p>
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">{terminalName}</p>
          </div>
          <button onClick={handleLogout} className="text-slate-400 hover:text-red-400" aria-label="Log out">
            <LogOut size={14} />
          </button>
        </div>
      </div>

      <SyncIndicator />

      <ShiftModal isOpen={showShift} onClose={() => setShowShift(false)} />
      <EndOfDayModal isOpen={showEod} onClose={() => setShowEod(false)} />
    </aside>
  )
}
