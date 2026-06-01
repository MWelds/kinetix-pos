import React, { useState, useEffect } from 'react'
import { ShoppingBag, Delete, KeyRound, ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth.store'
import { useLogoStore } from '../../stores/logo.store'
import { api } from '../../lib/api'
import { Button } from '../../components/ui'
import { ROUTES } from '../../constants'

// ─── Forgot PIN modal ─────────────────────────────────────────────────────────

type ResetStep = 'select' | 'authorize' | 'newpin' | 'done'

interface StaffListItem {
  id: string
  firstName: string
  lastName: string
  role: string
}

function ForgotPinModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<ResetStep>('select')
  const [staffList, setStaffList] = useState<StaffListItem[]>([])
  const [selectedStaff, setSelectedStaff] = useState<StaffListItem | null>(null)
  const [adminPin, setAdminPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  /** When true, the "adminPin" field holds the sync API key for emergency recovery. */
  const [useRecoveryKey, setUseRecoveryKey] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')

  useEffect(() => {
    api.staff.list().then((list) => setStaffList(list as StaffListItem[])).catch(() => {})
  }, [])

  function appendAdmin(digit: string) {
    if (adminPin.length >= 4) return
    setAdminPin((p) => p + digit)
    setError('')
  }

  function appendNew(digit: string, field: 'new' | 'confirm') {
    if (field === 'new') {
      if (newPin.length >= 4) return
      setNewPin((p) => p + digit)
    } else {
      if (confirmPin.length >= 4) return
      setConfirmPin((p) => p + digit)
    }
    setError('')
  }

  async function handleAuthorize() {
    setLoading(true)
    setError('')
    try {
      if (useRecoveryKey) {
        // Recovery key validation happens server-side at reset time.
        // Just require something was entered before advancing.
        if (!recoveryKey.trim()) { setError('Enter your recovery key'); return }
        setStep('newpin')
      } else {
        if (adminPin.length !== 4) return
        const authorizer = await api.staff.auth(adminPin)
        if (!authorizer) { setError('Invalid manager PIN'); setAdminPin(''); return }
        const role = (authorizer as StaffListItem).role
        if (role !== 'manager' && role !== 'admin') {
          setError('Only a manager or admin can authorize a PIN reset')
          setAdminPin('')
          return
        }
        setStep('newpin')
      }
    } catch { setError('Authorization failed') }
    finally { setLoading(false) }
  }

  async function handleReset() {
    if (newPin.length !== 4 || confirmPin.length !== 4) return
    if (newPin !== confirmPin) { setError('PINs do not match'); setConfirmPin(''); return }
    if (!selectedStaff) return
    setLoading(true)
    setError('')
    try {
      const credential = useRecoveryKey ? recoveryKey.trim() : adminPin
      const result = await api.staff.resetPin({
        staffId: selectedStaff.id,
        adminPin: credential,
        newPin,
        useRecoveryKey,
      })
      if (!result.ok) { setError(result.error ?? 'Reset failed'); return }
      setStep('done')
    } catch { setError('Reset failed') }
    finally { setLoading(false) }
  }

  const PinDots = ({ value }: { value: string }) => (
    <div className="flex justify-center gap-3 my-3">
      {[0,1,2,3].map((i) => (
        <div key={i} className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all ${
          i < value.length ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white'
        }`}>
          {i < value.length && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
        </div>
      ))}
    </div>
  )

  const MiniPad = ({ onDigit, onBack }: { onDigit: (d: string) => void; onBack: () => void }) => (
    <div className="grid grid-cols-3 gap-2">
      {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => {
        if (!k) return <div key={i} />
        return (
          <button key={k} type="button"
            onClick={() => k === '⌫' ? onBack() : onDigit(k)}
            className={`h-11 rounded-xl text-base font-semibold transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              k === '⌫' ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
            }`}
          >{k}</button>
        )
      })}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl p-7 w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <KeyRound size={18} className="text-blue-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">Reset PIN</h2>
            <p className="text-xs text-gray-500">
              {step === 'select'    && 'Who needs a PIN reset?'}
              {step === 'authorize' && 'Manager authorization required'}
              {step === 'newpin'    && `Set new PIN for ${selectedStaff?.firstName}`}
              {step === 'done'      && 'PIN updated successfully'}
            </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {/* Step 1 — select staff member */}
        {step === 'select' && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {staffList.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Loading staff…</p>
            )}
            {staffList.map((s) => (
              <button key={s.id} type="button"
                onClick={() => { setSelectedStaff(s); setStep('authorize'); setError('') }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {s.firstName[0]}{s.lastName[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{s.firstName} {s.lastName}</p>
                  <p className="text-xs text-gray-500 capitalize">{s.role}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — manager authorizes */}
        {step === 'authorize' && (
          <div>
            {!useRecoveryKey ? (
              <>
                <p className="text-sm text-gray-600 mb-1 text-center">
                  Enter a <span className="font-semibold">manager or admin</span> PIN to authorize
                  resetting <span className="font-semibold">{selectedStaff?.firstName}'s</span> PIN.
                </p>
                <PinDots value={adminPin} />
                <MiniPad
                  onDigit={appendAdmin}
                  onBack={() => { setAdminPin((p) => p.slice(0, -1)); setError('') }}
                />
                <Button className="w-full mt-4" disabled={adminPin.length !== 4 || loading} loading={loading} onClick={handleAuthorize}>
                  Authorize
                </Button>
                <button
                  type="button"
                  onClick={() => { setUseRecoveryKey(true); setAdminPin(''); setError('') }}
                  className="mt-3 w-full text-xs text-gray-400 hover:text-blue-600 transition-colors"
                >
                  No manager available? Use recovery key instead
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-3 text-center">
                  Enter the <span className="font-semibold">Sync API Key</span> configured in
                  Settings → Sync. This is your emergency recovery credential.
                </p>
                <input
                  type="password"
                  autoFocus
                  value={recoveryKey}
                  onChange={(e) => { setRecoveryKey(e.target.value); setError('') }}
                  placeholder="Paste recovery / API key here"
                  className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAuthorize() }}
                />
                <Button className="w-full" disabled={!recoveryKey.trim() || loading} loading={loading} onClick={handleAuthorize}>
                  Verify Recovery Key
                </Button>
                <button
                  type="button"
                  onClick={() => { setUseRecoveryKey(false); setRecoveryKey(''); setError('') }}
                  className="mt-3 w-full text-xs text-gray-400 hover:text-blue-600 transition-colors"
                >
                  Back to manager PIN
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 3 — enter new PIN */}
        {step === 'newpin' && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">New PIN</p>
              <PinDots value={newPin} />
              <MiniPad
                onDigit={(d) => appendNew(d, 'new')}
                onBack={() => { setNewPin((p) => p.slice(0, -1)); setError('') }}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Confirm PIN</p>
              <PinDots value={confirmPin} />
              <MiniPad
                onDigit={(d) => appendNew(d, 'confirm')}
                onBack={() => { setConfirmPin((p) => p.slice(0, -1)); setError('') }}
              />
            </div>
            <Button className="w-full" disabled={newPin.length !== 4 || confirmPin.length !== 4 || loading} loading={loading} onClick={handleReset}>
              Set New PIN
            </Button>
          </div>
        )}

        {/* Step 4 — success */}
        {step === 'done' && (
          <div className="text-center py-4 space-y-3">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <KeyRound size={24} className="text-emerald-600" />
            </div>
            <p className="font-semibold text-gray-900">{selectedStaff?.firstName}'s PIN has been reset.</p>
            <p className="text-sm text-gray-500">They can now log in with their new PIN.</p>
            <Button className="w-full mt-2" onClick={onClose}>Back to Login</Button>
          </div>
        )}

        {step !== 'done' && (
          <button type="button"
            onClick={() => {
              if (step === 'authorize') {
                setStep('select')
                setAdminPin('')
                setRecoveryKey('')
                setUseRecoveryKey(false)
                setError('')
              } else if (step === 'newpin') {
                setStep('authorize')
                setNewPin('')
                setConfirmPin('')
                setError('')
              } else {
                onClose()
              }
            }}
            className="mt-4 w-full flex items-center justify-center gap-1 text-sm text-gray-400 hover:text-gray-600"
          >
            <ChevronLeft size={14} /> {step === 'select' ? 'Cancel' : 'Back'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Login screen ─────────────────────────────────────────────────────────────

export function LoginScreen() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgotPin, setShowForgotPin] = useState(false)
  const login = useAuthStore((s) => s.login)
  const setShift = useAuthStore((s) => s.setShift)
  const logoBase64 = useLogoStore((s) => s.logoBase64)
  const navigate = useNavigate()

  function append(digit: string) {
    if (pin.length >= 4) return
    const next = pin + digit
    setPin(next)
    setError('')
    if (next.length === 4) {
      setTimeout(() => submitPin(next), 80)
    }
  }

  function backspace() {
    setPin((p) => p.slice(0, -1))
    setError('')
  }

  async function submitPin(value: string) {
    if (value.length < 4) { setError('PIN must be 4 digits'); return }
    setLoading(true)
    try {
      const staff = await api.staff.auth(value)
      if (!staff) { setError('Invalid PIN. Try again.'); setPin(''); return }
      login(staff as Parameters<typeof login>[0])
      try {
        const shift = await api.shifts.current(staff.id)
        if (shift) setShift(shift as Parameters<typeof setShift>[0])
      } catch {
        // No shift yet
      }
      navigate(ROUTES.POS)
    } catch { setError('Login failed') }
    finally { setLoading(false) }
  }

  function handleLogin() { submitPin(pin) }

  // Physical keyboard support — digits, Backspace, Delete, Enter.
  // Uses functional setPin so the handler never captures a stale `pin` value.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (/^[0-9]$/.test(e.key)) {
        const digit = e.key
        setPin((prev) => {
          if (prev.length >= 4) return prev
          const next = prev + digit
          setError('')
          if (next.length === 4) setTimeout(() => submitPin(next), 80)
          return next
        })
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        setPin((p) => p.slice(0, -1))
        setError('')
      } else if (e.key === 'Enter') {
        setPin((current) => { submitPin(current); return current })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // submitPin is stable (no dependency on pin); only needs to run once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const PAD = [['1','2','3'],['4','5','6'],['7','8','9'],['','0','\u232b']]

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        {/* Logo / branding */}
        <div className="flex flex-col items-center mb-8">
          {logoBase64 ? (
            <img
              src={logoBase64}
              alt="Store logo"
              className="h-20 w-auto max-w-[200px] object-contain mb-3"
            />
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mb-3">
                <ShoppingBag size={32} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Kinetix POS</h1>
            </>
          )}
          <p className="text-sm text-gray-500 mt-1">Enter your PIN to continue</p>
        </div>

        {/* PIN display */}
        <div className="flex justify-center gap-3 mb-6">
          {[0,1,2,3].map((i) => (
            <div key={i} className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ${
              i < pin.length ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white'
            }`}>
              {i < pin.length && <div className="w-3 h-3 rounded-full bg-white" />}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-center text-sm text-red-600 mb-4 bg-red-50 rounded-lg py-2">{error}</p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {PAD.flat().map((key, i) => {
            if (!key) return <div key={i} />
            return (
              <button
                key={key}
                onClick={() => key === '\u232b' ? backspace() : append(key)}
                className={[
                  'h-14 rounded-xl text-xl font-semibold transition-all active:scale-95',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500',
                  key === '\u232b'
                    ? 'bg-red-50 text-red-500 hover:bg-red-100'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                ].join(' ')}
                aria-label={key === '\u232b' ? 'Backspace' : `Digit ${key}`}
              >
                {key === '\u232b' ? <Delete size={20} className="mx-auto" /> : key}
              </button>
            )
          })}
        </div>

        <Button
          onClick={handleLogin}
          loading={loading}
          disabled={pin.length !== 4}
          className="w-full h-12 text-base font-semibold"
        >
          Sign In
        </Button>

        <button
          type="button"
          onClick={() => setShowForgotPin(true)}
          className="mt-4 w-full text-sm text-gray-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-1"
        >
          <KeyRound size={13} />
          Forgot PIN?
        </button>
      </div>

      {showForgotPin && <ForgotPinModal onClose={() => setShowForgotPin(false)} />}
    </div>
  )
}
