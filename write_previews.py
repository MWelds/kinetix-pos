import re

path = r"/sessions/intelligent-admiring-hypatia/mnt/POS/src/renderer/src/features/settings/SettingsScreen.tsx"

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# ── 1. Insert ReceiptPreviewPane + InvoicePreviewPane after ColorDot ────────────

PREVIEW_COMPONENTS = r"""
// ─── Receipt preview (live, scaled) ─────────────────────────────────────────

interface ReceiptPreviewProps {
  template: string
  showLogo: boolean
  footer: string
  storeName: string
  logoBase64: string
}

function ReceiptPreviewPane({ template, showLogo, footer, storeName, logoBase64 }: ReceiptPreviewProps) {
  const logo = showLogo && logoBase64
    ? <img src={logoBase64} alt="logo" style={{ maxWidth: 80, maxHeight: 40, objectFit: 'contain', marginBottom: 6 }} />
    : null

  const ITEMS = [
    { name: 'Product A', qty: 2, price: '$12.00' },
    { name: 'Product B', qty: 1, price: '$8.50' },
    { name: 'Product C', qty: 3, price: '$27.00' },
  ]

  let inner: React.ReactNode

  if (template === 'modern') {
    inner = (
      <div style={{ fontFamily: 'sans-serif', width: 280, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
        {/* Header */}
        <div style={{ background: '#1e293b', padding: '16px 18px', textAlign: 'center' }}>
          {logo && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>{logo}</div>}
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{storeName || 'My Store'}</div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>123 Main Street · (555) 000-0000</div>
        </div>
        {/* Date */}
        <div style={{ padding: '8px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' }}>
          <span>Order #1042</span><span>Today</span>
        </div>
        {/* Items */}
        <div style={{ padding: '10px 18px' }}>
          {ITEMS.map((item) => (
            <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#334155' }}>{item.qty}x {item.name}</span>
              <span style={{ color: '#0f172a', fontWeight: 600 }}>{item.price}</span>
            </div>
          ))}
        </div>
        {/* Total */}
        <div style={{ margin: '0 18px', borderTop: '1px solid #e2e8f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
          <span>Total</span><span>$47.50</span>
        </div>
        {/* Payment */}
        <div style={{ background: '#f0fdf4', margin: '10px 18px', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#16a34a' }}>
          ✓ Cash — $50.00 · Change $2.50
        </div>
        {/* Footer */}
        {footer && <div style={{ textAlign: 'center', padding: '8px 18px 14px', fontSize: 11, color: '#64748b' }}>{footer}</div>}
      </div>
    )
  } else if (template === 'minimal') {
    inner = (
      <div style={{ fontFamily: 'monospace', width: 260, background: '#fff', padding: '14px 16px', fontSize: 11, lineHeight: 1.5, color: '#111' }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{storeName || 'My Store'}</div>
        <div>{'─'.repeat(34)}</div>
        {ITEMS.map((item) => (
          <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{item.qty}x {item.name}</span><span>{item.price}</span>
          </div>
        ))}
        <div>{'─'.repeat(34)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
          <span>TOTAL</span><span>$47.50</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
          <span>CASH</span><span>$50.00</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
          <span>CHANGE</span><span>$2.50</span>
        </div>
        {footer && <div style={{ textAlign: 'center', marginTop: 8, color: '#555' }}>{footer}</div>}
      </div>
    )
  } else {
    // Classic
    inner = (
      <div style={{ fontFamily: 'monospace', width: 270, background: '#fff', padding: '14px 16px', fontSize: 11, lineHeight: 1.6, color: '#111' }}>
        {logo && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>{logo}</div>}
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{storeName || 'MY STORE'}</div>
        <div style={{ textAlign: 'center', color: '#555', fontSize: 10 }}>123 Main Street</div>
        <div style={{ textAlign: 'center', color: '#555', fontSize: 10 }}>Tel: (555) 000-0000</div>
        <div style={{ margin: '6px 0', borderTop: '1px dashed #999' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555' }}>
          <span>Order #1042</span><span>Today 12:30 PM</span>
        </div>
        <div style={{ margin: '4px 0', borderTop: '1px dashed #999' }} />
        {ITEMS.map((item) => (
          <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{item.qty}x {item.name}</span><span>{item.price}</span>
          </div>
        ))}
        <div style={{ margin: '4px 0', borderTop: '1px dashed #999' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
          <span>TOTAL</span><span>$47.50</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>CASH</span><span>$50.00</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>CHANGE</span><span>$2.50</span>
        </div>
        <div style={{ margin: '6px 0', borderTop: '1px dashed #999' }} />
        {footer && <div style={{ textAlign: 'center', color: '#555' }}>{footer}</div>}
        <div style={{ textAlign: 'center', marginTop: 4, fontSize: 10, color: '#999' }}>*** THANK YOU ***</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: 280, overflow: 'hidden', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 12 }}>
      <div style={{ transform: 'scale(0.82)', transformOrigin: 'top center', pointerEvents: 'none' }}>
        {inner}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 32, background: 'linear-gradient(to bottom, transparent, #f8fafc)', borderRadius: '0 0 10px 10px' }} />
      <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#94a3b8', fontFamily: 'sans-serif' }}>Preview</div>
    </div>
  )
}

// ─── Invoice preview (live, scaled) ─────────────────────────────────────────

interface InvoicePreviewProps {
  showLogo: boolean
  footer: string
  storeName: string
  storeAddress: string
  logoBase64: string
}

function InvoicePreviewPane({ showLogo, footer, storeName, storeAddress, logoBase64 }: InvoicePreviewProps) {
  const logo = showLogo && logoBase64
    ? <img src={logoBase64} alt="logo" style={{ maxWidth: 80, maxHeight: 40, objectFit: 'contain' }} />
    : <div style={{ width: 80, height: 40, background: '#e2e8f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94a3b8' }}>LOGO</div>

  const ITEMS = [
    { name: 'Product A', qty: 2, unit: '$6.00', total: '$12.00' },
    { name: 'Product B', qty: 1, unit: '$8.50', total: '$8.50' },
    { name: 'Product C', qty: 3, unit: '$9.00', total: '$27.00' },
  ]

  return (
    <div style={{ position: 'relative', width: '100%', height: 340, overflow: 'hidden', background: '#f1f5f9', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 12 }}>
      <div style={{ transform: 'scale(0.60)', transformOrigin: 'top center', pointerEvents: 'none', width: 595 }}>
        {/* A4 invoice mock */}
        <div style={{ background: '#fff', padding: '32px 40px', fontFamily: 'sans-serif', color: '#1e293b', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', borderRadius: 4 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
            <div>
              {logo}
              <div style={{ marginTop: 8, fontWeight: 700, fontSize: 16 }}>{storeName || 'My Store'}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{storeAddress || '123 Main Street'}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Tel: (555) 000-0000</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', letterSpacing: -0.5 }}>INVOICE</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>#INV-1042</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Date: Today</div>
              <div style={{ marginTop: 8, display: 'inline-block', border: '2px solid #16a34a', color: '#16a34a', borderRadius: 4, padding: '2px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>PAID</div>
            </div>
          </div>
          {/* Bill To */}
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Bill To</div>
            <div style={{ fontWeight: 600 }}>John Smith</div>
            <div style={{ color: '#64748b' }}>john@example.com · (555) 111-2222</div>
          </div>
          {/* Items table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#fff' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Item</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Qty</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Unit</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {ITEMS.map((item, i) => (
                <tr key={item.name} style={{ background: i % 2 === 0 ? '#f8fafc' : '#fff' }}>
                  <td style={{ padding: '7px 12px' }}>{item.name}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{item.unit}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600 }}>{item.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 220, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#64748b' }}>
                <span>Subtotal</span><span>$47.50</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#64748b' }}>
                <span>Tax (10%)</span><span>$4.75</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '2px solid #1e293b', fontWeight: 700, fontSize: 14 }}>
                <span>Total</span><span>$52.25</span>
              </div>
            </div>
          </div>
          {/* Footer */}
          {footer && <div style={{ marginTop: 24, padding: '12px 16px', background: '#f8fafc', borderRadius: 8, fontSize: 11, color: '#64748b', textAlign: 'center' }}>{footer}</div>}
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, background: 'linear-gradient(to bottom, transparent, #f1f5f9)', borderRadius: '0 0 10px 10px' }} />
      <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#94a3b8', fontFamily: 'sans-serif' }}>Preview</div>
    </div>
  )
}

"""

