import wretch from 'wretch'
import QueryAddon from 'wretch/addons/queryString'
import { WretchError } from 'wretch/resolver'

import { BASE_QUERY, BATCH_FETCH_LIMIT, PLUGIN_ID, ZOT_URL } from '../constants'
import {
  AttachmentItem,
  NoteItem,
  ZotCollection,
  ZotData,
  ZotItem,
  ZotSavedSearch,
} from '../interfaces'
import { MapItemsOptions, mapItems } from './map-items'
import type { ZoteroAnnotationData } from './pdf-annot/zotero'

const api = wretch().url(ZOT_URL).headers({
  'Content-Type': 'application/json',
  'x-zotero-connector-api-version': '3.0',
  'zotero-allowed-request': 'true',
})

/**
 * Probes the Zotero local API. A pure status check — it returns the result
 * rather than toasting, because every caller surfaces it in context: the setup
 * hub's Connection section shows it inline, and the load-time probe feeds the
 * settings status line. The import paths don't use this (they carry their own
 * error toasts), so a connection failure is never announced twice — and a test
 * run from the settings panel stays silent.
 */
export const testZotConnection = async (): Promise<{
  code: 'success' | 'error'
  msg: string
}> => {
  try {
    await api.url('/items').addon(QueryAddon).query({ limit: 1 }).get().res()
    return { code: 'success', msg: '✅ Connection to Zotero is working' }
  } catch (error) {
    // A missing status (vs. an HTTP error code) means Zotero isn't running.
    const wretchError = error as WretchError
    return {
      code: 'error',
      msg: `❌ ${PLUGIN_ID}: Connection error
Status: ${wretchError.status}
Response: ${wretchError.message}`,
    }
  }
}

/**
 * Fetches parent items only — no notes / attachments / annotations.
 *
 * The search-results list never displays children, so pulling them eagerly was
 * pure waste; the old "fetch every child in the library on every keystroke"
 * pattern dominated query latency. Children are now fetched per item at insert
 * time via `getChildrenForItem`.
 *
 * `qmode: 'everything'` delegates ranking to Zotero's own SQLite full-text
 * index — which already covers title, creator, year *and* abstract text, and
 * runs in single-digit ms on localhost. Replaces the previous local Fuse pass.
 *
 * Errors that aren't a hard connection failure (HTTP errors) are swallowed
 * with a toast and an empty list returned — the caller is a hot input path
 * and shouldn't have to handle exceptions on every keystroke.
 *
 * On success, `mapItems(parents, [])` resolves `inGraph`, `citeKey` and
 * `libraryLink`; `attachments` / `notes` come back as empty arrays.
 */
export const getZotParents = async (
  queryString?: string,
): Promise<ZotData[]> => {
  const startTime = performance.now()

  try {
    const searchQuery = queryString
      ? { ...BASE_QUERY, q: queryString, qmode: 'everything' }
      : BASE_QUERY

    const parents = await api
      .url('/items/top')
      .addon(QueryAddon)
      .query(searchQuery)
      .get()
      .json<ZotItem[]>()

    const zotDataArr = await mapItems(parents, [])

    const endTime = performance.now()
    console.log(
      `${PLUGIN_ID}: getZotParents(${queryString ? `q=${queryString}` : 'recents'}) ${(endTime - startTime).toFixed(2)}ms · ${zotDataArr.length} results`,
    )

    return zotDataArr
  } catch (error) {
    if (error instanceof WretchError) {
      logseq.UI.showMsg(
        `❌ Connection error: ${error.message}
Status: ${error.status}
Response: ${await error.response.text()}`,
        'error',
      )
    } else {
      logseq.UI.showMsg(
        `❌ An unexpected error occurred: ${(error as Error).message}. Check if Zotero is running.`,
        'error',
      )
    }
    return []
  }
}

/**
 * Fetches a small batch of recent parent items for UI previews (the Import
 * formats sample). Silent on failure — returns `[]` rather than toasting,
 * because the preview falls back to a built-in sample and the setup hub already
 * surfaces connection problems in the Connect section.
 */
export const getSampleParents = async (limit = 25): Promise<ZotData[]> => {
  try {
    const parents = await api
      .url('/items/top')
      .addon(QueryAddon)
      .query({ ...BASE_QUERY, limit })
      .get()
      .json<ZotItem[]>()
    return await mapItems(parents, [])
  } catch {
    return []
  }
}

/**
 * Fetches notes + attachments for a single Zotero parent item. Called by the
 * insert paths right before `handleZotInDb`, so the list paths can stay
 * parents-only. Annotations are no longer pulled here — the annotation import
 * orchestrator reads them straight from the PDF file (or, on fallback, from
 * Zotero via `getRawAnnotationsForAttachment`).
 */
export const getChildrenForItem = async (
  itemKey: string,
): Promise<{ attachments: AttachmentItem[]; notes: NoteItem[] }> => {
  const directChildren = await api
    .url(`/items/${itemKey}/children`)
    .addon(QueryAddon)
    .query({ itemType: 'note||attachment' })
    .get()
    .json<ZotItem[]>()

  const notes: NoteItem[] = []
  const attachments: AttachmentItem[] = []

  for (const child of directChildren) {
    if (child.data.itemType === 'note' && child.data.note) {
      notes.push({ note: child.data.note })
    } else if (child.data.itemType === 'attachment') {
      if (child.data.linkMode === 'imported_file' && child.links.enclosure) {
        attachments.push({
          linkMode: 'imported_file',
          key: child.data.key,
          ...child.links.enclosure,
        })
      } else if (
        child.data.linkMode === 'imported_url' &&
        child.links.enclosure
      ) {
        // Saved web-page snapshot — stored like an imported_file and reached
        // through the same enclosure URL.
        attachments.push({
          linkMode: 'imported_url',
          key: child.data.key,
          ...child.links.enclosure,
        })
      } else if (child.data.linkMode === 'linked_url' && child.data.url) {
        attachments.push({
          linkMode: 'linked_url',
          key: child.data.key,
          title: child.data.title,
          url: child.data.url,
        })
      } else if (child.data.linkMode === 'linked_file' && child.data.path) {
        attachments.push({
          linkMode: 'linked_file',
          key: child.data.key,
          title: child.data.title,
          path: child.data.path,
          contentType: child.data.contentType ?? '',
        })
      }
    }
  }

  return { attachments, notes }
}

