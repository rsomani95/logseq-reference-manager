// The companion web-clipper writes up to three top-level section blocks onto a
// clipped page — Abstract, Highlights, Page Content. The plugin owns how those
// are templated: each section's heading name, whether it arrives folded, and
// (for the optional ones) whether it's captured at all — plus the order they're
// written in. These keys are a contract the extension reads over the HTTP API;
// see the Web references table in dev_notes/settings.md before renaming any.
//
// Highlights is always imported (when the page has them), so it has no capture
// key; Abstract and Page Content each carry an enable toggle. Defaults here
// mirror the seed defaults in settings.ts — the UI falls back to these when a
// value is missing, Logseq seeds the same on a fresh install, and the extension
// keeps its own matching fallback. All three must agree (see dev_notes/settings.md).

export type WebSectionId = 'abstract' | 'highlights' | 'pageContent'

export interface WebSectionDef {
  id: WebSectionId
  label: string
  /** `web*BlockName` — heading the section nests under. */
  nameKey: string
  /** `webFold*` — import the section collapsed. */
  foldKey: string
  /** `webCapture*` — include the section. Absent ⇒ always imported. */
  captureKey?: string
  defaultName: string
  defaultFold: boolean
}

export const WEB_SECTIONS: Record<WebSectionId, WebSectionDef> = {
  abstract: {
    id: 'abstract',
    label: 'Abstract',
    nameKey: 'webAbstractBlockName',
    foldKey: 'webFoldAbstract',
    captureKey: 'webCaptureAbstract',
    defaultName: 'Abstract',
    defaultFold: false,
  },
  highlights: {
    id: 'highlights',
    label: 'Highlights',
    nameKey: 'webHighlightsBlockName',
    foldKey: 'webFoldHighlights',
    defaultName: 'Highlights',
    defaultFold: false,
  },
  pageContent: {
    id: 'pageContent',
    label: 'Page Content',
    nameKey: 'webPageContentBlockName',
    foldKey: 'webFoldPageContent',
    captureKey: 'webCapturePageContent',
    defaultName: 'Page Content',
    defaultFold: true,
  },
}

export const WEB_SECTION_DEFAULT_ORDER: WebSectionId[] = [
  'abstract',
  'highlights',
  'pageContent',
]

const isWebSectionId = (v: string): v is WebSectionId =>
  v === 'abstract' || v === 'highlights' || v === 'pageContent'

// `webSectionOrder` persists as a comma-separated id list — a plain string
// seeds reliably as a schema default and the extension just splits on ','.
// Parsing is defensive: keep recognised ids in their stored order (deduped),
// drop anything unknown, then append any section the stored value omitted in
// canonical order. The result always lists all three ids exactly once, so a
// stale/partial/hand-edited value can never strand a section.
export const parseSectionOrder = (raw: unknown): WebSectionId[] => {
  const stored = typeof raw === 'string' ? raw.split(',') : []
  const seen = new Set<WebSectionId>()
  const order: WebSectionId[] = []
  for (const part of stored) {
    const id = part.trim()
    if (isWebSectionId(id) && !seen.has(id)) {
      seen.add(id)
      order.push(id)
    }
  }
  for (const id of WEB_SECTION_DEFAULT_ORDER) {
    if (!seen.has(id)) order.push(id)
  }
  return order
}

export const serializeSectionOrder = (order: WebSectionId[]): string =>
  order.join(',')
