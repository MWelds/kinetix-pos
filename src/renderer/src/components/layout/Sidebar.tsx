import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ShoppingCart, Package, Users, Archive, BarChart3, Settings,
  ClipboardList, UserCircle, LogOut, ChevronRight, Clock, Sun, Store
} from 'lucide-react'
import { useAuthStore } from '../../stores/auth.store'
import { useLogoStore } from '../../stores/logo.store'
import { api } from '../../lib/api'
import { ROUTES, ROLE_LEVEL } from '../../constants'
import { ShiftModal } from '../../features/staff/ShiftModal'
import { EndOfDayModal } from '../../features/staff/EndOfDayModal'

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
  { to: ROUTES.REPORTS, icon: <BarChart3 size={18} />, label: 'Reports', minRole: 2 },
  { to: ROUTES.VENDORS, icon: <Store size={18} />, label: 'Vendors', minRole: 2 },
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
                isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
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
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <Clock size={14} />
          <span className="flex-1 text-left">
            Shift:{' '}
            {shift ? (
              <span className="text-emerald-400">Open</span>
            ) : (
              <span className="text-gray-500">Closed</span>
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
            <p className="text-[10px] text-gray-500 capitalize">{staff?.role}</p>
            <p className="text-[10px] text-gray-600 mt-0.5 truncate">{terminalName}</p>
          </div>
          <button onClick={handleLogout} className="text-gray-500 hover:text-red-400" aria-label="Log out">
            <LogOut size={14} />
          </button>
        </div>
      </div>

      <ShiftModal isOpen={showShift} onClose={() => setShowShift(false)} />
      <EndOfDayModal isOpen={showEod} onClose={() => setShowEod(false)} />
    </aside>
  )
}
