import wretch from 'wretch'
import QueryAddon from 'wretch/addons/queryString'
import { WretchError } from 'wretch/resolver'

import { BASE_QUERY, BATCH_FETCH_LIMIT, PLUGIN_ID, ZOT_URL } from '../constants'
import {
  AnnotationItem,
  AttachmentItem,
  NoteItem,
  ZotCollection,
  ZotData,
  ZotItem,
  ZotSavedSearch,
} from '../interfaces'
import { MapItemsOptions, mapItems } from './map-items'

const api = wretch().url(ZOT_URL).headers({
  'Content-Type': 'application/json',
  'x-zotero-connector-api-version': '3.0',
  'zotero-allowed-request': 'true',
})

export const testZotConnection = async (): Promise<{
  code: 'success' | 'error'
  msg: string
}> => {
  try {
    await api.url('/items').addon(QueryAddon).query({ limit: 1 }).get().res()
    return { code: 'success', msg: '✅ Connection to Zotero is working' }
  } catch (error) {
    // If error.status is undefined, it means Zotero is not open

    const wretchError = error as WretchError
    logseq.UI.showMsg(
      `❌ ${PLUGIN_ID}: Connection error
Status: ${wretchError.status}
Response: ${wretchError.message}`,
      'error',
    )
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
 * Fetches notes + attachments (with their annotation grandchildren) for a
 * single Zotero parent item. Called by the insert paths right before
 * `handleZotInDb`, so the list paths can stay parents-only.
 *
 * `/items/{key}/children` returns direct children only — annotations are
 * grandchildren of the parent (parent → attachment → annotation) and need
 * their own fetch per attachment. The attachment fan-out is parallelized.
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
          annotations: [],
          ...child.links.enclosure,
        })
      } else if (child.data.linkMode === 'linked_url' && child.data.url) {
        attachments.push({
          linkMode: 'linked_url',
          key: child.data.key,
          annotations: [],
          title: child.data.title,
          url: child.data.url,
        })
      }
    }
  }

  await Promise.all(
    attachments.map(async (att) => {
      const annots = await api
        .url(`/items/${att.key}/children`)
        .addon(QueryAddon)
        .query({ itemType: 'annotation' })
        .get()
        .json<ZotItem[]>()
      att.annotations = annots
        .filter((a) => a.data.annotationText)
        .map((a) => ({
          annotationText: a.data.annotationText ?? '',
          annotationComment: a.data.annotationComment ?? '',
          annotationSortIndex: a.data.annotationSortIndex ?? '',
        }))
    }),
  )

  return { attachments, notes }
}

/**
 * Pure filter: keep annotations strictly added after `since`, drop empties.
 * If `since` is omitted, every annotation passes — callers (syncAnnotations)
 * are responsible for guarding against that case to avoid duplicates.
 */
export const filterAnnotationsSince = (
  annotations: ZotItem[],
  since?: string,
): AnnotationItem[] => {
  const sinceMs = since ? new Date(since).getTime() : undefined
  return annotations
    .filter((a) => {
      if (sinceMs === undefined) return true
      return new Date(a.data.dateAdded).getTime() > sinceMs
    })
    .filter((a) => a.data.annotationText)
    .map((a) => ({
      annotationText: a.data.annotationText ?? '',
      annotationComment: a.data.annotationComment ?? '',
      annotationSortIndex: a.data.annotationSortIndex ?? '',
    }))
}

/**
 * Fetches annotations for a given parent item key that were added after the specified date.
 * Annotations in Zotero are grandchildren: parent item -> attachment -> annotation.
 * Returns a map of attachment key -> annotations.
 */
export const getAnnotationsByItemKey = async (
  itemKey: string,
  since?: string,
): Promise<Map<string, AnnotationItem[]>> => {
  // Get attachment children of the parent item
  const attachments: ZotItem[] = await api
    .url(`/items/${itemKey}/children`)
    .addon(QueryAddon)
    .query({ itemType: 'attachment' })
    .get()
    .json()

  // For each attachment, get its annotation children
  const annotationMap = new Map<string, AnnotationItem[]>()

  for (const attachment of attachments) {
    const annotations: ZotItem[] = await api
      .url(`/items/${attachment.data.key}/children`)
      .addon(QueryAddon)
      .query({ itemType: 'annotation' })
      .get()
      .json()

    const filtered = filterAnnotationsSince(annotations, since)

    if (filtered.length > 0) {
      annotationMap.set(attachment.data.key, filtered)
    }
  }

  return annotationMap
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
