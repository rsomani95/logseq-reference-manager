/**
 * zotero.ts — convert Zotero-native annotations into Logseq DB-graph annotation
 * records (the case-(a) path: annotations made inside Zotero's own PDF reader,
 * stored in Zotero's database, NOT embedded in the PDF file).
 *
 * Why a separate path from extract.ts/convert.ts? Those read a PDF's embedded
 * `/Annots` via mupdf. Zotero-native annotations aren't in the file — they live
 * in Zotero's DB and reach us through the local API as `annotation` items. But
 * the TARGET is identical: the same `ConvertedRecord` / `hl-value` shape the PDF
 * path produces, so edn.ts and the stage-2 import work unchanged.
 *
 * What Zotero hands us (per annotation `data`):
 *   - annotationType: highlight | underline | note | text | image | ink
 *   - annotationPosition: a JSON STRING {pageIndex, rects:[[x1,y1,x2,y2],...]}
 *       — rects are in PDF user space (points, origin bottom-left, y-up): the
 *       SAME space as /Rect and /QuadPoints. Verified by transforming live rects
 *       through flipRect→toStored and matching the mupdf-derived golden to 3 d.p.
 *       (residuals are sub-0.4pt viewer text-selection differences). text/sticky
 *       positions also carry fontSize / rotation.
 *   - annotationText: the covered text (markup) — already extracted by Zotero,
 *       so unlike the PDF path we need no structured-text reconstruction.
 *   - annotationComment: the user's note.
 *   - annotationColor: a hex string (Zotero palette or, for externally-imported
 *       annotations, the source app's raw color).
 *   - annotationSortIndex: Zotero's authoritative reading-order key.
 *
 * Coordinate transform and color mapping are reused verbatim from geometry.ts /
 * colors.ts — the converter is pure (no fs, no mupdf): it takes already-parsed
 * annotations plus page geometry (see pdf-pages.ts) and returns a ConvertResult.
 */
import { colorFromCss, DB_IDENT, mapColor } from './colors'
import {
  DEFAULT_ASSET_UUID,
  resolveColor,
  validateColorByType,
} from './convert'
import { bounding, flipRect, quadStoredRects, toStored } from './geometry'
import type {
  AnnotCategory,
  ColorByType,
  ColorName,
  ConvertedRecord,
  ConvertResult,
  ConvertStatus,
  HlValue,
  PageGeom,
  StoredRect,
} from './types'
import { uuidForZoteroAnnotation } from './uuid'

// The six Zotero annotation types (Zotero.Annotations.ANNOTATION_TYPE_*).
export type ZoteroAnnotationType =
  | 'highlight'
  | 'note'
  | 'image'
  | 'ink'
  | 'underline'
  | 'text'

/**
 * The subset of a Zotero `annotation` item's `data` we consume. Extra fields the
 * API returns (version, dateAdded, tags, …) are ignored. `key` is the annotation
 * item's key — unique within the library and the basis for its stable uuid.
 */
export interface ZoteroAnnotationData {
  key: string
  annotationType: ZoteroAnnotationType
  annotationPosition: string
  annotationText?: string
  annotationComment?: string
  annotationColor?: string
  annotationPageLabel?: string
  annotationSortIndex?: string
  annotationAuthorName?: string
}

/** The parsed `annotationPosition`. rects are PDF user space [x1,y1,x2,y2], y-up. */
export interface ZoteroPosition {
  pageIndex: number
  rects: [number, number, number, number][]
  fontSize?: number
  rotation?: number
}

export interface ZoteroConvertOptions {
  /** Asset block uuid the annotations bind to (stage-2 import overrides this). */
  assetUuid?: string
  /** Title of the page/asset, for the EDN header. */
  assetTitle?: string
  /** Force one flat highlight color for every record (else map from annotationColor). */
  color?: ColorName | null
  /** Per-category color override (markup / text / note); wins over `color`. */
  colorByType?: ColorByType | null
  /** Zotero library id — combined with the annotation key for stable uuids. */
  libraryID?: number | string
}

// highlight/underline → a text-highlight band over the rects.
const MARKUP_TYPES = new Set<ZoteroAnnotationType>(['highlight', 'underline'])
// note (sticky) / text (typed box) → a text-highlight anchored at the box; the
// note's content is the user's comment. (Bucketed for per-category color:
// `text` → the 'text' category, `note` → the 'note' category; see buildZoteroRecord.)
// image (area) and ink have no Logseq text-highlight equivalent — an area
// highlight is a cropped-region image (a different construct that needs the PNG
// crop path, not built here). Skipped with a warning, like convert.ts does for
// unsupported PDF subtypes.

