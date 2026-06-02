import React, { useState, useEffect } from 'react'
import { ShoppingBag, Delete, KeyRound, ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth.store'
import { useLogoStore } from '../../stores/logo.store'
import { api } from '../../lib/api'
import { Button } from '../../components/ui'
import { ROUTES } from '../../constants'

// ─── Forgot PIN modal ─────────────────────────────────────────────────────────

type ResetStep = 'select' | 'authorize' | 'emailcode' | 'newpin' | 'done'

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
  const [maskedEmail, setMaskedEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)

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

  async function handleSendCode() {
    if (!selectedStaff) return
    setSendingCode(true)
    setError('')
    try {
      const result = await api.staff.sendResetCode(selectedStaff.id)
      if (!result.ok) { setError(result.error ?? 'Failed to send code'); return }
      setMaskedEmail(result.maskedEmail ?? '')
      setStep('emailcode')
    } catch { setError('Failed to send reset email') }
    finally { setSendingCode(false) }
  }

  function handleVerifyCode() {
    // Just validate format locally — the code is verified + PIN set atomically in handleReset
    if (emailCode.trim().length !== 6) { setError('Enter the 6-digit code from your email'); return }
    setError('')
    setStep('newpin')
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
      let result: { ok: boolean; error?: string }

      if (emailCode) {
        // Email code path: verify code + set PIN atomically
        result = await api.staff.verifyResetCode({ staffId: selectedStaff.id, code: emailCode.trim(), newPin })
      } else {
        // Manager PIN or recovery key path
        const credential = useRecoveryKey ? recoveryKey.trim() : adminPin
        result = await api.staff.resetPin({ staffId: selectedStaff.id, adminPin: credential, newPin, useRecoveryKey })
      }

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
          <button key={k