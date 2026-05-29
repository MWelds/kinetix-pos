import React, { useState, useMemo } from 'react'
import { Printer, Minus, Plus } from 'lucide-react'
import { Modal, Button } from '../../components/ui'
import { generateCode128Svg } from '../../lib/barcode'
import { api } from '../../lib/api'
import { useUiStore } from '../../stores/ui.store'
import { useCurrencyStore } from '../../stores/currency.store'
import type { Product } from '../../types'

// ─── Paper configuration ──────────────────────────────────────────────────────

interface PaperConfig {
  /** Unique key used in state. */
  id: string
  /** Display label shown in the picker. */
  label: string
  /** Short description shown as helper text. */
  description: string
  /** CSS @page `size` value (e.g. "A4", "letter", "63mm 29mm"). */
  pageSize: string
  /** CSS body `padding` value. */
  bodyPadding: string
  /** CSS `width` of each tag cell. */
  tagWidth: string
  /** CSS `min-height` of each tag cell (optional — omit for variable height). */
  tagMinHeight?: string
  /** CSS gap between tags in the flex grid. */
  tagGap: string
  /** When true, each tag gets `page-break-after: always` (thermal/single-label). */
  singlePerPage: boolean
  /** Bar height passed to generateCode128Svg. */
  barcodeHeight: number
  /** Module width passed to generateCode128Svg. */
  barcodeModuleWidth: number
  /** Font size for the price (CSS pt). */
  priceFontSizePt: number
  /** Font size for the product name (CSS pt). */
  nameFontSizePt: number
}

const PAPER_CONFIGS: readonly PaperConfig[] = [
  {
    id: 'a4',
    label: 'A4 Sheet',
    description: '210×297 mm — tiles ~12 tags per page',
    pageSize: 'A4',
    bodyPadding: '8mm',
    tagWidth: '63mm',
    tagGap: '4mm',
    singlePerPage: false,
    barcodeHeight: 50,
    barcodeModuleWidth: 1.8,
    priceFontSizePt: 20,
    nameFontSizePt: 9.5,
  },
  {
    id: 'letter',
    label: 'US Letter',
    description: '8.5"×11" — tiles ~12 tags per page',
    pageSize: 'letter',
    bodyPadding: '10mm',
    tagWidth: '63mm',
    tagGap: '4mm',
    singlePerPage: false,
    barcodeHeight: 50,
    barcodeModuleWidth: 1.8,
    priceFontSizePt: 20,
    nameFontSizePt: 9.5,
  },
  {
    id: 'avery5160',
    label: 'Avery 5160 (2⅝"×1")',
    description: 'Letter sheet — 30 labels, 3 columns × 10 rows',
    pageSize: 'letter',
    bodyPadding: '12.7mm 4.8mm',
    tagWidth: '66.7mm',
    tagMinHeight: '25.4mm',
    tagGap: '0mm',
    singlePerPage: false,
    barcodeHeight: 20,
    barcodeModuleWidth: 0.9,
    priceFontSizePt: 13,
    nameFontSizePt: 8,
  },
  {
    id: 'avery5163',
    label: 'Avery 5163 (4"×2")',
    description: 'Letter sheet — 10 labels, 2 columns × 5 rows',
    pageSize: 'letter',
    bodyPadding: '12.7mm 4.8mm',
    tagWidth: '101.6mm',
    tagMinHeight: '50.8mm',
    tagGap: '0mm',
    singlePerPage: false,
    barcodeHeight: 38,
    barcodeModuleWidth: 1.6,
    priceFontSizePt: 18,
    nameFontSizePt: 10,
  },
  {
    id: 'thermal2x1',
    label: '2"×1" Thermal Label',
    description: '50.8×25.4 mm — one tag per page',
    pageSize: '50.8mm 25.4mm',
    bodyPadding: '1.5mm 2mm',
    tagWidth: '46.8mm',
    tagMinHeight: '22.4mm',
    tagGap: '0',
    singlePerPage: true,
    barcodeHeight: 13,
    barcodeModuleWidth: 0.7,
    priceFontSizePt: 11,
    nameFontSizePt: 7,
  },
  {
    id: 'thermal57x32',
    label: '57×32 mm Thermal',
    description: 'Common thermal roll — one tag per page',
    pageSize: '57mm 32mm',
    bodyPadding: '2mm',
    tagWidth: '53mm',
    tagMinHeight: '28mm',
    tagGap: '0',
    singlePerPage: true,
    barcodeHeight: 16,
    barcodeModuleWidth: 0.85,
    priceFontSizePt: 13,
    nameFontSizePt: 7.5,
  },
  {
    id: 'thermal4x2',
    label: '4"×2" Thermal Label',
    description: '101.6×50.8 mm — one tag per page',
    pageSize: '101.6mm 50.8mm',
    bodyPadding: '2.5mm 3mm',
    tagWidth: '95.6mm',
    tagMinHeight: '45.8mm',
    tagGap: '0',
    singlePerPage: true,
    barcodeHeight: 28,
    barcodeModuleWidth: 1.4,
    priceFontSizePt: 18,
    nameFontSizePt: 9,
  },
  {
    id: 'thermal4x6',
    label: '4"×6" Thermal Label',
    description: '101.6×152.4 mm — one large tag per page',
    pageSize: '101.6mm 152.4mm',
    bodyPadding: '4mm',
    tagWidth: '93.6mm',
    tagMinHeight: '144.4mm',
    tagGap: '0',
    singlePerPage: true,
    barcodeHeight: 60,
    barcodeModuleWidth: 2.0,
    priceFontSizePt: 28,
    nameFontSizePt: 12,
  },
]

