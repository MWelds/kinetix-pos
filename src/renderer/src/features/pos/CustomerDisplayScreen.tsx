import React, { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { DisplayData } from '../../../../shared/display-types'

// ─── State machine views ──────────────────────────────────────────────────────

function IdleView({ storeName, logoBase64 }: { storeName: string; logoBase64?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
      {logoBase64 ? (
        <img
          src={logoBase64}
          alt="Store logo"
          className="h-28 w-auto max-w-xs object-contain opacity-90"
        />
      ) : (
        <div className="text-8xl opacity-20 select-none">🛍️</div>
      )}
      <div>
        <h1 className="text-5xl font-black text-slate-300 tracking-tight">{storeName}</h1>
        <p className="text-xl text-slate-500 mt-3">Welcome! Please place your items on the counter.</p>
      </div>
    </div>
  )
}

function ShoppingView({ data }: { data: DisplayData }) {
  const sym = data.symbol ?? '$'
  const fmt = (n: number) => `${sym}${(n ?? 0).toFixed(2)}`

  return (
    <div className="flex flex-col h-full gap-5 w-full max-w-3xl mx-auto py-8 px-6">
      {data.customer && (
        <p className="text-blue-400 font-semibold text-lg text-center">
          Welcome back, {data.customer}! 👋
        </p>
      )}

      <div className="flex-1 overflow-y-auto bg-slate-800 rounded-2xl border border-slate-700 divide-y divide-slate-700 min-h-0">
        {(!data.items || data.items.length === 0) ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-lg py-12">No items yet</div>
        ) : (
          data.items.map((item, i) => (
            <div key={i} className="flex items-center px-5 py-4 gap-4">
              <div className="flex-1 text-lg font-semibold text-slate-100 truncate">{item.name}</div>
              <div className="text-slate-400 text-sm w-10 text-center">×{item.quantity}</div>
              <div className="text-blue-300 font-bold text-lg w-24 text-right">{fmt(item.lineTotal)}</div>
            </div>
          ))
        )}
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 px-6 py-5 space-y-2">
        <TotalsRow label="Subtotal" value={fmt(data.subtotal ?? 0)} />
        {(data.discountAmount ?? 0) > 0 && (
          <TotalsRow label="Discount" value={`-${fmt(data.discountAmount ?? 0)}`} accent="green" />
        )}
        {(data.tax ?? 0) > 0 && <TotalsRow label="Tax" value={fmt(data.tax ?? 0)} />}
        <div className="border-t border-slate-700 pt-3 mt-2">
          <TotalsRow label="Total" value={fmt(data.total ?? 0)} large />
          {data.altTotal != null && data.altCurrency && (
            <div className="flex justify-between text-slate-500 text-sm mt-1">
              <span>≈ {data.altCurrency}</span>
              <span>{data.altSymbol}{(data.altTotal).toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TotalsRow({ label, value, large, accent }: {
  label: string; value: string; large?: boolean; accent?: 'green'
}) {
  const colorClass = accent === 'green' ? 'text-emerald-400' : large ? 'text-slate-100' : 'text-slate-400'
  return (
    <div className={`flex justify-between items-center ${large ? 'text-2xl font-black' : 'text-base'} ${colorClass}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  )
}

function PaymentProcessingView({ data }: { data: DisplayData }) {
  const sym = data.symbol ?? '$'
  const fmt = (n: number) => `${sym}${(n ?? 0).toFixed(2)}`
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 text-center">
      <div className="w-20 h-20 rounded-full border-4 border-slate-700 border-t-blue-500 animate-spin" />
      <div>
        <p className="text-slate-400 text-xl font-medium">Processing Payment</p>
        <p className="text-6xl font-black text-blue-400 mt-3">{fmt(data.total ?? 0)}</p>
      </div>
      <p className="text-slate-500 text-lg">Please follow the terminal prompts</p>
    </div>
  )
}

function CompleteView({ data }: { data: DisplayData }) {
  const sym = data.changeSymbol ?? '$'
  const fmt = (n: number) => `${sym}${(n ?? 0).toFixed(2)}`

  const [email, setEmail] = useState('')
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [emailError, setEmailError] = useState('')
  const [emailType, setEmailType] = useState<'receipt' | 'invoice'>('receipt')

  // Reset when a new sale comes in
  React.useEffect(() => {
    setEmail('')
    setEmailStatus('idle')
    setEmailError('')
  }, [data.orderNumber])

  async function handleSendEmail() {
    const trimmed = email.trim()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address')
      return
    }
    if (!data.completedReceiptHtml) {
      setEmailError('Receipt not available')
      return
    }
    setEmailStatus('sending')
    setEmailError('')
    try {
      const result = emailType === 'receipt'
        ? await api.email.sendReceipt(trimmed, data.completedReceiptHtml, data.orderNumber ?? '')
        : await api.email.sendInvoice(trimmed, data.completedReceiptHtml, data.orderNumber ?? '')
      if (result.success) {
        setEmailStatus('sent')
      } else {
        setEmailStatus('error')
        setEmailError(result.error ?? 'Failed to send')
      }
    } catch {
      setEmailStatus('error')
      setEmailError('Email service unavailable')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-8">
      <div className="w-24 h-24 rounded-full bg-emerald-500 flex items-center justify-center text-5xl font-black text-white shadow-lg shadow-emerald-500/30">
        ✓
      </div>
      <div>
        <h2 className="text-5xl font-black text-emerald-400">Thank You!</h2>
        {(data.change ?? 0) > 0 && (
          <p className="text-3xl text-slate-300 mt-4">
            Change: <span className="font-black text-white">{fmt(data.change ?? 0)}</span>
          </p>
        )}
      </div>
      {(data.loyaltyEarned ?? 0) > 0 && (
        <div className="bg-violet-500/10 border border-violet-500/30 rounded-full px-6 py-3 text-violet-300 font-semibold text-lg">
          🎁 +{data.loyaltyEarned} loyalty points earned!
        </div>
      )}

      {/* Email capture */}
      {emailStatus === 'sent' ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-8 py-5 text-emerald-300 font-semibold text-xl">
          ✓ Email sent!
        </div>
      ) : (
        <div className="w-full max-w-md bg-slate-800/80 border border-slate-700 rounded-2xl p-5 space-y-3">
          <p className="text-slate-300 font-semibold text-lg">Get your receipt by email</p>

          {/* Receipt / Invoice toggle */}
          <div className="flex rounded-lg overflow-hidden border border-slate-600 text-sm font-semibold">
            <button
              type="button"
              onClick={() => setEmailType('receipt')}
              className={`flex-1 py-2 transition-colors ${emailType === 'receipt' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
            >
              Receipt
            </button>
            <button
              type="button"
              onClick={() => setEmailType('invoice')}
              className={`flex-1 py-2 transition-colors ${emailType === 'invoice' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
            >
              Invoice
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendEmail() }}
              placeholder="your@email.com"
              className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="email"
            />
            <button
              type="button"
              onClick={handleSendEmail}
              disabled={emailStatus === 'sending' || !email}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-base"
            >
              {emailStatus === 'sending' ? '…' : 'Send'}
            </button>
          </div>
          {emailError && (
            <p className="text-red-400 text-sm">{emailError}</p>
          )}
          {emailStatus === 'error' && !emailError && (
            <p className="text-red-400 text-sm">Failed to send — check email settings</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CustomerDisplayScreen() {
  const [data, setData] = useState<DisplayData>({ state: 'idle', storeName: 'POS System' })
  const [logoBase64, setLogoBase64] = useState<string | null>(null)
  const [displayBgColor, setDisplayBgColor] = useState('#0f172a')
  const [displayBgImage, setDisplayBgImage] = useState<string | null>(null)

  useEffect(() => {
    // 1. Register push listener first so we don't miss any future pushes
    const applyData = (d: DisplayData) => {
      setData(d)
      if (d.logoBase64) setLogoBase64(d.logoBase64)
      if (d.displayBgColor) setDisplayBgColor(d.displayBgColor)
      // Use !== undefined so an empty string correctly clears the bg image
      if (d.displayBgImage !== undefined) setDisplayBgImage(d.displayBgImage || null)
    }

    const unsubscribe = api.listeners.onDisplayPush((payload) => {
      applyData(payload as DisplayData)
    })

    // 2. Pull the current state immediately — this solves the timing race where
    //    main fires display:push (via did-finish-load) before this listener was registered
    api.display.getState().then((payload) => {
      if (!payload) return
      applyData(payload as DisplayData)
    }).catch(() => {})

    // 3. Also load settings for bg/logo as a fallback
    api.settings.getAll().then((s) => {
      if (s.logoBase64) setLogoBase64((prev) => prev || s.logoBase64)
      if (s.displayBgColor) setDisplayBgColor((prev) => prev !== '#0f172a' ? prev : s.displayBgColor)
      if (s.displayBgImage) setDisplayBgImage((prev) => prev || s.displayBgImage)
    }).catch(() => {})

    return () => { unsubscribe() }
  }, [])

  const storeName = data.storeName ?? 'POS System'

  return (
    <div
      className="flex flex-col h-screen overflow-hidden text-slate-100"
      style={{
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        backgroundColor: displayBgColor,
        backgroundImage: displayBgImage ? `url(${displayBgImage})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <header className="flex items-center justify-between px-8 py-4 bg-slate-800 border-b border-slate-700 shrink-0">
        {logoBase64 ? (
          <img src={logoBase64} alt="Store logo" className="h-10 w-auto max-w-[160px] object-contain" />
        ) : (
          <span className="text-xl font-black text-blue-400 tracking-tight">{storeName}</span>
        )}
        <Clock />
      </header>

      <main className="flex-1 overflow-hidden">
        {data.state === 'idle' && <IdleView storeName={storeName} logoBase64={logoBase64} />}
        {data.state === 'shopping' && <ShoppingView data={data} />}
        {data.state === 'payment_processing' && <PaymentProcessingView data={data} />}
        {data.state === 'complete' && <CompleteView data={data} />}
      </main>

      <footer className="px-8 py-3 bg-slate-800 border-t border-slate-700 text-center text-slate-600 text-sm shrink-0">
        Thank you for shopping with us
      </footer>
    </div>
  )
}

function Clock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    }, 10_000)
    return () => clearInterval(id)
  }, [])
  return <span className="text-slate-400 text-sm tabular-nums">{time}</span>
}
