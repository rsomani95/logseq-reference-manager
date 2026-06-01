/**
 * convert.ts — Convert a PDF's native annotations into Logseq DB-graph
 * annotation records.
 *
 * `convert(extractResult, opts)` consumes the result returned by extract() and
 * produces the converted records plus tallies.
 *
 * Coordinate transform (the crux): the geometry math lives verbatim in
 * geometry.ts. build_record's geometry/content/color/type/uuid logic is
 * preserved from convert.py.
 *
 * Type mapping — Logseq has only two constructs: a 5-color text highlight (band
 * over :rects) and an area highlight (PNG crop). Underline / StrikeOut /
 * Squiggly / Highlight all become text highlights over their QuadPoints.
 * FreeText / Text become a text highlight anchored at the (flipped) /Rect with
 * the note /Contents as the block content. /Link is skipped (a known, expected
 * skip). Popup is skipped quietly. Any other subtype (Ink, Line, Square, ...)
 * is skipped with a warning and counted, never crashing.
 *
 * (EDN serializers live in edn.ts and are not duplicated here.)
 */
import { DB_IDENT, mapColor } from './colors'
import { bounding, flipRect, quadStoredRects, toStored } from './geometry'
import type {
  AnnotationRecord,
  AnnotCategory,
  ColorByType,
  ColorName,
  ConvertedRecord,
  ConvertResult,
  ConvertStatus,
  ExtractResult,
  HlValue,
  PageGeom,
  StoredRect,
} from './types'

// Default placeholder asset UUID for the self-contained (stage-1) EDN. A real
// import (stage 2) finds/creates the asset and overrides this.
export const DEFAULT_ASSET_UUID = '11111111-1111-4111-8111-111111111111'

// PDF markup subtypes that become a text highlight band over QuadPoints.
export const MARKUP_SUBTYPES = new Set<string>([
  'Highlight',
  'Underline',
  'StrikeOut',
  'Squiggly',
])
// Note-style subtypes that become a text highlight anchored at /Rect.
export const NOTE_SUBTYPES = new Set<string>(['FreeText', 'Text'])
// Link and Popup are skipped QUIETLY (known, expected companions — not their
// own annotation); see buildRecord. Any other subtype is skipped with a warning.

/**
 * Bucket a PDF /Subtype into the category used for per-category color overrides.
 * Markup → 'markup'; FreeText (typed-on-page) → 'text'; Text (sticky pin) →
 * 'note'. Returns null for anything we don't convert (the caller skips it).
 */
export function categoryForSubtype(subtype: string): AnnotCategory | null {
  if (MARKUP_SUBTYPES.has(subtype)) return 'markup'
  if (subtype === 'FreeText') return 'text'
  if (subtype === 'Text') return 'note'
  return null
}

/**
 * Resolve the forced color for one record. A per-category override wins when its
 * key is present (`null` there meaning "infer from the source mark"); otherwise
 * the flat `color` applies. `null` overall = infer from the source. Shared by
 * the PDF (convert) and Zotero paths so both honor `colorByType` identically.
 */
export function resolveColor(
  category: AnnotCategory,
  color: ColorName | null,
  colorByType: ColorByType | null | undefined,
): ColorName | null {
  if (colorByType && category in colorByType)
    return colorByType[category] ?? null
  return color
}