/**
 * Fetches a single attachment's Zotero-native annotations as the pdf-annot
 * Zotero converter consumes them — the full annotation `data` plus the library
 * id (which the converter folds into each annotation's stable block uuid). Used
 * only on the orchestrator's Zotero fallback, i.e. when the PDF file itself
 * carries no embedded markup. Annotations missing a type or position are
 * dropped (the converter can't place them).
 */
export const getRawAnnotationsForAttachment = async (
  attachmentKey: string,
): Promise<{ annotations: ZoteroAnnotationData[]; libraryID: number }> => {
  const items = await api
    .url(`/items/${attachmentKey}/children`)
    .addon(QueryAddon)
    .query({ itemType: 'annotation' })
    .get()
    .json<ZotItem[]>()

  const libraryID = items[0]?.library?.id ?? 0
  const annotations: ZoteroAnnotationData[] = []
  for (const item of items) {
    const d = item.data
    if (!d.annotationType || !d.annotationPosition) continue
    annotations.push({
      key: d.key,
      annotationType: d.annotationType,
      annotationPosition: d.annotationPosition,
      annotationText: d.annotationText,
      annotationComment: d.annotationComment,
      annotationColor: d.annotationColor,
      annotationPageLabel: d.annotationPageLabel,
      annotationSortIndex: d.annotationSortIndex,
      annotationAuthorName: d.annotationAuthorName,
    })
  }
  return { annotations, libraryID }
}

// ─── Batch import sources ───────────────────────────────────────────────────

// Note/attachment/annotation are Zotero's child item types. Container routes
// (`/collections/{key}/items`, `/searches/{key}/items`) return parents and
// children mixed, so this set is used to partition the response for `mapItems`.
const CHILD_ITEM_TYPES = new Set(['note', 'attachment', 'annotation'])

interface RawZotCollection {
  key: string
  meta: { numCollections: number; numItems: number }
  data: { key: string; name: string; parentCollection: string | false }
}

interface RawZotSavedSearch {
  key: string
  data: { key: string; name: string }
}

/**
 * Lists every collection in the Zotero library. Returned flat — nested
 * collections sit alongside their parents and carry a `parentCollection` key.
 */
export const getZotCollections = async (): Promise<ZotCollection[]> => {
  try {
    const raw = await api
      .url('/collections')
      .addon(QueryAddon)
      .query({ limit: BATCH_FETCH_LIMIT })
      .get()
      .json<RawZotCollection[]>()
    return raw
      .map((c) => ({
        key: c.key,
        name: c.data.name,
        numItems: c.meta.numItems,
        parentCollection: c.data.parentCollection,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    logseq.UI.showMsg(
      `❌ Could not load Zotero collections: ${(error as Error).message}`,
      'error',
    )
    return []
  }
}

/** Lists every saved search in the Zotero library. */
export const getZotSavedSearches = async (): Promise<ZotSavedSearch[]> => {
  try {
    const raw = await api.url('/searches').get().json<RawZotSavedSearch[]>()
    return raw
      .map((s) => ({ key: s.key, name: s.data.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    logseq.UI.showMsg(
      `❌ Could not load Zotero saved searches: ${(error as Error).message}`,
      'error',
    )
    return []
  }
}

/**
 * Fetches the parents of every importable item in a collection. Children
 * (notes / attachments / annotations) are fetched per item at insert time —
 * the batch list never displays them.
 */
export const getItemsForCollection = async (
  collectionKey: string,
  options?: MapItemsOptions,
): Promise<ZotData[]> => {
  try {
    const parents = await api
      .url(`/collections/${collectionKey}/items/top`)
      .addon(QueryAddon)
      .query({ ...BASE_QUERY, limit: BATCH_FETCH_LIMIT })
      .get()
      .json<ZotItem[]>()
    return await mapItems(parents, [], options)
  } catch (error) {
    logseq.UI.showMsg(
      `❌ Could not load collection items: ${(error as Error).message}`,
      'error',
    )
    return []
  }
}

/**
 * Fetches the parents of every importable item matching a saved search. The
 * local API has no `/searches/{key}/items/top` route, so the single `/items`
 * response is partitioned by item type and children dropped. Children are
 * fetched per item at insert time.
 */
export const getItemsForSavedSearch = async (
  searchKey: string,
  options?: MapItemsOptions,
): Promise<ZotData[]> => {
  try {
    const all = await api
      .url(`/searches/${searchKey}/items`)
      .addon(QueryAddon)
      .query({ limit: BATCH_FETCH_LIMIT })
      .get()
      .json<ZotItem[]>()
    const parents = all.filter((i) => !CHILD_ITEM_TYPES.has(i.data.itemType))
    return await mapItems(parents, [], options)
  } catch (error) {
    logseq.UI.showMsg(
      `❌ Could not load saved search items: ${(error as Error).message}`,
      'error',
    )
    return []
  }
}
