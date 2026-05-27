/**
 * Minimal Code 128B barcode SVG generator.
 *
 * Encodes any printable ASCII character (0x20 – 0x7E) using Code 128 subset B.
 * Returns a self-contained SVG string that can be inlined directly into HTML.
 * No runtime dependencies — works fully offline.
 */

/**
 * Code 128 symbol encoding table — indices 0–106.
 *
 * Each entry is a string of alternating bar/space widths (starting with a bar).
 * Values 0–105 have 6 elements totalling 11 modules each.
 * Value 106 (STOP) has 7 elements totalling 13 modules.
 */
const C128_TABLE: readonly string[] = [
  // 0–5
  '212222','222122','222221','121223','121322','131222',
  // 6–11
  '122213','122312','132212','221213','221312','231212',
  // 12–17
  '112232','122132','122231','113222','123122','123221',
  // 18–23
  '223211','221132','221231','213212','223112','312131',
  // 24–29
  '311222','321122','321221','312212','322112','322211',
  // 30–35
  '212123','212321','232121','111323','131123','131321',
  // 36–41
  '112313','132113','132311','211313','231113','231311',
  // 42–47
  '112133','112331','132131','113123','113321','133121',
  // 48–53
  '313121','211331','231131','213113','213311','213131',
  // 54–59
  '311123','311321','331121','312113','312311','332111',
  // 60–65
  '314111','221411','431111','111224','111422','121124',
  // 66–71
  '121421','141122','141221','112214','112412','122114',
  // 72–77
  '122411','142112','142211','241211','221114','413111',
  // 78–83
  '241112','134111','111242','121142','121241','114212',
  // 84–89
  '124112','124211','411212','421112','421211','212141',
  // 90–95
  '214121','412121','111143','111341','131141','114113',
  // 96–101
  '114311','411113','411311','113141','114131','311141',
  // 102–106 (104 = START B, 106 = STOP)
  '411131','211412','211214','211232','2331112',
]

/** Code 128B start symbol (index 104). */
const START_B = 104
/** Stop symbol (index 106). */
const STOP = 106
/** Quiet-zone width in modules on each side. */
const QUIET_MODULES = 10

export interface BarcodeOptions {
  /** Bar height in px (default: 60). */
  height?: number
  /** Width of one module in px (default: 2). */
  moduleWidth?: number
  /** Show human-readable text below the bars (default: true). */
  showText?: boolean
  /** Font size for the human-readable text in px (default: 10). */
  fontSize?: number
}

/**
 * Generate a Code 128B barcode as an SVG string.
 *
 * Supports all printable ASCII characters (0x20 – 0x7E).
 * Returns an empty string when `text` is empty.
 *
 * @param text       - Value to encode.
 * @param opts       - Visual options.
 * @returns          Self-contained SVG markup.
 * @throws {Error}   If `text` contains characters outside Code 128B range.
 */
export function generateCode128Svg(text: string, opts?: BarcodeOptions): string {
  const {
    height      = 60,
    moduleWidth = 2,
    showText    = true,
    fontSize    = 10,
  } = opts ?? {}

  if (!text) return ''

  // ── Encode: START B → data symbols → check → STOP ──────────────────────────
  const symbols: number[] = [START_B]
  let checksum = START_B

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32
    if (code < 0 || code > 95) {
      throw new Error(
        `Character '${text[i]}' (U+${text.charCodeAt(i).toString(16).padStart(4, '0')}) ` +
        'is not encodable in Code 128B (printable ASCII only)'
      )
    }
    symbols.push(code)
    checksum += (i + 1) * code
  }

  symbols.push(checksum % 103)  // check character
  symbols.push(STOP)

  // ── Measure total width ────────────────────────────────────────────────────
  let totalModules = QUIET_MODULES * 2
  for (const sym of symbols) {
    for (const ch of C128_TABLE[sym]) {
      totalModules += Number(ch)
    }
  }

  const svgWidth  = totalModules * moduleWidth
  const textGap   = showText ? fontSize + 6 : 0
  const svgHeight = height + textGap + 2

  // ── Build bar <rect> elements ───────────────────────────────────────────────
  const rects: string[] = []
  let x      = QUIET_MODULES * moduleWidth
  let isBar  = true          // Code 128 always starts with a bar element

  for (const sym of symbols) {
    for (const ch of C128_TABLE[sym]) {
      const w = Number(ch) * moduleWidth
      if (isBar) {
        rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`)
      }
      x     += w
      isBar  = !isBar
    }
  }

  // ── Human-readable text ────────────────────────────────────────────────────
  const textEl = showText
    ? `<text ` +
      `x="${(svgWidth / 2).toFixed(1)}" ` +
      `y="${height + fontSize + 2}" ` +
      `text-anchor="middle" ` +
      `font-family="monospace" ` +
      `font-size="${fontSize}" ` +
      `fill="#000">${xmlEscape(text)}</text>`
    : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${svgWidth}" height="${svgHeight}" ` +
    `viewBox="0 0 ${svgWidth} ${svgHeight}" ` +
    `fill="#000" role="img" aria-label="Barcode: ${xmlEscape(text)}">` +
    rects.join('') +
    textEl +
    '</svg>'
  )
}

/** Escape characters that are special inside XML attribute values and text nodes. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
