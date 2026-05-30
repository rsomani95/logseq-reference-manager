/**
 * extract.ts — ground-truth reconnaissance of native PDF annotations.
 *
 * Faithful behavioral port of `pdf_annot_logseq/extract.py`. The Python used
 * PyMuPDF (fitz) for page geometry / structured text and pikepdf for the raw
 * /Annots dictionary walk (which sees /Link, /Popup, and FreeText colors in
 * /DS or /RC that the high-level annotation iterator hides). Here BOTH roles
 * are played by mupdf: the page's PDFObject dict gives us the raw /Annots array
 * (the pikepdf equivalent), and `toStructuredText` gives us the words for the
 * covered-text reconstruction (the fitz equivalent).
 *
 * Core module: filesystem-free. `extract(bytes, sourcePath?)` returns the same
 * structure the Python `extract()` produced.
 */
import * as mupdf from 'mupdf'

import {
  colorFromCss,
  hexOf,
  nearestLogseq,
  nearestName,
  to255,
} from './colors'
import { decodeQuadpoints, pyRound, quadRectToFitz } from './geometry'
import type {
  AnnotationRecord,
  ColorInfo,
  DistinctColor,
  ExtractResult,
  LinkTarget,
  PageGeom,
  Quad,
  RGB,
} from './types'

// ---------------------------------------------------------------------------
// Covered-text reconstruction (fitz `get_text("words")` equivalent)
// ---------------------------------------------------------------------------

/** A reconstructed fitz-style word: bbox (fitz top-left, y-down) + text. */
interface Word {
  x0: number
  y0: number
  x1: number
  y1: number
  text: string
}

/**
 * Walk a page's structured text and reconstruct fitz-style words.
 *
 * fitz's `page.get_text("words")` yields whitespace-delimited words with a
 * single bbox. We approximate it by accumulating chars into a word, flushing on
 * any whitespace char and at every line boundary. The word bbox is the min/max
 * over the corners of each char's quad (which mupdf gives in top-left / y-down
 * page space == fitz coords): quad = [ulx,uly, urx,ury, llx,lly, lrx,lry].
 */
