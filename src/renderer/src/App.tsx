import React, { useEffect, useState, Component, type ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from './stores/auth.store'
import { useCartStore } from './stores/cart.store'
import { useCurrencyStore } from './stores/currency.store'
import { useLogoStore } from './stores/logo.store'
import { useUiStore } from './stores/ui.store'
import { api } from './lib/api'
import type { CurrencyCode } from './lib/currency'
import type { DisplayData } from '../../main/display/customer-display'
import { Sidebar } from './components/layout/Sidebar'
import { ToastContainer } from './components/ui'
import { LoginScreen } from './features/staff/LoginScreen'
import { POSScreen } from './features/pos/POSScreen'
import { OrdersScreen } from './features/orders/OrdersScreen'
import { ProductsScreen } from './features/products/ProductsScreen'
import { CustomersScreen } from './features/customers/CustomersScreen'
import { InventoryScreen } from './features/inventory/InventoryScreen'
import { ReportsScreen } from './features/reports/ReportsScreen'
import { StaffScreen } from './features/staff/StaffScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { CustomerDisplayScreen } from './features/pos/CustomerDisplayScreen'
import { VendorsScreen } from './features/vendors/VendorsScreen'
import { ROUTES, ROLE_LEVEL } from './constants'
import { SetupWizard } from './features/setup/SetupWizard'

/** Top-level error boundary — catches render errors so the app shows a recovery UI instead of a blank screen. */
class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-50 gap-4 p-8">
          <h1 className="text-2xl font-semibold text-red-600">Something went wrong</h1>
          <p className="text-gray-600 text-center max-w-md">
            Kinetix POS encountered an unexpected error. Try restarting the application.
          </p>
          <pre className="text-xs bg-gray-100 rounded p-4 max-w-xl w-full overflow-auto text-gray-700">
            {this.state.error.message}
          </pre>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/** Route guard -- redirects to login if not authenticated */
function RequireAuth({ minRole = 1 }: { minRole?: number }) {
  const { isAuthenticated, staff } = useAuthStore()
  if (!isAuthenticated) return <Navigate to={ROUTES.LOGIN} replace />
  const roleLevel = ROLE_LEVEL[staff?.role ?? 'cashier'] ?? 1
  if (roleLevel < minRole) return <Navigate to={ROUTES.POS} replace />
  return <Outlet />
}

/** App shell with sidebar + main area */
function AppShell() {
  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

/** Pure helper — builds DisplayData from current Zustand state, no side effects. */
function buildDisplayData(): DisplayData {
  const cart = useCartStore.getState()
  const { currency, altCurrency, kydToUsdRate } = useCurrencyStore.getState()
  const items = cart.items
  if (items.length === 0) return { state: 'idle' }
  return {
    state: 'shopping',
    items: items.map((item) => ({
      name: item.variantName ? `${item.productName} (${item.variantName})` : item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: (item.unitPrice - item.discountAmount) * item.quantity,
    })),
    subtotal: cart.subtotal(),
    discountAmount: cart.discountAmount(),
    tax: cart.taxAmount(),
    total: cart.total(),
    currency,
    symbol: currency === 'KYD' ? 'CI$' : '$',
    ...(currency !== 'USD' && cart.total() > 0 && {
      altTotal: cart.total() / kydToUsdRate,
      altCurrency: altCurrency(),
      altSymbol: '$',
    }),
    customer: cart.customer
      ? `${cart.customer.firstName} ${cart.customer.lastName}`
      : undefined,
  }
}

/**
 * Permanent bridge — two parallel mechanisms:
 * 1. IPC push on every cart change (fast path, may silently fail).
 * 2. window.__getDisplayData getter so the main process can PULL state via
 *    executeJavaScript — this is the reliable fallback used by the HTTP server.
 */
function DisplaySyncBridge() {
  useEffect(() => {
    // Expose getter for main-process pull loop
    ;(window as Record<string, unknown>)['__getDisplayData'] = () =>
      JSON.stringify(buildDisplayData())

    function push() {
      api.display.update(buildDisplayData()).catch(() => { /* display not open — ignore */ })
    }

    push()
    const unsubCart = useCartStore.subscribe(push)
    const unsubCurrency = useCurrencyStore.subscribe(push)

    return () => {
      unsubCart()
      unsubCurrency()
      delete (window as Record<string, unknown>)['__getDisplayData']
    }
  }, [])

  return null
}

/**
 * Listens for update:ready from the main process and notifies staff.
 * Since autoInstallOnAppQuit is enabled, the update applies on next close.
 * Guarded: if the preload doesn't expose onUpdateReady (e.g. older build),
 * skip silently rather than crashing the entire app tree.
 */
function UpdateBanner() {
  const showToast = useUiStore((s) => s.showToast)
  useEffect(() => {
    if (typeof api.listeners?.onUpdateReady !== 'function') return
    const unsub = api.listeners.onUpdateReady(() => {
      showToast('Update downloaded — restart Kinetix POS to install the latest version.', 'info')
    })
    return unsub
  }, [showToast])
  return null
}

/** Loads persisted settings from the DB into Zustand stores once on startup. */
function SettingsHydrator() {
  const setTaxEnabled = useCartStore((s) => s.setTaxEnabled)
  const setTaxRate = useCartStore((s) => s.setTaxRate)
  const setCurrency = useCurrencyStore((s) => s.setCurrency)
  const setKydToUsdRate = useCurrencyStore((s) => s.setKydToUsdRate)
  const setLogo = useLogoStore((s) => s.setLogo)

  useEffect(() => {
    api.settings.getAll().then((s) => {
      if (s.taxEnabled !== undefined) setTaxEnabled(s.taxEnabled === 'true')
      if (s.taxRate) setTaxRate(parseFloat(s.taxRate) || 0.08)

      if (s.kydToUsdRate) setKydToUsdRate(parseFloat(s.kydToUsdRate) || 1.20)
      if (s.logoBase64) setLogo(s.logoBase64)
    }).catch(() => { /* settings unavailable -- use defaults */ })
  }, [setTaxEnabled, setTaxRate, setCurrency, setKydToUsdRate, setLogo])

  return null
}

export function App() {
  const [setupDone, setSetupDone] = useState<boolean | null>(null) // null = loading

  useEffect(() => {
    api.setup.get()
      .then((data) => setSetupDone(data.setupComplete === 'true'))
      .catch(() => setSetupDone(true)) // if IPC fails, don't block the app
  }, [])

  // Still checking
  if (setupDone === null) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // First launch — show wizard
  if (!setupDone) {
    return (
      <AppErrorBoundary>
        <SetupWizard onComplete={() => setSetupDone(true)} />
      </AppErrorBoundary>
    )
  }

  return (
    <AppErrorBoundary>
    <HashRouter>
      <Routes>
        {/* Public */}
        <Route path={ROUTES.LOGIN} element={<LoginScreen />} />
        <Route path="/customer-display" element={<CustomerDisplayScreen />} />
        <Route path="/" element={<Navigate to={ROUTES.LOGIN} replace />} />

        {/* Protected -- all roles */}
        <Route element={<RequireAuth minRole={1} />}>
          <Route element={<AppShell />}>
            <Route path={ROUTES.POS} element={<POSScreen />} />
            <Route path={ROUTES.ORDERS} element={<OrdersScreen />} />
            <Route path={ROUTES.CUSTOMERS} element={<CustomersScreen />} />
          </Route>
        </Route>

        {/* Protected -- manager+ */}
        <Route element={<RequireAuth minRole={2} />}>
          <Route element={<AppShell />}>
            <Route path={ROUTES.PRODUCTS} element={<ProductsScreen />} />
            <Route path={ROUTES.INVENTORY} element={<InventoryScreen />} />
            <Route path={ROUTES.REPORTS} element={<ReportsScreen />} />
            <Route path={ROUTES.VENDORS} element={<VendorsScreen />} />
          </Route>
        </Route>

        {/* Protected --admin only */}
        <Route element={<RequireAuth minRole={3} />}>
          <Route element={<AppShell />}>
            <Route path={ROUTES.STAFF} element={<StaffScreen />} />
            <Route path={ROUTES.SETTINGS} element={<SettingsScreen />} />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to={ROUTES.LOGIN} replace />} />
      </Routes>

      <ToastContainer />
      <SettingsHydrator />
      <DisplaySyncBridge />
      <UpdateBanner />
    </HashRouter>
    </AppErrorBoundary>
  )
}
