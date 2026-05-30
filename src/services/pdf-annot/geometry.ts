/**
 * Coordinate-transform math (the crux).
 *
 * Every formula here is COPIED VERBATIM from the Python pdf_annot_logseq/geometry.py
 * (itself copied from extract.py / convert.py / validate.py). This transform is
 * validated to ~1e-13; do NOT refactor or "improve" the formulas — any change
 * risks silently misplacing highlights.
 *
 * Four coordinate spaces (see docs/architecture.md §4):
 *   1. PDF native     — origin bottom-left, y-up, points. /Rect and /QuadPoints.
 *   2. fitz (PyMuPDF) — origin top-left, y-down, points. page.rect = (0,0,W,H).
 *   3. Logseq stored  — {x1,y1,x2,y2,width,height}; width/height are the page dims
 *                       the coords were captured against.
 *   4. Viewport px    — PDF.js viewport at scale S: top-left, y-down, px = S*points.
 *
 * Storing the fitz rect verbatim with width/height = page dims makes Logseq's
 * proportional read-back (scaledToViewport) exactly fitz_coord * S, hence
 * scale-independent.
 */
import type { Quad, StoredRect } from './types'

// --- Python rounding parity (round-half-to-even) ---

export function pyRound(x: number, ndigits = 0): number {
  const m = 10 ** ndigits
  const scaled = x * m
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let r: number
  if (diff > 0.5) r = floor + 1
  else if (diff < 0.5) r = floor
  else r = floor % 2 === 0 ? floor : floor + 1 // half -> even
  return r / m
}

// --- from extract.py: QuadPoints decode + fitz-rect for covered-text ---

/**
 * Decode a flat QuadPoints array into per-quad rects.
 *
 * Per PDF spec (12.5.6.10) each quad is 8 numbers giving 4 corners in the
 * order: (x1,y1)=upper-left, (x2,y2)=upper-right, (x3,y3)=lower-left,
 * (x4,y4)=lower-right -- all in unrotated PDF user space (origin bottom-left).
 * We return both the raw corners and an axis-aligned rect [x0,y0,x1,y1] with
 * y0<y1 (PDF convention, bottom-left origin) for each quad.
 */
export function decodeQuadpoints(qp: number[] | null | undefined): Quad[] {
  if (!qp || qp.length === 0) {
    return []
  }
  const nums = qp.map((x) => Number(x))
  const quads: Quad[] = []
  for (let i = 0; i <= nums.length - 8; i += 8) {
    const c = nums.slice(i, i + 8) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    const xs = [c[0], c[2], c[4], c[6]]
    const ys = [c[1], c[3], c[5], c[7]]
    quads.push({
      corners: {
        ul: [c[0], c[1]],
        ur: [c[2], c[3]],
        ll: [c[4], c[5]],
        lr: [c[6], c[7]],
      },
      rect_pdf: [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ],
    })
  }
  return quads
}

/**
 * Convert a PDF-space rect (bottom-left origin) to a fitz top-left rect
 * so we can pull the covered text. Python returns a fitz.Rect; here we return
 * the [x0, top, x1, bottom] tuple (top = page_height - y1, bottom = page_height - y0).
 */
export function quadRectToFitz(
  rectPdf: [number, number, number, number],
  pageHeight: number,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = rectPdf
  // flip y about the page height
  const top = pageHeight - y1
  const bottom = pageHeight - y0
  return [x0, top, x1, bottom]
}

// --- from convert.py: flip / store / bounding / quad sort ---

/**
 * Native PDF rect [X0,Y0,X1,Y1] (bottom-left, y-up) -> fitz top-left rect
 * [left,top,right,bottom]. Cropbox origin (cx0,cy0) subtracted first (no-op for
 * this sample). Reproduces extract.py's quads_rect_fitz exactly.
 */
export function flipRect(
  rectPdf: number[],
  pageH: number,
  cx0 = 0.0,
  cy0 = 0.0,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = rectPdf as [number, number, number, number]
  void cy0
  const left = x0 - cx0
  const right = x1 - cx0
  const top = pageH - y1 // bottom edge in y-up -> top edge in y-down
  const bottom = pageH - y0
  return [left, top, right, bottom]
}

/**
 * fitz top-left points rect -> Logseq stored-scaled position.
 * Store verbatim; width/height are the page dims so read-back == fitz*scale.
 */
export function toStored(
  fitzRect: [number, number, number, number],
  pageW: number,
  pageH: number,
): StoredRect {
  const [left, top, right, bottom] = fitzRect
  return {
    x1: pyRound(left, 3),
    y1: pyRound(top, 3),
    x2: pyRound(right, 3),
    y2: pyRound(bottom, 3),
    width: pageW,
    height: pageH,
  }
}

/**
 * Union of stored rects -> bounding stored rect (mirrors getBoundingRect,
 * utils.js:70-101). width/height carried through unchanged.
 */
export function bounding(storedRects: StoredRect[]): StoredRect {
  const x1 = Math.min(...storedRects.map((r) => r.x1))
  const y1 = Math.min(...storedRects.map((r) => r.y1))
  const x2 = Math.max(...storedRects.map((r) => r.x2))
  const y2 = Math.max(...storedRects.map((r) => r.y2))
  const first = storedRects[0]!
  const w = first.width
  const h = first.height
  return {
    x1: pyRound(x1, 3),
    y1: pyRound(y1, 3),
    x2: pyRound(x2, 3),
    y2: pyRound(y2, 3),
    width: w,
    height: h,
  }
}

/**
 * Each /QuadPoints quad (already decoded to a fitz rect by extract.py) ->
 * one stored rect, sorted top asc then left asc (optimizeClientRects,
 * utils.js:134-143).
 */
export function quadStoredRects(
  quadsRectFitz: [number, number, number, number][],
  pageW: number,
  pageH: number,
): StoredRect[] {
  const rects = quadsRectFitz.map((q) => toStored(q, pageW, pageH))
  rects.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)
  return rects
}

// --- from validate.py: the read-back inverse ---

/**
 * Exact replica of scaledToViewport (default branch), viewport = scale*page.
 */
export function scaledToViewport(
  stored: StoredRect,
  scale: number,
  pageW: number,
  pageH: number,
): [number, number, number, number] {
  const vwW = scale * pageW
  const vwH = scale * pageH
  const left = (vwW * stored.x1) / stored.width
  const top = (vwH * stored.y1) / stored.height
  const right = (vwW * stored.x2) / stored.width
  const bot = (vwH * stored.y2) / stored.height
  return [left, top, right, bot]
}
