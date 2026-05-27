import React, { useState, useMemo } from 'react'
import { Printer, Minus, Plus } from 'lucide-react'
import { Modal, Button } from '../../components/ui'
import { generateCode128Svg } from '../../lib/barcode'
import { api } from '../../lib/api'
import { useUiStore } from '../../stores/ui.store'
import { useCurrencyStore } from '../../stores/currency.store'
import type { Product } from '../../types'

interface PriceTagModalProps {
  product: Product
  onClose: () => void
}

/** XSS-safe HTML escaping for the print document. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Build printable HTML containing `qty` tiled price tags. */
function buildTagsHtml(
  product: Product,
  barcode: string,
  qty: number,
  fmtRaw: (n: number) => string
): string {
  let barcodeSvg = ''
  try {
    barcodeSvg = generateCode128Svg(barcode, {
      height: 50,
      moduleWidth: 1.8,
      showText: true,
      fontSize: 9,
    })
  } catch {
    // Fallback: show barcode as plain monospace text when encoding fails
    barcodeSvg = `<span style="font-family:monospace;font-size:10px;letter-spacing:1px">${esc(barcode)}</span>`
  }

  const tagHtml = `
    <div class="tag">
      <div class="sku">${esc(product.sku)}</div>
      <div class="name">${esc(product.name)}</div>
      <div class="barcode">${barcodeSvg}</div>
      <div class="price">${esc(fmtRaw(product.basePrice))}</div>
    </div>`

  const tags = Array.from({ length: qty }, () => tagHtml).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Price Tags — ${esc(product.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #fff;
    padding: 8mm;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4mm;
  }
  .tag {
    width: 63mm;
    border: 1px dashed #94a3b8;
    border-radius: 3px;
    padding: 3mm 4mm;
    background: #fff;
    text-align: center;
    page-break-inside: avoid;
  }
  .sku {
    font-size: 7.5pt;
    color: #64748b;
    font-family: monospace;
    margin-bottom: 1.5mm;
    letter-spacing: 0.5px;
  }
  .name {
    font-size: 9.5pt;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 3mm;
    line-height: 1.3;
    min-height: 1.3em;
  }
  .barcode {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 3mm;
    overflow: hidden;
  }
  .barcode svg {
    max-width: 100%;
    height: auto;
  }
  .price {
    font-size: 20pt;
    font-weight: 800;
    color: #1d4ed8;
    letter-spacing: -0.5px;
  }
  @media print {
    body { padding: 5mm; }
    @page { margin: 5mm; size: A4; }
  }
</style>
</head>
<body>
<div class="grid">
${tags}
</div>
</body>
</html>`
}

/**
 * Modal for previewing and printing product price tags.
 * Lets the user choose how many labels to print (1–100).
 */
export function PriceTagModal({ product, onClose }: PriceTagModalProps) {
  const [qty, setQty]         = useState(1)
  const [printing, setPrinting] = useState(false)
  const showToast  = useUiStore((s) => s.showToast)
  const fmtRaw     = useCurrencyStore((s) => s.fmtRaw)

  // Prefer the product's explicit barcode; fall back to SKU
  const barcode = product.barcode ?? product.sku

  /** Small preview SVG shown inside the modal (not the print version). */
  const previewSvg = useMemo(() => {
    try {
      return generateCode128Svg(barcode, {
        height: 36,
        moduleWidth: 1.2,
        showText: true,
        fontSize: 8,
      })
    } catch {
      return ''
    }
  }, [barcode])

  async function handlePrint() {
    setPrinting(true)
    try {
      const html   = buildTagsHtml(product, barcode, qty, fmtRaw)
      const result = await api.invoice.print(html)
      if (result.success) {
        showToast(`${qty} price tag${qty > 1 ? 's' : ''} sent to printer`, 'success')
        onClose()
      } else {
        showToast('Print failed — check printer settings', 'error')
      }
    } catch {
      showToast('Unexpected error during printing', 'error')
    } finally {
      setPrinting(false)
    }
  }

  function adjustQty(delta: number) {
    setQty((q) => Math.max(1, Math.min(100, q + delta)))
  }

  function handleQtyInput(e: React.ChangeEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10)
    if (!isNaN(parsed)) setQty(Math.max(1, Math.min(100, parsed)))
  }

  return (
    <Modal isOpen onClose={onClose} title="Print Price Tags" size="sm">
      <div className="space-y-5">

        {/* ── Tag preview ──────────────────────────────────────────────────── */}
        <div className="flex justify-center">
          <div
            className="border border-dashed border-gray-300 rounded-xl bg-white shadow-sm p-4 text-center"
            style={{ width: 220 }}
          >
            <p className="text-[10px] font-mono text-gray-400 mb-1 truncate">
              {product.sku}
            </p>
            <p className="text-sm font-bold text-gray-900 leading-tight mb-3 line-clamp-2">
              {product.name}
            </p>

            {previewSvg ? (
              <div
                className="flex justify-center mb-3 overflow-hidden"
                // SVG is generated internally — no user input reaches innerHTML
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
            ) : (
              <p className="text-xs font-mono text-gray-500 mb-3 tracking-wide">
                {barcode}
              </p>
            )}

            <p className="text-2xl font-extrabold text-blue-600">
              {fmtRaw(product.basePrice)}
            </p>
          </div>
        </div>

        {/* ── Quantity selector ──────────────────────────────────────────────── */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Number of tags
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Decrease quantity"
              disabled={qty <= 1}
              onClick={() => adjustQty(-1)}
              className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center
                         hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Minus size={14} />
            </button>

            <input
              type="number"
              min={1}
              max={100}
              value={qty}
              onChange={handleQtyInput}
              aria-label="Tag quantity"
              className="w-16 text-center border border-gray-300 rounded-lg px-2 py-1.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              type="button"
              aria-label="Increase quantity"
              disabled={qty >= 100}
              onClick={() => adjustQty(1)}
              className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center
                         hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={14} />
            </button>

            <span className="text-xs text-gray-400 ml-1">max 100</span>
          </div>
        </div>

        {/* ── Actions ────────────────────────────────────────────────────────── */}
        <div className="flex gap-3 pt-1">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Printer size={15} />}
            onClick={handlePrint}
            loading={printing}
            className="flex-1"
          >
            Print {qty} Tag{qty !== 1 ? 's' : ''}
          </Button>
        </div>

      </div>
    </Modal>
  )
}
