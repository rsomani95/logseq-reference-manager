import { PLUGIN_ID, ZOTERO_CODE_PROP } from '../constants'
import { ZotData } from '../interfaces'
import { QUERY_ALL_ZOT_PAGES } from '../queries'

/**
 * A Logseq page that carries a `zotero-code` property — i.e. a Zotero item
 * already imported into the graph.
 */
export interface ZoteroCodedPage {
  uuid: string
  /**
   * The page's *current* display title. May differ from the name it was
   * imported under if the user has since renamed it — which is exactly the
   * point: detection matches the Zotero key, navigation / linking uses this.
   */
  title: string
}

// Recycled-page uuids. Logseq's Recycle bin (30-day retention) keeps pages —
// with their tags and properties — so they'd otherwise count as "in graph".
// Uses only attributes proven to bind in is-recycled-page.ts.
const QUERY_RECYCLED_PAGE_UUIDS = `
  [:find ?uuid
   :where
   [?p :logseq.property/deleted-at ?deleted-at]
   [?p :block/uuid ?uuid]]
`

interface PulledPage {
  uuid: string
  title?: string
  name?: string
}

/**
 * Indexes every Zotero item already in the graph, keyed by Zotero item key
 * (the value each imported page stores in its `zotero-code` property).
 *
 * This is the rename-proof "is it in the graph?" signal: it matches the
 * immutable Zotero key, not a page name rebuilt from `pagenameTemplate`, so
 * renaming an imported page in Logseq doesn't make it read as "not in graph"
 * again (which would let a re-import silently create a duplicate).
 *
 * Built from proven primitives: `QUERY_ALL_ZOT_PAGES` (every imported page is
 * tagged `Zotero`) for the page list, then `getPageProperties` to read each
 * page's `zotero-code` — resolving the value whatever its underlying DB storage
 * shape is.
 *
 * Recycled pages are excluded. On any failure the index comes back empty
 * (logged, not thrown) — callers then fall back to the page-name collision
 * check, still correct, just not rename-proof.
 */
export const buildZoteroCodeIndex = async (): Promise<
  Map<string, ZoteroCodedPage>
> => {
  const index = new Map<string, ZoteroCodedPage>()

  try {
    const [taggedRaw, recycledRaw] = await Promise.all([
      logseq.DB.datascriptQuery(QUERY_ALL_ZOT_PAGES),
      logseq.DB.datascriptQuery(QUERY_RECYCLED_PAGE_UUIDS),
    ])

    const recycledUuids = new Set<string>(
      (Array.isArray(recycledRaw) ? recycledRaw : [])
        .map((row) => row?.[0])
        .filter((uuid): uuid is string => typeof uuid === 'string'),
    )

    const pages = (Array.isArray(taggedRaw) ? taggedRaw : [])
      .flat()
      .filter(
        (p): p is PulledPage =>
          Boolean(p) &&
          typeof p.uuid === 'string' &&
          !recycledUuids.has(p.uuid),
      )

    // Read each page's properties in parallel; the zotero-code is keyed by its
    // full property ident.
    const withCode = await Promise.all(
      pages.map(async (page) => {
        const props = await logseq.Editor.getPageProperties(page.uuid)
        return { page, code: props?.[ZOTERO_CODE_PROP] }
      }),
    )

    for (const { page, code } of withCode) {
      if (typeof code !== 'string' || !code) continue
      // First match wins — a Zotero key should map to one page; if a stray
      // duplicate exists, prefer the one the query returned first.
      if (!index.has(code)) {
        index.set(code, {
          uuid: page.uuid,
          title: page.title ?? page.name ?? code,
        })
      }
    }

    console.log(
      `${PLUGIN_ID}: zotero-code index built — ${pages.length} Zotero page(s), ${index.size} with a zotero-code`,
    )

    // Self-diagnostic: tagged pages exist but none yielded a code — the
    // property read path is wrong for this Logseq build. Dump one raw entity
    // and its properties so the lookup can be corrected without guessing.
    const sample = pages[0]
    if (index.size === 0 && sample) {
      console.warn(
        `${PLUGIN_ID}: zotero-code index is EMPTY despite ` +
          `${pages.length} tagged page(s). Looked for property key ` +
          `"${ZOTERO_CODE_PROP}". Sample pulled entity + its properties:`,
        sample,
        await logseq.Editor.getPageProperties(sample.uuid),
      )
    }
  } catch (e) {
    console.error(
      `${PLUGIN_ID}: failed to build zotero-code index; ` +
        'in-graph detection will fall back to page-name matching',
      e,
    )
  }

  return index
}

/**
 * The in-graph rule, single-sourced: an item is in the graph when a page
 * carries a `zotero-code` property equal to the item's Zotero key.
 */
export const isItemInGraph = (
  item: ZotData,
  index: Map<string, ZoteroCodedPage>,
): boolean => {
  const code = item['zotero-code']
  return code ? index.has(code) : false
}

/**
 * Returns `items` with each `inGraph` flag recomputed against a freshly built
 * index. The same array reference is returned when nothing changed; otherwise
 * a new array, with new objects only for the items whose flag flipped (the
 * rest keep their reference, so React re-renders just what moved).
 *
 * Use this to refresh a long-lived `ZotData[]` snapshot — the plugin gets no
 * notification when the user renames / imports / removes pages, so flags
 * baked in at fetch time drift out of date.
 */
export const refreshInGraphFlags = async (
  items: ZotData[],
): Promise<ZotData[]> => {
  if (items.length === 0) return items
  const index = await buildZoteroCodeIndex()
  let changed = false
  const next = items.map((item) => {
    const inGraph = isItemInGraph(item, index)
    if (inGraph === item.inGraph) return item
    changed = true
    return { ...item, inGraph }
  })
  return changed ? next : items
}
