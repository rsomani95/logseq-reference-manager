/**
 * Shared type contract for the TypeScript port of pdf-annot-logseq stage 1.
 *
 * The serialized object shapes (snake_case keys) are kept IDENTICAL to the
 * Python source's JSON output (annotations.json / pages.json /
 * logseq-annotations.json) so the golden-parity tests can deep-equal them and
 * so the EDN serializer reproduces the byte-for-byte payload Logseq imports.
 * Internal identifiers (functions, locals) use idiomatic camelCase.
 */

/** RGB triple, 0-255 ints. */
export type RGB = [number, number, number]

/** Logseq's five fixed highlight colors. */
export type ColorName = 'yellow' | 'red' | 'green' | 'blue' | 'purple'

/**
 * The kind of mark, for per-category color overrides. Exhaustive over
 * everything we convert into a highlight block:
 *   - `markup` — band over text: Highlight / Underline / StrikeOut / Squiggly
 *     (PDF), highlight / underline (Zotero).
 *   - `text`   — free text typed onto the page: FreeText (PDF), text (Zotero).
 *   - `note`   — the sticky-note pin: Text (PDF), note (Zotero).
 */
export type AnnotCategory = 'markup' | 'text' | 'note'

/**
 * Optional per-category forced color. A present key forces that category's color
 * (or `null` = infer from the source mark); an absent key falls back to the flat
 * `color`. See `resolveColor` in convert.ts.
 */
export type ColorByType = Partial<Record<AnnotCategory, ColorName | null>>

// ---------------------------------------------------------------------------
// extract.ts output
// ---------------------------------------------------------------------------

/** One decoded /QuadPoints quad (PDF bottom-left origin). */
export interface Quad {
  corners: {
    ul: [number, number]
    ur: [number, number]
    ll: [number, number]
    lr: [number, number]
  }
  /** axis-aligned [minX, minY, maxX, maxY] in PDF space (y-up). */
  rect_pdf: [number, number, number, number]
}

export interface LinkTarget {
  kind: string
  uri?: string
  dest?: string
}

export interface ColorInfo {
  C_raw: number[] | null
  C_rgb255: RGB | null
  C_hex: string | null
  IC_raw: number[] | null
  IC_rgb255: RGB | null
  DS_string: string | null
  DS_color_rgb255: RGB | null
  DS_color_hex: string | null
  RC_color_rgb255: RGB | null
  DA_string: string | null
  effective_color_rgb255: RGB | null
  effective_color_hex: string | null
  effective_color_source: string | null
  nearest_css_name: string | null
  nearest_logseq_name: string | null
}

export interface AnnotationGeometry {
  quadpoints_raw: number[] | null
  quads_pdf: Quad[]
  /** each quad as a fitz top-left rect [left, top, right, bottom]. */
  quads_rect_fitz: [number, number, number, number][]
  n_quads: number
  vertices: number[] | null
  inklist: number[][] | null
}

export interface AnnotationRecord {
  global_index: number
  page_index_0based: number
  page_1based: number
  annot_index_in_page: number
  subtype: string
  is_text_markup: boolean
  is_link: boolean
  name_NM: string | null
  author_T: string | null
  creation_date: string | null
  mod_date: string | null
  flags_F: number | null
  contents: string | null
  rect_pdf: [number, number, number, number] | null
  color: ColorInfo
  geometry: AnnotationGeometry
  covered_text: string | null
  covered_text_per_quad: string[] | null
  freetext_rich_RC: string | null
  link_target: LinkTarget | null
  has_appearance_stream: boolean
}

export interface PageGeom {
  page_index_0based: number
  page_1based: number
  fitz_rect: [number, number, number, number]
  width_pt: number
  height_pt: number
  rotation: number
  mediabox: number[] | null
  cropbox: number[] | null
  mediabox_origin: [number, number] | null
  cropbox_offset_from_mediabox: [number, number] | null
  n_annots_raw: number
}

export interface DistinctColor {
  hex: string
  rgb255: RGB | null
  nearest_css_name: string | null
  nearest_logseq_name: string | null
  subtypes: string[]
  count: number
}

export interface ExtractResult {
  source_pdf: string
  page_count: number
  totals: {
    all_annots: number
    user_annots_excl_links: number
    links: number
  }
  by_subtype_all: Record<string, number>
  by_subtype_user: Record<string, number>
  distinct_user_colors: DistinctColor[]
  annotations: AnnotationRecord[]
  /** keyed by 0-based page index as a string ("0","1",...). Only pages with /Annots. */
  pages: Record<string, PageGeom>
}

// ---------------------------------------------------------------------------
// convert.ts output
// ---------------------------------------------------------------------------

/** Logseq stored-scaled position (viewportToScaled output). */
export interface StoredRect {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  height: number
}

export interface HlValue {
  id: string
  page: number
  position: {
    page: number
    bounding: StoredRect
    rects: StoredRect[]
  }
  content: { text: string }
  properties: { color: string }
}

export interface ConvertedRecord {
  global_index: number
  pdf_subtype: string
  logseq_construct: 'text-highlight'
  uuid: string
  uuid_reused_from_NM: boolean
  page: number
  empty_content: boolean
  color_name: ColorName
  color_db_ident: string
  src_color_hex: string | null
  src_color_source: string | null
  block_title: string
  hl_color_db_ident: string
  hl_page: number
  hl_value: HlValue
  // Optional commentary attached to a markup highlight, surfaced as a child
  // block under the annotation (see edn.ts). The PDF path leaves these unset
  // (so its output is unchanged); the Zotero path sets them from
  // `annotationComment`. `comment_uuid` is a stable derived uuid for that child
  // block so re-sync upserts it (see uuid.ts).
  comment?: string
  comment_uuid?: string
}

export interface ConvertResult {
  asset_uuid: string
  asset_title: string
  count: number
  skipped_links: number
  skipped_popups: number
  skipped_unsupported: string[]
  empty_content: number
  records: ConvertedRecord[]
}

/** Mutable tally bag threaded through buildRecord (mirrors convert.py `status`). */
export interface ConvertStatus {
  skipped_links: number
  skipped_popups: number
  skipped_unsupported: string[]
  empty_content: number
}

// ---------------------------------------------------------------------------
// validate.ts output
// ---------------------------------------------------------------------------

export interface ValidateResult {
  max_err: number
  verdict: 'PASS' | 'FAIL' | 'N/A'
  n_pages: number
  overlays: string[]
}
