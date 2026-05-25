import React, { useRef, useState } from 'react'
import { Upload, Download, AlertCircle, CheckCircle, X, FileText } from 'lucide-react'

interface ImportResult {
  imported: number
  updated: number
  failed: number
  errors: string[]
}

interface Props {
  /** Label shown on the export button, e.g. "Products" or "Customers" */
  entityLabel: string
  /** Filename for the downloaded CSV, e.g. "products.csv" */
  exportFilename: string
  /** Called when the user picks a file — receives the CSV text */
  onImport: (csvText: string) => Promise<ImportResult>
  /** Called to generate export CSV text */
  onExport: () => Promise<string>
  /** Template CSV content shown when user clicks "Download Template" */
  templateCsv: string
  /** Template filename */
  templateFilename: string
}

function downloadString(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function CsvImportExportBar({
  entityLabel, exportFilename, onImport, onExport, templateCsv, templateFilename
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const text = await file.text()
      const res = await onImport(text)
      setResult(res)
    } catch (err) {
      setResult({ imported: 0, updated: 0, failed: 1, errors: [String(err)] })
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const csv = await onExport()
      downloadString(csv, exportFilename)
    } finally {
      setExporting(false)
    }
  }

  const hasErrors = result && result.errors.length > 0
  const isSuccess = result && result.failed === 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* Hidden file input */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Import */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <Upload size={14} className={importing ? 'animate-bounce' : ''} />
          {importing ? 'Importing…' : `Import ${entityLabel}`}
        </button>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <Download size={14} className={exporting ? 'animate-bounce' : ''} />
          {exporting ? 'Exporting…' : `Export ${entityLabel}`}
        </button>

        {/* Template download */}
        <button
          onClick={() => downloadString(templateCsv, templateFilename)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-gray-300 bg-white text-gray-500 hover:bg-gray-50 transition-colors"
          title="Download a blank CSV template to fill in"
        >
          <FileText size={14} />
          Template
        </button>
      </div>

      {/* Result banner */}
      {result && (
        <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm border ${isSuccess ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          {isSuccess
            ? <CheckCircle size={14} className="text-emerald-600 shrink-0 mt-0.5" />
            : <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <span className="font-medium">
              {result.imported > 0 && `${result.imported} added`}
              {result.imported > 0 && result.updated > 0 && ', '}
              {result.updated > 0 && `${result.updated} updated`}
              {result.failed > 0 && ` — ${result.failed} failed`}
            </span>
            {hasErrors && (
              <ul className="mt-1 space-y-0.5 text-xs text-amber-700">
                {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                {result.errors.length > 5 && <li>…and {result.errors.length - 5} more</li>}
              </ul>
            )}
          </div>
          <button onClick={() => setResult(null)} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
