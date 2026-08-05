// Client-side PDF export (INCIDENT-004). The report is rasterized with
// html-to-image (an SVG-foreignObject capture that uses the browser's own
// renderer, so this OKLCH-themed console survives intact — html2canvas, which
// parses colors itself, chokes on oklch) and assembled into a real multi-page
// PDF with jsPDF, then downloaded directly — no browser print dialog, which
// would invite picking a real printer or fumbling through "Save as PDF". Both
// libraries are heavy and only needed on export, so they are dynamic-imported
// here (Vite code-splits them out of the main bundle).
//
// Pagination captures each A4 page as a separate bounded canvas, so a report of
// any length exports completely (html-to-image and browsers cap canvas
// dimensions around 16k px). Page boundaries are snapped to element tops — whole
// blocks (.member-block, tables, …) by preference, then table rows / timeline
// entries for content taller than a page — so a heading, row or diagnostic block
// is never bisected by a page edge. Known cost: each band re-serializes the
// full report subtree, so a pathological 500-precursor report is slow to export
// (correct, just not fast); rebuilding per-band fragments is a future
// optimization.
//
// html-to-image reliably rasterizes a node rendered within the viewport; an
// off-screen node can render as a BLANK canvas. Each page band is therefore
// placed in the viewport at z-index:-1000 (behind the opaque page, so the user
// sees nothing) rather than far off-screen. A4 at 96 CSS px: 210mm ≈ 794px wide,
// 297mm ≈ 1123px tall.
const PAGE_W = 794
const PAGE_H = PAGE_W * (297 / 210)

// Elements that should never be split across pages (whole units), preferred over
// row-level breaks; and the row-level fallback for content taller than a page
// (a huge precursor table, a long timeline), which may break BETWEEN rows but
// never through one.
const WHOLE_SEL = [
  '.report-head',
  '.report-section > h2',
  '.report-section > .member-block',
  '.report-section > .trace-block',
  '.report-section > .snap-agent',
  '.report-section > .table-scroll',
].join(', ')
const SPLIT_SEL = 'tbody tr, .timeline li, .precursor-block'