# Insert after ColorDot closing brace
INSERT_AFTER = '''    />
  )
}

export function SettingsScreen()'''

REPLACEMENT = '''    />
  )
}
''' + PREVIEW_COMPONENTS + '''export function SettingsScreen()'''

if INSERT_AFTER not in src:
    print("ERROR: ColorDot insert point not found")
    exit(1)

src = src.replace(INSERT_AFTER, REPLACEMENT, 1)

# ── 2. Modify Receipt Templates section — add preview below controls ──────────

OLD_RECEIPT_SECTION = '''            <Input label="Receipt Footer Text" value={settings.receiptFooterText ?? ''} onChange={field('receiptFooterText')} placeholder="Thank you for your business!" />
          </div>
        </section>

        {/* Invoice Settings */}'''

NEW_RECEIPT_SECTION = '''            <Input label="Receipt Footer Text" value={settings.receiptFooterText ?? ''} onChange={field('receiptFooterText')} placeholder="Thank you for your business!" />
            {/* Live preview */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Live Preview</p>
              <ReceiptPreviewPane
                template={settings.receiptTemplate ?? 'classic'}
                showLogo={(settings.receiptShowLogo ?? 'true') === 'true'}
                footer={settings.receiptFooterText ?? ''}
                storeName={settings.storeName ?? ''}
                logoBase64={logoBase64 ?? ''}
              />
            </div>
          </div>
        </section>

        {/* Invoice Settings */}'''

if OLD_RECEIPT_SECTION not in src:
    print("ERROR: Receipt section end not found")
    exit(1)

src = src.replace(OLD_RECEIPT_SECTION, NEW_RECEIPT_SECTION, 1)

# ── 3. Modify Invoice Settings section — add preview below controls ───────────

OLD_INVOICE_SECTION = '''            <Input label="Invoice Footer / Payment Terms" value={settings.invoiceFooterText ?? ''} onChange={field('invoiceFooterText')} placeholder="Payment due on receipt. Thank you!" />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Receipts</h2>'''

NEW_INVOICE_SECTION = '''            <Input label="Invoice Footer / Payment Terms" value={settings.invoiceFooterText ?? ''} onChange={field('invoiceFooterText')} placeholder="Payment due on receipt. Thank you!" />
            {/* Live preview */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Live Preview</p>
              <InvoicePreviewPane
                showLogo={(settings.invoiceShowLogo ?? 'true') === 'true'}
                footer={settings.invoiceFooterText ?? ''}
                storeName={settings.storeName ?? ''}
                storeAddress={settings.storeAddress ?? ''}
                logoBase64={logoBase64 ?? ''}
              />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Receipts</h2>'''

if OLD_INVOICE_SECTION not in src:
    print("ERROR: Invoice section end not found")
    exit(1)

src = src.replace(OLD_INVOICE_SECTION, NEW_INVOICE_SECTION, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)

print("Done — previews inserted successfully")