function pageWords(page: mupdf.PDFPage): Word[] {
  const words: Word[] = []
  const st = page.toStructuredText('preserve-whitespace')

  let chars = ''
  let xs: number[] = []
  let ys: number[] = []

  const flush = (): void => {
    if (chars.length === 0) return
    let minX = xs[0]!
    let minY = ys[0]!
    let maxX = xs[0]!
    let maxY = ys[0]!
    for (let i = 1; i < xs.length; i++) {
      const x = xs[i]!
      const y = ys[i]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    words.push({ x0: minX, y0: minY, x1: maxX, y1: maxY, text: chars })
    chars = ''
    xs = []
    ys = []
  }

  st.walk({
    beginLine(): void {
      flush()
    },
    endLine(): void {
      flush()
    },
    onChar(c: string, _origin, _font, _size, quad): void {
      if (/\s/.test(c)) {
        flush()
        return
      }
      chars += c
      // quad corners: [ulx,uly, urx,ury, llx,lly, lrx,lry]
      xs.push(quad[0], quad[2], quad[4], quad[6])
      ys.push(quad[1], quad[3], quad[5], quad[7])
    },
  })
  flush()

  return words
}

/**
 * For each decoded quad, extract the underlying covered span from `words`.
 *
 * Port of `covered_text_for_quads`. A text-markup quad is one line tall. We keep
 * a word when (a) its vertical CENTER lies inside the quad's fitz rect and (b)
 * it has meaningful horizontal overlap (>= 0.3 * word width) with the quad.
 * Words are then emitted in reading order (round y to group lines, then by x).
 * Fallback (no center hits): collect chars whose center lies in a slightly
 * padded clip rect, collapsing whitespace.
 *
 * Returns [perQuadTexts, joinedText].
 */
function coveredTextForQuads(
  page: mupdf.PDFPage,
  words: Word[],
  quads: Quad[],
): [string[], string] {
  const bounds = page.getBounds()
  const pageH = bounds[3] - bounds[1]

  const perQuad: string[] = []
  for (const q of quads) {
    const fr = quadRectToFitz(q.rect_pdf, pageH) // [x0, top, x1, bottom]
    const frX0 = fr[0]
    const frY0 = fr[1]
    const frX1 = fr[2]
    const frY1 = fr[3]

    const hits: [number, number, string][] = []
    for (const w of words) {
      const cy = (w.y0 + w.y1) / 2.0
      if (!(frY0 <= cy && cy <= frY1)) continue
      const overlap = Math.min(w.x1, frX1) - Math.max(w.x0, frX0)
      const width = w.x1 - w.x0
      if (width > 0 && overlap >= 0.3 * width) {
        // round y to group into lines, then order by x
        hits.push([pyRound(w.y0, 1), w.x0, w.text])
      }
    }

    if (hits.length === 0) {
      // fallback: collect chars whose center is in the padded clip rect
      const px0 = frX0 - 0.5
      const py0 = frY0 - 1.0
      const px1 = frX1 + 0.5
      const py1 = frY1 + 1.0
      let txt = ''
      const st = page.toStructuredText('preserve-whitespace')
      st.walk({
        onChar(c: string, _origin, _font, _size, quad): void {
          const cx = (quad[0] + quad[2] + quad[4] + quad[6]) / 4.0
          const cy = (quad[1] + quad[3] + quad[5] + quad[7]) / 4.0
          if (cx >= px0 && cx <= px1 && cy >= py0 && cy <= py1) {
            txt += c
          }
        },
      })
      perQuad.push(txt.trim().replace(/\s+/g, ' '))
      continue
    }

    hits.sort((a, b) => {
      if (a[0] !== b[0]) return a[0] - b[0]
      if (a[1] !== b[1]) return a[1] - b[1]
      return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0
    })
    perQuad.push(hits.map((h) => h[2]).join(' '))
  }

  let joined = perQuad
    .filter((t) => t)
    .join(' ')
    .trim()
  joined = joined.replace(/\s+/g, ' ')
  return [perQuad, joined]
}

// ---------------------------------------------------------------------------
// PDFObject helpers (the pikepdf-equivalent raw reads)
// ---------------------------------------------------------------------------

/** Read a numeric array key; returns null if absent (isNull). */
function readNumArray(o: mupdf.PDFObject): number[] | null {
  if (o.isNull()) return null
  if (!o.isArray()) return null
  const n = o.length
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(o.get(i).asNumber())
  }
  return out
}