/** Throw if any `colorByType` value isn't a valid ColorName (null = auto, ok). */
export function validateColorByType(
  colorByType: ColorByType | null | undefined,
): void {
  if (!colorByType) return
  for (const [cat, val] of Object.entries(colorByType)) {
    if (val != null && !(val in DB_IDENT)) {
      throw new Error(
        `unknown color ${JSON.stringify(val)} for ${cat}; expected one of ` +
          JSON.stringify(Object.keys(DB_IDENT).sort()),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// UUID idempotency
// ---------------------------------------------------------------------------
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Reuse /NM as the highlight uuid (idempotency) iff it is a well-formed,
 * not-yet-seen UUID; else mint a fresh uuid4 (SPEC risk #4).
 */
export function pickUuid(
  nm: string | null,
  seen: Set<string>,
): [string, boolean] {
  if (nm && UUID_RE.test(nm.trim())) {
    const u = nm.trim().toLowerCase()
    if (!seen.has(u)) {
      seen.add(u)
      return [u, true]
    }
  }
  const u = crypto.randomUUID()
  seen.add(u)
  return [u, false]
}

/** Look up per-page geometry by 0-based string key. */
export function pageMetaFor(
  pageMeta: Record<string, PageGeom>,
  page1: number,
): PageGeom {
  const key0 = page1 - 1
  const pm = pageMeta[String(key0)]
  if (pm !== undefined) {
    return pm
  }
  throw new Error(
    `no page geometry for page ${page1} (0-based ${key0}); ` +
      'pages.json may be stale or out of sync with annotations.json',
  )
}

/**
 * Build one converted annotation record (carrying both the Logseq hl-value
 * shape and diagnostic fields). Returns null for anything we skip.
 *
 * `color`, if given (one of DB_IDENT's keys), forces the highlight color for
 * every record instead of inferring it from the source annotation's color.
 * `colorByType` overrides that for the record's category (see resolveColor).
 *
 * `status` (optional) collects tallies: skipped_links, skipped_popups,
 * skipped_unsupported (list of subtypes), empty_content (count). buildRecord
 * never crashes on empty strings or unknown subtypes.
 */
export function buildRecord(
  a: AnnotationRecord,
  pageMeta: Record<string, PageGeom>,
  seenUuids: Set<string>,
  status?: ConvertStatus,
  color?: ColorName | null,
  colorByType?: ColorByType | null,
): ConvertedRecord | null {
  const subtype = a.subtype
  if (a.is_link || subtype === 'Link') {
    if (status) status.skipped_links += 1
    return null
  }
  if (subtype === 'Popup') {
    // Known, expected skip: companion window of a Text note. No warning.
    if (status) status.skipped_popups += 1
    return null
  }

  const page1 = a.page_1based
  const pm = pageMetaFor(pageMeta, page1)
  const pageW = pm.width_pt
  const pageH = pm.height_pt
  const rot = pm.rotation
  const coff = pm.cropbox_offset_from_mediabox
  const cx0 = coff ? coff[0] : 0.0
  const cy0 = coff ? coff[1] : 0.0

  if (rot !== 0) {
    // SPEC risk #1: rotation unvalidated. Warn; geometry below assumes rot 0.
    console.warn(
      `  WARNING: page ${page1} rotation=${rot} is UNVALIDATED; ` +
        'emitting rot-0 geometry (may be wrong).',
    )
  }

  const [hlUuid, reused] = pickUuid(a.name_NM, seenUuids)

  // --- geometry + content per type ---
  let rects: StoredRect[]
  let bound: StoredRect
  let text: string
  let category: AnnotCategory
  if (MARKUP_SUBTYPES.has(subtype)) {
    category = 'markup'
    let quads = a.geometry.quads_rect_fitz
    if (!quads || quads.length === 0) {
      // markup without quads -> fall back to /Rect single band
      if (!a.rect_pdf) {
        // No geometry at all; cannot place. Skip with warning.
        console.warn(
          `  SKIP ${subtype} (page ${page1}): no QuadPoints and no /Rect`,
        )
        if (status) status.skipped_unsupported.push(subtype)
        return null
      }
      quads = [flipRect(a.rect_pdf, pageH, cx0, cy0)]
    }
    rects = quadStoredRects(quads, pageW, pageH)
    bound = bounding(rects)
    text = a.covered_text || ''
  } else if (NOTE_SUBTYPES.has(subtype)) {
    // FreeText = text typed on the page; Text = the sticky-note pin.
    category = subtype === 'FreeText' ? 'text' : 'note'
    if (!a.rect_pdf) {
      console.warn(`  SKIP ${subtype} (page ${page1}): no /Rect to anchor`)
      if (status) status.skipped_unsupported.push(subtype)
      return null
    }
    const rect = flipRect(a.rect_pdf, pageH, cx0, cy0)
    rects = [toStored(rect, pageW, pageH)]
    bound = bounding(rects)
    text = a.contents || ''
  } else {
    console.warn(`  SKIP unsupported subtype ${subtype} (page ${page1})`)
    if (status) status.skipped_unsupported.push(subtype)
    return null
  }

  const blockTitle = text

  // Empty-content bookkeeping: still emit the (empty-titled) block, but count it.
  const isEmpty = blockTitle.trim() === ''
  if (isEmpty && status) status.empty_content += 1

  let colorName: ColorName
  let colorIdent: string
  const forced = resolveColor(category, color ?? null, colorByType)
  if (forced) {
    // Forced color (flat, or this category's override).
    colorName = forced
    colorIdent = DB_IDENT[forced]
  } else {
    // Infer the nearest Logseq pastel from the source annotation's color.
    ;[colorName, colorIdent] = mapColor(a.color.effective_color_rgb255)
  }

  const hlValue: HlValue = {
    id: hlUuid,
    page: page1,
    position: {
      page: page1,
      bounding: bound,
      rects: rects,
    },
    content: { text },
    properties: { color: colorName },
  }

  return {
    // --- identity / provenance (diagnostic) ---
    global_index: a.global_index,
    pdf_subtype: subtype,
    logseq_construct: 'text-highlight',
    uuid: hlUuid,
    uuid_reused_from_NM: reused,
    page: page1,
    empty_content: isEmpty,
    // --- color ---
    color_name: colorName,
    color_db_ident: colorIdent,
    src_color_hex: a.color.effective_color_hex,
    src_color_source: a.color.effective_color_source,
    // --- the stored Logseq annotation ---
    block_title: blockTitle,
    hl_color_db_ident: colorIdent,
    hl_page: page1,
    hl_value: hlValue,
  }
}

/**
 * Convert an extract() result into Logseq annotation records + tallies.
 *
 * `opts.color`, if given, forces a single flat highlight color for every record
 * (one of DB_IDENT's keys: yellow/red/green/blue/purple); otherwise each color
 * is inferred from the source annotation (the default). `opts.colorByType`
 * overrides that per category (markup / text / note) — a present key wins over
 * the flat color (its `null` meaning "infer for this category").
 *
 * Never crashes on zero annotations, empty strings, or unknown subtypes.
 */
export function convert(
  extractResult: ExtractResult,
  opts: {
    assetUuid?: string
    assetTitle?: string
    color?: ColorName | null
    colorByType?: ColorByType | null
  } = {},
): ConvertResult {
  const assetUuid = opts.assetUuid ?? DEFAULT_ASSET_UUID
  const assetTitle = opts.assetTitle ?? 'document'
  const color = opts.color ?? null
  const colorByType = opts.colorByType ?? null

  if (color !== null && !(color in DB_IDENT)) {
    throw new Error(
      `unknown color ${JSON.stringify(color)}; expected one of ${JSON.stringify(
        Object.keys(DB_IDENT).sort(),
      )}`,
    )
  }
  validateColorByType(colorByType)
  const pageMeta = extractResult.pages ?? {}
  const annotations = extractResult.annotations ?? []

  const status: ConvertStatus = {
    skipped_links: 0,
    skipped_popups: 0,
    skipped_unsupported: [],
    empty_content: 0,
  }

  const records: ConvertedRecord[] = []
  const seenUuids = new Set<string>()
  for (const a of annotations) {
    const rec = buildRecord(a, pageMeta, seenUuids, status, color, colorByType)
    if (rec) records.push(rec)
  }

  // deterministic order: page, then top of bounding box, then left
  records.sort((r1, r2) => {
    if (r1.page !== r2.page) return r1.page - r2.page
    const b1 = r1.hl_value.position.bounding
    const b2 = r2.hl_value.position.bounding
    if (b1.y1 !== b2.y1) return b1.y1 - b2.y1
    return b1.x1 - b2.x1
  })

  return {
    asset_uuid: assetUuid,
    asset_title: assetTitle,
    count: records.length,
    skipped_links: status.skipped_links,
    skipped_popups: status.skipped_popups,
    skipped_unsupported: status.skipped_unsupported,
    empty_content: status.empty_content,
    records,
  }
}