// Characters illegal in a path, or control characters — replaced so the name
// stays usable on every OS. Chinese characters are kept. A char-by-char pass
// avoids escape sequences that could be misinterpreted as literal control bytes.
function sanitizeTitle(title: string): string {
  let out = ''
  for (const ch of title) {
    if (/[\\/:*?"<>|]/.test(ch) || ch.charCodeAt(0) < 32) out += ' '
    else out += ch
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 40)
}

// A browser-safe filename for the exported report.
export function reportFilename(title: string, date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `NetTact-${sanitizeTitle(title) || 'report'}-${y}-${m}-${d}.pdf`
}

// Pin the report to the A4 desktop layout while capturing so the exported PDF
// looks the same regardless of the console's screen (a phone would otherwise
// yield the narrow stacked layout). IncidentReport.vue's narrow-screen rules and
// table scroll containers are guarded by body.export-capture, so adding this
// class skips them for the duration.
function enterCapture(reportEl: HTMLElement): () => void {
  const prev = { width: reportEl.style.width, maxWidth: reportEl.style.maxWidth }
  reportEl.style.width = `${PAGE_W}px`
  reportEl.style.maxWidth = 'none'
  document.body.classList.add('export-capture')
  return () => {
    reportEl.style.width = prev.width
    reportEl.style.maxWidth = prev.maxWidth
    document.body.classList.remove('export-capture')
  }
}

// Absolute top (relative to the layout clone) of every breakable element.
function breakTops(layout: HTMLElement): { whole: number[]; split: number[] } {
  const base = layout.getBoundingClientRect().top
  const whole: number[] = []
  layout.querySelectorAll(WHOLE_SEL).forEach((el) => {
    whole.push((el as HTMLElement).getBoundingClientRect().top - base)
  })
  const split: number[] = []
  layout.querySelectorAll(SPLIT_SEL).forEach((el) => {
    split.push((el as HTMLElement).getBoundingClientRect().top - base)
  })
  whole.sort((a, b) => a - b)
  split.sort((a, b) => a - b)
  return { whole, split }
}

// Snap ideal A4 boundaries to element tops so no block (or row, when a table is
// taller than a page) is bisected. Whole blocks are preferred; the largest
// candidate within half a page of the target is used, so a page never ends far
// short of its size for the sake of a clean break.
function pageBounds(cssH: number, tops: { whole: number[]; split: number[] }): number[] {
  const bounds: number[] = [0]
  let cur = 0
  while (cur < cssH) {
    const target = cur + PAGE_H
    if (target >= cssH) {
      // The final page ends at the content edge; a sub-pixel sliver would
      // rasterize to a zero-height canvas, so fold it into the previous page.
      if (cssH - cur >= 2) bounds.push(cssH)
      break
    }
    let snap = -1
    for (const t of tops.whole) if (t <= target && t > cur && t > snap) snap = t
    if (snap < 0 || target - snap > PAGE_H / 2) {
      snap = -1
      for (const t of tops.split) if (t <= target && t > cur && t > snap) snap = t
      if (snap < 0 || target - snap > PAGE_H / 2) snap = target
    }
    if (snap - cur < 100) snap = target // never end a page with ~nothing on it
    bounds.push(snap)
    cur = snap
  }
  return bounds
}

// Capture one A4 page band: a viewport-positioned, fixed-height window showing
// the layout clone scrolled up by `offsetPx`. Bounded canvas per page.
async function captureBand(
  toCanvas: (node: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>,
  layout: HTMLElement,
  offsetPx: number,
  bandHpx: number,
): Promise<HTMLCanvasElement> {
  const band = document.createElement('div')
  band.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    'z-index: -1000',
    `width: ${PAGE_W}px`,
    `height: ${bandHpx}px`,
    'overflow: hidden',
    'background: #ffffff',
  ].join('; ')
  const clone = layout.cloneNode(true) as HTMLElement
  // The layout clone is positioned off-screen for measurement; inside the band
  // it must sit in normal flow, shifted up to expose the requested band.
  clone.style.position = 'static'
  clone.style.left = 'auto'
  clone.style.top = 'auto'
  clone.style.width = `${PAGE_W}px`
  clone.style.maxWidth = 'none'
  clone.style.margin = `0 0 0 0`
  clone.style.marginTop = `-${offsetPx}px`
  band.appendChild(clone)
  document.body.appendChild(band)
  try {
    // width/height are explicit so html-to-image sizes the canvas to the band's
    // box rather than the overflowing clone's scrollHeight.
    return await toCanvas(band, { pixelRatio: 2, backgroundColor: '#ffffff', width: PAGE_W, height: bandHpx })
  } finally {
    document.body.removeChild(band)
  }
}

// Rasterize the report element into a directly-downloaded multi-page PDF.
export async function generateReportPdf(reportEl: HTMLElement, filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const { toCanvas } = await import('html-to-image')

  const leaveCapture = enterCapture(reportEl)
  try {
    await document.fonts?.ready

    // A hidden layout clone at A4 width is used to measure element positions and
    // as the source for each page band. Off-screen is fine for measurement; the
    // bands themselves are captured from viewport-positioned windows.
    const layout = reportEl.cloneNode(true) as HTMLElement
    layout.removeAttribute('id')
    layout.style.cssText = [
      'position: absolute',
      'left: -20000px',
      'top: 0',
      `width: ${PAGE_W}px`,
      'max-width: none',
      'padding: 40px 52px 32px',
    ].join('; ')
    document.body.appendChild(layout)
    try {
      const cssH = layout.offsetHeight
      const bounds = pageBounds(cssH, breakTops(layout))

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
      for (let i = 0; i < bounds.length - 1; i++) {
        if (i > 0) doc.addPage()
        const offset = bounds[i]
        const bandH = bounds[i + 1] - offset
        const canvas = await captureBand(toCanvas, layout, offset, bandH)
        // Keep the last, possibly shorter page at its natural aspect so it is
        // not stretched to fill the full sheet.
        const mmH = 297 * (bandH / PAGE_H)
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, mmH)
      }
      doc.save(filename)
    } finally {
      document.body.removeChild(layout)
    }
  } finally {
    leaveCapture()
  }
}