/** Read a string key; returns null if absent. */
function readStr(o: mupdf.PDFObject): string | null {
  if (o.isNull()) return null
  return o.asString()
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

const TEXT_MARKUP_SUBTYPES = new Set([
  'Highlight',
  'Underline',
  'StrikeOut',
  'Squiggly',
])

export function extract(bytes: Uint8Array, sourcePath = ''): ExtractResult {
  const doc = mupdf.PDFDocument.openDocument(
    bytes,
    'application/pdf',
  ) as mupdf.PDFDocument

  const annotations: AnnotationRecord[] = []
  const pagesGeom: Record<string, PageGeom> = {}
  let globalIndex = 0

  const npages = doc.countPages()

  for (let pno = 0; pno < npages; pno++) {
    const page = doc.loadPage(pno) as mupdf.PDFPage
    const pobj = page.getObject()
    const annots = pobj.get('Annots')
    if (annots.isNull() || !annots.isArray()) continue

    const nAnnots = annots.length

    // --- page geometry (record for any page with /Annots) ---
    const bounds = page.getBounds()
    const x0 = bounds[0]
    const y0 = bounds[1]
    const x1 = bounds[2]
    const y1 = bounds[3]
    const widthPt = x1 - x0
    const heightPt = y1 - y0
    const pageH = heightPt

    const mbObj = pobj.get('MediaBox')
    const cbObj = pobj.get('CropBox')
    const mbV = readNumArray(mbObj)
    const cbV = readNumArray(cbObj)
    const rotateObj = pobj.get('Rotate')
    const rotate = rotateObj.isNull() ? 0 : Math.trunc(rotateObj.asNumber())

    let cropboxOffset: [number, number] | null = null
    if (mbV && mbV.length >= 2 && cbV && cbV.length >= 2) {
      cropboxOffset = [cbV[0]! - mbV[0]!, cbV[1]! - mbV[1]!]
    }
    const mediaboxOrigin: [number, number] | null =
      mbV && mbV.length >= 2 ? [mbV[0]!, mbV[1]!] : null

    pagesGeom[String(pno)] = {
      page_index_0based: pno,
      page_1based: pno + 1,
      fitz_rect: [x0, y0, x1, y1],
      width_pt: widthPt,
      height_pt: heightPt,
      rotation: rotate,
      mediabox: mbV,
      cropbox: cbV,
      mediabox_origin: mediaboxOrigin,
      cropbox_offset_from_mediabox: cropboxOffset,
      n_annots_raw: nAnnots,
    }

    // page words for covered-text reconstruction (lazily built once per page)
    let words: Word[] | null = null

    for (let ai = 0; ai < nAnnots; ai++) {
      const a = annots.get(ai)

      const subtype = a.get('Subtype').asName()
      const nm = readStr(a.get('NM'))

      const rectV = readNumArray(a.get('Rect'))
      const rectPdf: [number, number, number, number] | null =
        rectV && rectV.length >= 4
          ? [rectV[0]!, rectV[1]!, rectV[2]!, rectV[3]!]
          : null

      // raw /C color
      const cRawV = readNumArray(a.get('C'))
      const cRgb: RGB | null = to255(cRawV)

      // interior color /IC (e.g. FreeText fill)
      const icRawV = readNumArray(a.get('IC'))
      const icRgb: RGB | null = to255(icRawV)

      const dsS = readStr(a.get('DS'))
      const daS = readStr(a.get('DA'))
      const rcS = readStr(a.get('RC'))

      // FreeText text color: prefer /DS then /RC then /C
      const dsColor: RGB | null = colorFromCss(dsS)
      const rcColor: RGB | null = colorFromCss(rcS)

      // QuadPoints
      const qpV = readNumArray(a.get('QuadPoints'))
      const quads: Quad[] = decodeQuadpoints(qpV)

      // Vertices / InkList
      const vertsV = readNumArray(a.get('Vertices'))
      const inklistObj = a.get('InkList')
      let inklistV: number[][] | null = null
      if (!inklistObj.isNull() && inklistObj.isArray()) {
        inklistV = []
        const npaths = inklistObj.length
        for (let pi = 0; pi < npaths; pi++) {
          const pathArr = readNumArray(inklistObj.get(pi))
          inklistV.push(pathArr ?? [])
        }
      }

      const contentsS = readStr(a.get('Contents'))
      const authorS = readStr(a.get('T'))
      const creation = readStr(a.get('CreationDate'))
      const moddate = readStr(a.get('M'))
      const flagsObj = a.get('F')
      const flagsV = flagsObj.isNull() ? null : Math.trunc(flagsObj.asNumber())

      // Link target (for completeness / so converter can ignore them)
      let linkTarget: LinkTarget | null = null
      const A = a.get('A')
      if (!A.isNull()) {
        const sObj = A.get('S')
        const s = sObj.isNull() ? '' : sObj.asName()
        if (s === 'URI') {
          const uriObj = A.get('URI')
          linkTarget = {
            kind: 'uri',
            uri: uriObj.isNull() ? '' : uriObj.asString(),
          }
        } else if (s === 'GoTo') {
          const dObj = A.get('D')
          linkTarget = {
            kind: 'goto',
            dest: dObj.isNull() ? '' : dObj.asString(),
          }
        } else {
          linkTarget = { kind: s }
        }
      }

      // --- covered text for text-markup subtypes ---
      let covered: string | null = null
      let coveredPerQuad: string[] | null = null
      const textMarkup = TEXT_MARKUP_SUBTYPES.has(subtype)
      if (textMarkup && quads.length > 0) {
        if (words === null) words = pageWords(page)
        const [perQuad, joined] = coveredTextForQuads(page, words, quads)
        covered = joined
        coveredPerQuad = perQuad
      }

      // Decide where the human-visible color really is.
      let effectiveColorRgb: RGB | null = null
      let colorSource: string | null = null
      if (subtype === 'FreeText') {
        if (dsColor) {
          effectiveColorRgb = dsColor
          colorSource = '/DS'
        } else if (rcColor) {
          effectiveColorRgb = rcColor
          colorSource = '/RC'
        } else if (cRgb) {
          effectiveColorRgb = cRgb
          colorSource = '/C'
        }
      } else {
        if (cRgb) {
          effectiveColorRgb = cRgb
          colorSource = '/C'
        }
      }

      // Quad rects expressed in fitz (top-left origin) for the converter.
      const quadsFitz: [number, number, number, number][] = []
      for (const q of quads) {
        const fr = quadRectToFitz(q.rect_pdf, pageH)
        quadsFitz.push([fr[0], fr[1], fr[2], fr[3]])
      }

      const color: ColorInfo = {
        C_raw: cRawV,
        C_rgb255: cRgb,
        C_hex: hexOf(cRgb),
        IC_raw: icRawV,
        IC_rgb255: icRgb,
        DS_string: dsS,
        DS_color_rgb255: dsColor,
        DS_color_hex: hexOf(dsColor),
        RC_color_rgb255: rcColor,
        DA_string: daS,
        effective_color_rgb255: effectiveColorRgb,
        effective_color_hex: hexOf(effectiveColorRgb),
        effective_color_source: colorSource,
        nearest_css_name: nearestName(effectiveColorRgb),
        nearest_logseq_name: nearestLogseq(effectiveColorRgb),
      }

      const rec: AnnotationRecord = {
        global_index: globalIndex,
        page_index_0based: pno,
        page_1based: pno + 1,
        annot_index_in_page: ai,
        subtype,
        is_text_markup: textMarkup,
        is_link: subtype === 'Link',
        name_NM: nm,
        author_T: authorS,
        creation_date: creation,
        mod_date: moddate,
        flags_F: flagsV,
        contents: contentsS,
        rect_pdf: rectPdf,
        color,
        geometry: {
          quadpoints_raw: qpV,
          quads_pdf: quads, // bottom-left origin
          quads_rect_fitz: quadsFitz, // top-left origin
          n_quads: quads.length,
          vertices: vertsV,
          inklist: inklistV,
        },
        covered_text: covered,
        covered_text_per_quad: coveredPerQuad,
        freetext_rich_RC: subtype === 'FreeText' ? rcS : null,
        link_target: linkTarget,
        has_appearance_stream: !a.get('AP').isNull(),
      }
      annotations.push(rec)
      globalIndex += 1
    }
  }

  // ---- summaries ----
  const bySubtype: Record<string, number> = {}
  for (const r of annotations) {
    bySubtype[r.subtype] = (bySubtype[r.subtype] ?? 0) + 1
  }

  const userAnnots = annotations.filter((r) => !r.is_link)
  const userBySubtype: Record<string, number> = {}
  for (const r of userAnnots) {
    userBySubtype[r.subtype] = (userBySubtype[r.subtype] ?? 0) + 1
  }

  // distinct effective colors among user annots (first-seen insertion order)
  interface DistinctAcc {
    hex: string
    rgb255: RGB | null
    nearest_css_name: string | null
    nearest_logseq_name: string | null
    subtypes: Set<string>
    count: number
  }
  const distinctColors = new Map<string, DistinctAcc>()
  for (const r of userAnnots) {
    const hx = r.color.effective_color_hex
    if (hx === null) continue
    let d = distinctColors.get(hx)
    if (d === undefined) {
      d = {
        hex: hx,
        rgb255: r.color.effective_color_rgb255,
        nearest_css_name: r.color.nearest_css_name,
        nearest_logseq_name: r.color.nearest_logseq_name,
        subtypes: new Set<string>(),
        count: 0,
      }
      distinctColors.set(hx, d)
    }
    d.subtypes.add(r.subtype)
    d.count += 1
  }
  const distinctUserColors: DistinctColor[] = []
  for (const d of distinctColors.values()) {
    distinctUserColors.push({
      hex: d.hex,
      rgb255: d.rgb255,
      nearest_css_name: d.nearest_css_name,
      nearest_logseq_name: d.nearest_logseq_name,
      subtypes: [...d.subtypes].sort(),
      count: d.count,
    })
  }

  const result: ExtractResult = {
    source_pdf: sourcePath,
    page_count: npages,
    totals: {
      all_annots: annotations.length,
      user_annots_excl_links: userAnnots.length,
      links: bySubtype['Link'] ?? 0,
    },
    by_subtype_all: bySubtype,
    by_subtype_user: userBySubtype,
    distinct_user_colors: distinctUserColors,
    annotations,
    pages: pagesGeom,
  }

  return result
}
