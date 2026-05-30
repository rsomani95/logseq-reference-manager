/**
 * pdf-pages.ts — read EVERY page's geometry from a PDF via mupdf.
 *
 * The Zotero path stores annotation rects in PDF user space but does NOT carry
 * the page dimensions, and Zotero-native annotations are not embedded in the PDF
 * file at all. So to flip a Zotero rect into Logseq's stored space we still need
 * the page's width/height (and cropbox offset / rotation) — which we read from
 * the PDF file itself. We need geometry for ALL pages, since `extract()` only
 * records pages that have an `/Annots` array (empty for a Zotero-annotated file).
 *
 * The per-page geometry computation is intentionally identical to the inline
 * block in extract.ts (the golden-tested source of truth); kept separate so that
 * extract()'s byte-exact behavior is never perturbed. fs-free: takes bytes.
 */
import * as mupdf from 'mupdf'

import type { PageGeom } from './types'

/** Read a numeric array PDFObject; null if absent / not an array. */
function readNumArray(o: mupdf.PDFObject): number[] | null {
  if (o.isNull() || !o.isArray()) return null
  const n = o.length
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(o.get(i).asNumber())
  return out
}

/**
 * Page geometry for every page of `bytes`, keyed by 0-based page index as a
 * string ("0","1",…) — the same key convention `extract()` / `pageMetaFor` use.
 */
export function pageGeometriesFromBytes(
  bytes: Uint8Array,
): Record<string, PageGeom> {
  const doc = mupdf.PDFDocument.openDocument(
    bytes,
    'application/pdf',
  ) as mupdf.PDFDocument

  const pages: Record<string, PageGeom> = {}
  const npages = doc.countPages()

  for (let pno = 0; pno < npages; pno++) {
    const page = doc.loadPage(pno) as mupdf.PDFPage
    const pobj = page.getObject()

    const bounds = page.getBounds()
    const x0 = bounds[0]
    const y0 = bounds[1]
    const x1 = bounds[2]
    const y1 = bounds[3]
    const widthPt = x1 - x0
    const heightPt = y1 - y0

    const mbV = readNumArray(pobj.get('MediaBox'))
    const cbV = readNumArray(pobj.get('CropBox'))
    const rotateObj = pobj.get('Rotate')
    const rotate = rotateObj.isNull() ? 0 : Math.trunc(rotateObj.asNumber())

    const annots = pobj.get('Annots')
    const nAnnots = !annots.isNull() && annots.isArray() ? annots.length : 0

    let cropboxOffset: [number, number] | null = null
    if (mbV && mbV.length >= 2 && cbV && cbV.length >= 2) {
      cropboxOffset = [cbV[0]! - mbV[0]!, cbV[1]! - mbV[1]!]
    }
    const mediaboxOrigin: [number, number] | null =
      mbV && mbV.length >= 2 ? [mbV[0]!, mbV[1]!] : null

    pages[String(pno)] = {
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
  }

  return pages
}
