import React, { useState, useEffect } from 'react'
import { ShoppingCart, Server, Monitor, ChevronRight, Check, Copy, Wifi, AlertCircle, Loader2, Search, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'

type NodeMode = 'standalone' | 'server' | 'terminal'

interface Props {
  onComplete: () => void
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all ${
            i === current ? 'w-6 h-2 bg-blue-600' : i < current ? 'w-2 h-2 bg-blue-400' : 'w-2 h-2 bg-gray-300'
          }`}
        />
      ))}
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      className="ml-2 p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
    </button>
  )
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<NodeMode | null>(null)

  // Server mode fields
  const [serverPort, setServerPort] = useState(3030)
  const [localIp, setLocalIp] = useState('...')

  // Terminal mode fields
  const [terminalUrl, setTerminalUrl] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discovered, setDiscovered] = useState<string[]>([])
  const [localIps, setLocalIps] = useState<string[]>([])

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    api.setup.get().then((data) => {
      setServerPort(parseInt(data.embeddedServerPort || '3030', 10))
      if (data.syncUrl) setTerminalUrl(data.syncUrl)
    }).catch(() => {})

    api.setup.embeddedServerStatus().then((s) => setLocalIp(s.ip)).catch(() => {})
    api.app.getLocalIps().then(setLocalIps).catch(() => {})
  }, [])

  async function handleDiscoverLan() {
    setDiscovering(true)
    setDiscovered([])
    setTestStatus('idle')
    try {
      const found = await api.sync.discover() as string[]
      setDiscovered(found)
      if (found.length === 1) {
        // Exactly one server found — auto-fill and auto-test
        setTerminalUrl(found[0])
      } else if (found.length > 1) {
        // Multiple servers — auto-fill the first one as a sensible default
        setTerminalUrl(found[0])
      }
    } catch {
      // Non-fatal — user can still enter URL manually
    } finally {
      setDiscovering(false)
    }
  }

  async function handleTestConnection() {
    setTestStatus('testing')
    setTestMessage('')
    try {
      const result = await api.sync.testConnection(terminalUrl, '')
      setTestStatus(result.ok ? 'ok' : 'error')
      setTestMessage(result.message)
    } catch {
      setTestStatus('error')
      setTestMessage('Could not reach the server. Check the URL and try again.')
    }
  }

  async function handleFinish() {
    if (!mode) return
    setSaving(true)
    setSaveError('')
    try {
      await api.setup.complete({
        nodeMode: mode,
        embeddedServerPort: serverPort,
        embeddedServerApiKey: '',
        syncUrl: terminalUrl,
        syncApiKey: '',
        syncIntervalSeconds: 30
      })
      onComplete()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Setup failed. Please try again.')
      setSaving(false)
    }
  }

  // ── Render steps ─────────────────────────────────────────────────────────

  // Step 0 — Welcome
  if (step === 0) {
    return (
      <WizardShell>
        <StepDots current={0} total={3} />
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg">
            <ShoppingCart size={32} className="text-white" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Welcome to Kinetix POS</h1>
        <p className="text-gray-500 text-center mb-8">
          Let's take a minute to set up your system. This only takes a moment.
        </p>
        <button
          onClick={() => setStep(1)}
          className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          Get Started <ChevronRight size={18} />
        </button>
      </WizardShell>
    )
  }

  // Step 1 — Mode selection
  if (step === 1) {
    return (
      <WizardShell>
        <StepDots current={1} total={3} />
        <h2 className="text-xl font-bold text-gray-900 text-center mb-2">How will this computer be used?</h2>
        <p className="text-gray-500 text-center text-sm mb-6">
          Choose the role for this machine. You can change this later in Settings.
        </p>

        <div className="space-y-3 mb-8">
          <ModeCard
            icon={<Monitor size={22} />}
            title="Standalone Terminal"
            description="Works independently. No sync with other registers. Best for single-register setups."
            selected={mode === 'standalone'}
            onClick={() => setMode('standalone')}
          />
          <ModeCard
            icon={<Server size={22} />}
            title="Sync Server + Terminal"
            description="This machine hosts the central database AND acts as a POS terminal. Recommended for the main register."
            selected={mode === 'server'}
            onClick={() => setMode('server')}
            badge="Recommended for multi-register"
          />
          <ModeCard
            icon={<Wifi size={22} />}
            title="POS Terminal Only"
            description="Connects to a Sync Server on another computer. Use for additional registers."
            selected={mode === 'terminal'}
            onClick={() => setMode('terminal')}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setStep(0)}
            className="flex-1 py-3 px-4 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setStep(2)}
            disabled={!mode}
            className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            Continue <ChevronRight size={18} />
          </button>
        </div>
      </WizardShell>
    )
  }

  // Step 2 — Configuration
  if (step === 2) {
    return (
      <WizardShell>
        <StepDots current={2} total={3} />

        {/* Standalone — nothing to configure */}
        {mode === 'standalone' && (
          <>
            <div className="flex justify-center mb-6">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                <Check size={28} className="text-green-600" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-2">All Set!</h2>
            <p className="text-gray-500 text-center text-sm mb-8">
              Kinetix POS will run fully offline on this machine. You can always add sync later in Settings → Sync Server.
            </p>
          </>
        )}

        {/* Server + Terminal */}
        {mode === 'server' && (
          <>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-1">Configure Your Sync Server</h2>
            <p className="text-gray-500 text-center text-sm mb-6">
              The sync server will start automatically whenever Kinetix POS opens.
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Server Port</label>
                <input
                  type="number"
                  value={serverPort}
                  onChange={(e) => setServerPort(parseInt(e.target.value) || 3030)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Make sure this port is open in your firewall.</p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-blue-700 mb-1">Other terminals should connect to:</p>
                <div className="flex items-center">
                  <code className="text-sm text-blue-800 font-mono">
                    http://{localIp}:{serverPort}
                  </code>
                  <CopyButton value={`http://${localIp}:${serverPort}`} />
                </div>
              </div>
            </div>
          </>
        )}

        {/* Terminal Only */}
        {mode === 'terminal' && (
          <>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-1">Connect to Sync Server</h2>
            <p className="text-gray-500 text-center text-sm mb-6">
              Find your Sync Server on the network or enter its address manually.
            </p>

            <div className="space-y-4 mb-4">
              {/* LAN Discovery */}
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
                    <Search size={12} /> Search for Server on LAN
                  </p>
                  <button
                    type="button"
                    onClick={handleDiscoverLan}
                    disabled={discovering}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    {discovering
                      ? <><RefreshCw size={11} className="animate-spin" /> Scanning…</>
                      : <><Search size={11} /> Search</>
                    }
                  </button>
                </div>

                {/* Discovered servers */}
                {discovered.length > 0 && (
                  <>
                    <p className="text-xs text-blue-600 mb-2">Found {discovered.length} server{discovered.length !== 1 ? 's' : ''} — click to select:</p>
                    <div className="flex flex-wrap gap-2">
                      {discovered.map((url) => {
                        const active = terminalUrl.trim() === url
                        return (
                          <button
                            key={url}
                            type="button"
                            onClick={() => { setTerminalUrl(url); setTestStatus('idle') }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all ${
                              active
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-white text-blue-700 border-blue-200 hover:border-blue-400 hover:bg-blue-50'
                            }`}
                          >
                            {url}
                            {active && <Check size={11} className="ml-0.5" />}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}

                {!discovering && discovered.length === 0 && (
                  <p className="text-xs text-blue-500">
                    Click Search to automatically find Kinetix POS servers on your network.
                  </p>
                )}

                {/* This machine's own IPs as a quick-fill hint */}
                {localIps.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-blue-200">
                    <p className="text-xs text-blue-600 mb-1.5 flex items-center gap-1">
                      <Wifi size={11} /> This machine&apos;s IP{localIps.length > 1 ? 's' : ''} (if this PC is the server):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {localIps.map((ip) => {
                        const url = `http://${ip}:3030`
                        return (
                          <button
                            key={ip}
                            type="button"
                            onClick={() => { setTerminalUrl(url); setTestStatus('idle') }}
                            className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-white text-blue-700 border border-blue-200 hover:border-blue-400 hover:bg-blue-50 transition-all"
                          >
                            {ip}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Manual URL entry */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Server URL <span className="text-gray-400 font-normal">(or enter manually)</span>
                </label>
                <input
                  type="text"
                  placeholder="http://192.168.1.100:3030"
                  value={terminalUrl}
                  onChange={(e) => { setTerminalUrl(e.target.value); setTestStatus('idle') }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                onClick={handleTestConnection}
                disabled={!terminalUrl || testStatus === 'testing'}
                className="w-full py-2 px-4 border border-blue-600 text-blue-600 font-medium rounded-lg hover:bg-blue-50 disabled:opacity-40 transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {testStatus === 'testing' ? (
                  <><Loader2 size={14} className="animate-spin" /> Testing…</>
                ) : 'Test Connection'}
              </button>

              {testStatus === 'ok' && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
                  <Check size={14} /> {testMessage}
                </div>
              )}
              {testStatus === 'error' && (
                <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
                  <AlertCircle size={14} /> {testMessage}
                </div>
              )}
            </div>
          </>
        )}

        {saveError && (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm mb-4">
            <AlertCircle size={14} /> {saveError}
          </div>
        )}

        <div className="flex gap-3 mt-2">
          <button
            onClick={() => setStep(1)}
            className="flex-1 py-3 px-4 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleFinish}
            disabled={saving || (mode === 'terminal' && !terminalUrl)}
            className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <><Loader2 size={16} className="animate-spin" /> Setting up…</> : (
              <><Check size={16} /> Finish Setup</>
            )}
          </button>
        </div>

        {mode === 'terminal' && testStatus !== 'ok' && terminalUrl && (
          <button
            onClick={handleFinish}
            disabled={saving}
            className="w-full mt-2 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip connection test and finish anyway
          </button>
        )}
      </WizardShell>
    )
  }

  return null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WizardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        {children}
      </div>
    </div>
  )
}

function ModeCard({
  icon, title, description, selected, onClick, badge
}: {
  icon: React.ReactNode
  title: string
  description: string
  selected: boolean
  onClick: () => void
  badge?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
        selected
          ? 'border-blue-600 bg-blue-50'
          : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 p-2 rounded-lg ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{title}</span>
            {badge && (
              <span className="text-[10px] font-medium px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
        <div className={`mt-1 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
          selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
        }`}>
          {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
      </div>
    </button>
  )
}