/**
 * Parse the JSON-encoded `annotationPosition`. Returns null (caller skips) if it
 * is missing, unparseable, or has no usable rects. Defensive about shape because
 * it is an opaque string from an external system.
 */
export function parseZoteroPosition(
  raw: string | null | undefined,
): ZoteroPosition | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null) return null
  const o = obj as Record<string, unknown>
  if (typeof o.pageIndex !== 'number') return null
  if (!Array.isArray(o.rects)) return null

  const rects: [number, number, number, number][] = []
  for (const r of o.rects) {
    if (
      Array.isArray(r) &&
      r.length >= 4 &&
      typeof r[0] === 'number' &&
      typeof r[1] === 'number' &&
      typeof r[2] === 'number' &&
      typeof r[3] === 'number'
    ) {
      rects.push([r[0], r[1], r[2], r[3]])
    }
  }

  const pos: ZoteroPosition = { pageIndex: o.pageIndex, rects }
  if (typeof o.fontSize === 'number') pos.fontSize = o.fontSize
  if (typeof o.rotation === 'number') pos.rotation = o.rotation
  return pos
}

/** Page geometry lookup by 0-based page index (the pdf-pages.ts key convention). */
function pageGeomForIndex(
  pageMeta: Record<string, PageGeom>,
  pageIndex0: number,
): PageGeom | undefined {
  return pageMeta[String(pageIndex0)]
}

/**
 * Reading-order comparator. Zotero's `annotationSortIndex` is a fixed-width,
 * zero-padded "page|offset|y" string, so a plain lexicographic compare yields
 * Zotero's own reading order (handles columns correctly). Ties / missing indices
 * fall back to the annotation key for a stable, deterministic order.
 */
