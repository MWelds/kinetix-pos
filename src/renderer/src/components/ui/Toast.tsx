import React from 'react'
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useUiStore, type Toast } from '../../stores/ui.store'

const icons = {
  success: <CheckCircle size={16} className="text-emerald-500 shrink-0" />,
  error: <AlertCircle size={16} className="text-red-500 shrink-0" />,
  warning: <AlertTriangle size={16} className="text-yellow-500 shrink-0" />,
  info: <Info size={16} className="text-blue-500 shrink-0" />
}

const borderColors = {
  success: 'border-l-emerald-500',
  error: 'border-l-red-500',
  warning: 'border-l-yellow-500',
  info: 'border-l-blue-500'
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast)
  return (
    <div
      className={`flex items-start gap-3 bg-white rounded-lg shadow-lg border border-gray-200 border-l-4 ${borderColors[toast.type]} px-4 py-3 min-w-[280px] max-w-sm`}
      role="alert"
    >
      {icons[toast.type]}
      <p className="flex-1 text-sm text-gray-700">{toast.message}</p>
      <button
        onClick={() => dismiss(toast.id)}
        className="text-gray-400 hover:text-gray-600"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts)
  if (!toasts.length) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