const DEFAULT_PAPER_ID = 'a4'

// ─── HTML builder ─────────────────────────────────────────────────────────────

/** XSS-safe HTML escaping for the print document. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Build a printable HTML document containing `qty` price tags
 * laid out for the given `paper` configuration.
 */
function buildTagsHtml(
  product: Product,
  barcode: string,
  qty: number,
  paper: PaperConfig,
  fmtRaw: (n: number) => string
): string {
  let barcodeSvg = ''
  try {
    barcodeSvg = generateCode128Svg(barcode, {
      height: paper.barcodeHeight,
      moduleWidth: paper.barcodeModuleWidth,
      showText: true,
      fontSize: Math.max(6, Math.round(paper.barcodeModuleWidth * 4.5)),
    })
  } catch {
    barcodeSvg = `<span style="font-family:monospace;font-size:8px;letter-spacing:1px">${esc(barcode)}</span>`
  }

  const pageBreak = paper.singlePerPage ? 'page-break-after: always;' : ''

  const tagHtml = `
    <div class="tag" style="${pageBreak}">
      <div class="sku">${esc(product.sku)}</div>
      <div class="name">${esc(product.name)}</div>
      <div class="barcode">${barcodeSvg}</div>
      <div class="price">${esc(fmtRaw(product.basePrice))}</div>
    </div>`

  const tags = Array.from({ length: qty }, () => tagHtml).join('\n')

  const tagMinHeightCss = paper.tagMinHeight
    ? `min-height: ${paper.tagMinHeight};`
    : ''

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
    padding: ${paper.bodyPadding};
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: ${paper.tagGap};
    align-content: flex-start;
  }
  .tag {
    width: ${paper.tagWidth};
    ${tagMinHeightCss}
    border: 1px dashed #94a3b8;
    border-radius: 2px;
    padding: 1.5mm 2mm;
    background: #fff;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .sku {
    font-size: 6.5pt;
    color: #64748b;
    font-family: monospace;
    margin-bottom: 0.8mm;
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .name {
    font-size: ${paper.nameFontSizePt}pt;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 1.5mm;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    max-width: 100%;
  }
  .barcode {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 1.5mm;
    max-width: 100%;
    overflow: hidden;
  }
  .barcode svg {
    max-width: 100%;
    height: auto;
  }
  .price {
    font-size: ${paper.priceFontSizePt}pt;
    font-weight: 800;
    color: #1d4ed8;
    letter-spacing: -0.3px;
    white-space: nowrap;
  }
  @media print {
    body { padding: ${paper.bodyPadding}; }
    @page { margin: 0; size: ${paper.pageSize}; }
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

// ─── Modal component ──────────────────────────────────────────────────────────

interface PriceTagModalProps {
  product: Product
  onClose: () => void
}

/**
 * Modal for previewing and printing product price tags.
 * Supports multiple paper sizes and label formats.
 */
export function PriceTagModal({ product, onClose }: PriceTagModalProps) {
  const [qty, setQty]           = useState(1)
  const [paperId, setPaperId]   = useState(DEFAULT_PAPER_ID)
  const [printing, setPrinting] = useState(false)
  const showToast = useUiStore((s) => s.showToast)
  const fmtRaw    = useCurrencyStore((s) => s.fmtRaw)

  const paper  = PAPER_CONFIGS.find((p) => p.id === paperId) ?? PAPER_CONFIGS[0]
  const barcode = product.barcode ?? product.sku

  /** Small in-modal barcode preview (constant size, independent of paper choice). */
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
      const html   = buildTagsHtml(product, barcode, qty, paper, fmtRaw)
      const result = await api.tag.print(html)
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

        {/* ── Paper type ───────────────────────────────────────────────────── */}
        <div>
          <label
            htmlFor="paper-select"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Paper / label type
          </label>
          <select
            id="paper-select"
            value={paperId}
            onChange={(e) => setPaperId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                       bg-white focus:outline-none focus:ring-2 focus:ring-blue-500
                       min-h-[44px]"
          >
            {PAPER_CONFIGS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">{paper.description}</p>
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
