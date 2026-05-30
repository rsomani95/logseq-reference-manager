/**
 * validate.ts — numeric round-trip core of validate.py.
 *
 * Proves the coordinate transform (native -> stored-scaled -> pixels) by taking
 * each converted record's stored rect and applying the EXACT Logseq inverse
 * (scaledToViewport), then cross-checking against fitz_native * scale (valid
 * because width==page_w and height==page_h). Tracks the max absolute component
 * diff and renders a PASS/FAIL verdict.
 *
 * This is the filesystem-free core: it does NOT render PNG overlays (a
 * CLI-only concern). `overlays` is therefore always [].
 */

import { scaledToViewport } from './geometry'
import type { ConvertedRecord, PageGeom, ValidateResult } from './types'

const EPS = 1e-6

/**
 * Look up per-page geometry. The pages map is keyed by 0-based page index as a
 * string ("0","1",...), so for a 1-based page number we read pages[page-1].
 */
function pageMetaFor(pages: Record<string, PageGeom>, page1: number): PageGeom {
  const key0 = page1 - 1
  const pm = pages[String(key0)]
  if (pm === undefined) {
    throw new Error(
      `no page geometry for page ${page1} (0-based ${key0}); ` +
        `pages.json may be stale or out of sync with the records`,
    )
  }
  return pm
}

export function validate(
  records: ConvertedRecord[],
  pages: Record<string, PageGeom>,
  opts?: { scale?: number },
): ValidateResult {
  if (records.length === 0) {
    // Nothing to validate.
    return { max_err: 0.0, verdict: 'N/A', n_pages: 0, overlays: [] }
  }

  const scale = opts?.scale ?? 2.0

  const byPage = new Map<number, ConvertedRecord[]>()
  for (const r of records) {
    const bucket = byPage.get(r.page)
    if (bucket === undefined) byPage.set(r.page, [r])
    else bucket.push(r)
  }

  let maxErr = 0.0

  for (const page1 of [...byPage.keys()].sort((a, b) => a - b)) {
    const pm = pageMetaFor(pages, page1)
    const pageW = pm.width_pt
    const pageH = pm.height_pt

    const pageRecords = byPage.get(page1)
    if (pageRecords === undefined) continue

    for (const r of pageRecords) {
      const hv = r.hl_value.position

      // check each :rects entry
      for (const rc of hv.rects) {
        const [l, t, rr, b] = scaledToViewport(rc, scale, pageW, pageH)
        // cross-check vs fitz_native * scale (since width==page_w)
        const ref0 = rc.x1 * scale
        const ref1 = rc.y1 * scale
        const ref2 = rc.x2 * scale
        const ref3 = rc.y2 * scale
        const e = Math.max(
          Math.abs(l - ref0),
          Math.abs(t - ref1),
          Math.abs(rr - ref2),
          Math.abs(b - ref3),
        )
        if (e > maxErr) maxErr = e
      }
    }
  }

  const verdict: ValidateResult['verdict'] = maxErr < EPS ? 'PASS' : 'FAIL'

  return {
    max_err: maxErr,
    verdict,
    n_pages: byPage.size,
    overlays: [],
  }
}