function bySortIndex(a: ZoteroAnnotationData, b: ZoteroAnnotationData): number {
  const sa = a.annotationSortIndex ?? ''
  const sb = b.annotationSortIndex ?? ''
  if (sa !== sb) return sa < sb ? -1 : 1
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * Build one Logseq annotation record from a Zotero annotation. Returns null for
 * anything skipped (image/ink, no geometry, no page). Never throws on bad input.
 */
function buildZoteroRecord(
  d: ZoteroAnnotationData,
  pageMeta: Record<string, PageGeom>,
  libraryID: number | string,
  forceColor: ColorName | null,
  forceColorByType: ColorByType | null,
  status: ConvertStatus,
  globalIndex: number,
): ConvertedRecord | null {
  const t = d.annotationType

  if (t === 'image' || t === 'ink') {
    console.warn(
      `  SKIP ${t} ${d.key}: no Logseq text-highlight equivalent ` +
        '(area/ink highlights need the PNG-crop construct, not built here)',
    )
    status.skipped_unsupported.push(t)
    return null
  }

  const pos = parseZoteroPosition(d.annotationPosition)
  if (!pos || pos.rects.length === 0) {
    console.warn(`  SKIP ${t} ${d.key}: no usable rects in annotationPosition`)
    status.skipped_unsupported.push(t)
    return null
  }

  const pm = pageGeomForIndex(pageMeta, pos.pageIndex)
  if (!pm) {
    console.warn(
      `  SKIP ${t} ${d.key}: no page geometry for pageIndex ${pos.pageIndex} ` +
        '(is the page count of the PDF on disk in sync with Zotero?)',
    )
    status.skipped_unsupported.push(t)
    return null
  }

  const page1 = pos.pageIndex + 1
  const pageW = pm.width_pt
  const pageH = pm.height_pt
  const coff = pm.cropbox_offset_from_mediabox
  const cx0 = coff ? coff[0] : 0.0
  const cy0 = coff ? coff[1] : 0.0

  if (pm.rotation !== 0 || (pos.rotation ?? 0) !== 0) {
    // Mirrors convert.ts: rotation is unvalidated; emit rot-0 geometry, warn.
    console.warn(
      `  WARNING: ${t} ${d.key} on rotated page (page rot=${pm.rotation}, ` +
        `annot rot=${pos.rotation ?? 0}); emitting rot-0 geometry (may be wrong).`,
    )
  }

  // --- geometry + content + comment per type ---
  let rects: StoredRect[]
  let text: string
  let comment = ''
  let category: AnnotCategory
  if (MARKUP_TYPES.has(t)) {
    category = 'markup'
    // Each rect (PDF y-up) → fitz (y-down) → stored; sort top-then-left.
    const fitz = pos.rects.map((r) => flipRect(r, pageH, cx0, cy0))
    rects = quadStoredRects(fitz, pageW, pageH)
    text = d.annotationText ?? ''
    comment = (d.annotationComment ?? '').trim()
  } else {
    // note (sticky pin) / text (typed box): the single rect is the anchor box;
    // the note's body IS the user's comment (no covered text to title it with).
    category = t === 'text' ? 'text' : 'note'
    const fitz = flipRect(pos.rects[0]!, pageH, cx0, cy0)
    rects = [toStored(fitz, pageW, pageH)]
    text = (d.annotationComment ?? '').trim() || (d.annotationText ?? '')
  }
  const bound = bounding(rects)

  const blockTitle = text
  const isEmpty = blockTitle.trim() === ''
  if (isEmpty) status.empty_content += 1

  let colorName: ColorName
  let colorIdent: string
  const forced = resolveColor(category, forceColor, forceColorByType)
  if (forced) {
    colorName = forced
    colorIdent = DB_IDENT[forced]
  } else {
    ;[colorName, colorIdent] = mapColor(colorFromCss(d.annotationColor ?? null))
  }

  const uuid = uuidForZoteroAnnotation(libraryID, d.key)
  const commentUuid = comment
    ? uuidForZoteroAnnotation(libraryID, d.key, 'comment')
    : undefined

  const hlValue: HlValue = {
    id: uuid,
    page: page1,
    position: { page: page1, bounding: bound, rects },
    content: { text },
    properties: { color: colorName },
  }

  const rec: ConvertedRecord = {
    global_index: globalIndex,
    // Provenance is the Zotero type (lowercased), not a PDF /Subtype.
    pdf_subtype: t,
    logseq_construct: 'text-highlight',
    uuid,
    // Not reused from an NM; it's a deterministic v5 uuid derived from the
    // Zotero key (idempotent across syncs — see uuid.ts).
    uuid_reused_from_NM: false,
    page: page1,
    empty_content: isEmpty,
    color_name: colorName,
    color_db_ident: colorIdent,
    src_color_hex: d.annotationColor ?? null,
    src_color_source: 'zotero',
    block_title: blockTitle,
    hl_color_db_ident: colorIdent,
    hl_page: page1,
    hl_value: hlValue,
  }
  if (comment && commentUuid) {
    rec.comment = comment
    rec.comment_uuid = commentUuid
  }
  return rec
}

/**
 * Convert Zotero-native annotations into Logseq annotation records + tallies.
 * Output shape is identical to convert(); `skipped_links`/`skipped_popups` are
 * always 0 (no such companions in Zotero's annotation list).
 *
 * `opts.color`, if given (a DB_IDENT key), forces a single flat highlight color;
 * otherwise each color is mapped from the annotation's `annotationColor`.
 * `opts.colorByType` overrides that per category (markup / text / note).
 * `opts.libraryID` should be the Zotero library id so block uuids are stable.
 */
export function convertZoteroAnnotations(
  annots: ZoteroAnnotationData[],
  pageMeta: Record<string, PageGeom>,
  opts: ZoteroConvertOptions = {},
): ConvertResult {
  const assetUuid = opts.assetUuid ?? DEFAULT_ASSET_UUID
  const assetTitle = opts.assetTitle ?? 'document'
  const forceColor = opts.color ?? null
  const forceColorByType = opts.colorByType ?? null
  const libraryID = opts.libraryID ?? 0

  if (forceColor !== null && !(forceColor in DB_IDENT)) {
    throw new Error(
      `unknown color ${JSON.stringify(forceColor)}; expected one of ` +
        JSON.stringify(Object.keys(DB_IDENT).sort()),
    )
  }
  validateColorByType(forceColorByType)

  const status: ConvertStatus = {
    skipped_links: 0,
    skipped_popups: 0,
    skipped_unsupported: [],
    empty_content: 0,
  }

  // Build in Zotero's reading order so global_index and record order are stable.
  const sorted = [...annots].sort(bySortIndex)
  const records: ConvertedRecord[] = []
  let gi = 0
  for (const d of sorted) {
    const rec = buildZoteroRecord(
      d,
      pageMeta,
      libraryID,
      forceColor,
      forceColorByType,
      status,
      gi,
    )
    if (rec) {
      records.push(rec)
      gi += 1
    }
  }

  return {
    asset_uuid: assetUuid,
    asset_title: assetTitle,
    count: records.length,
    skipped_links: 0,
    skipped_popups: 0,
    skipped_unsupported: status.skipped_unsupported,
    empty_content: status.empty_content,
    records,
  }
}
