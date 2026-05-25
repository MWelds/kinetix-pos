import React, { useState } from 'react'
import { ShoppingBag, Delete } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth.store'
import { useLogoStore } from '../../stores/logo.store'
import { api } from '../../lib/api'
import { Button } from '../../components/ui'
import { ROUTES } from '../../constants'

export function LoginScreen() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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

  const PAD = [['1','2','3'],['4','5','6'],['7','8','9'],['','0','⌫']]

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
                onClick={() => key === '⌫' ? backspace() : append(key)}
                className={[
                  'h-14 rounded-xl text-xl font-semibold transition-all active:scale-95',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500',
                  key === '⌫'
                    ? 'bg-red-50 text-red-500 hover:bg-red-100'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                ].join(' ')}
                aria-label={key === '⌫' ? 'Backspace' : `Digit ${key}`}
              >
                {key === '⌫' ? <Delete size={20} className="mx-auto" /> : key}
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
      </div>
    </div>
  )
}
