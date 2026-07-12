import React, { useState } from 'react'
import { Modal, Button, Input } from '../../components/ui'
import { useAuthStore } from '../../stores/auth.store'
import { useUiStore } from '../../stores/ui.store'
import { api } from '../../lib/api'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function ShiftModal({ isOpen, onClose }: Props) {
  const { staff, shift, setShift } = useAuthStore()
  const showToast = useUiStore((s) => s.showToast)
  const [cashAmount, setCashAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const isOpen_ = !!shift

  async function handleOpenShift() {
    if (!staff) return
    setLoading(true)
    try {
      const s = await api.shifts.open(staff.id, parseFloat(cashAmount) || 0)
      setShift(s as Parameters<typeof setShift>[0])
      showToast('Shift opened', 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to open shift', 'error')
    } finally { setLoading(false) }
  }

  async function handleCloseShift() {
    if (!shift) return
    setLoading(true)
    try {
      await api.shifts.close((shift as { id: string }).id, parseFloat(cashAmount) || 0, notes, staff?.id)
      setShift(null)
      showToast('Shift closed', 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to close shift', 'error')
    } finally { setLoading(false) }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isOpen_ ? 'Close Shift' : 'Open Shift'} size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant={isOpen_ ? 'danger' : 'primary'}
            onClick={isOpen_ ? handleCloseShift : handleOpenShift}
            loading={loading}
          >
            {isOpen_ ? 'Close Shift' : 'Open Shift'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={isOpen_ ? 'Closing Cash Count ($)' : 'Opening Cash ($)'}
          type="number"
          step="0.01"
          value={cashAmount}
          onChange={(e) => setCashAmount(e.target.value)}
          autoFocus
        />
        {isOpen_ && (
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
      </div>
    </Modal>
  )
}
