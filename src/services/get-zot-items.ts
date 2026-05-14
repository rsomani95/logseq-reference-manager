import wretch from 'wretch'
import QueryAddon from 'wretch/addons/queryString'
import { WretchError } from 'wretch/resolver'

import { BASE_QUERY, BATCH_FETCH_LIMIT, ZOT_URL } from '../constants'
import {
  AnnotationItem,
  ZotCollection,
  ZotData,
  ZotItem,
  ZotSavedSearch,
} from '../interfaces'
import { mapItems } from './map-items'

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
      `❌ logseq-zoteroloca-plugin: Connection error
Status: ${wretchError.status}
Response: ${wretchError.message}`,
      'error',
    )
    return {
      code: 'error',
      msg: `❌ logseq-zoteroloca-plugin: Connection error
Status: ${wretchError.status}
Response: ${wretchError.message}`,
    }
  }
}

const getZotItems = async (queryString?: string) => {
  const startTime = performance.now()

  try {
    const searchQuery = queryString
      ? {
          ...BASE_QUERY,
          q: queryString,
          qmode: 'titleCreatorYear',
        }
      : BASE_QUERY

    const [zotParentResultsFromSearch, notesAndAttachments] = await Promise.all(
      [
        api
          .url('/items/top')
          .addon(QueryAddon)
          .query(searchQuery)
          .get()
          .json<ZotItem[]>(),
        api
          .url('/items')
          .addon(QueryAddon)
          .query({
            itemType: 'note||attachment||annotation',
          })
          .get()
          .json<ZotItem[]>(),
      ],
    )

    const zotDataArr = await mapItems(
      zotParentResultsFromSearch,
      notesAndAttachments,
    )

    const endTime = performance.now()
    console.log(
      'logseq-zoterolocal-plugin: Time taken for query: ',
      (endTime - startTime).toFixed(2),
      'ms',
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

export const getZotItemsFromQueryString = (queryString: string) =>
  getZotItems(queryString)

export const getZotItemsWithoutQueryString = () => getZotItems()

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
 * Fetches every importable item in a collection. Two calls: the collection's
 * top-level items (the parents) and its note/attachment/annotation children,
 * both scoped to the collection — no whole-library children slurp. The result
 * runs through the same `mapItems` join used by the search flow.
 */
export const getItemsForCollection = async (
  collectionKey: string,
): Promise<ZotData[]> => {
  try {
    const [parents, children] = await Promise.all([
      api
        .url(`/collections/${collectionKey}/items/top`)
        .addon(QueryAddon)
        .query({ ...BASE_QUERY, limit: BATCH_FETCH_LIMIT })
        .get()
        .json<ZotItem[]>(),
      api
        .url(`/collections/${collectionKey}/items`)
        .addon(QueryAddon)
        .query({
          itemType: 'note||attachment||annotation',
          limit: BATCH_FETCH_LIMIT,
        })
        .get()
        .json<ZotItem[]>(),
    ])
    return await mapItems(parents, children)
  } catch (error) {
    logseq.UI.showMsg(
      `❌ Could not load collection items: ${(error as Error).message}`,
      'error',
    )
    return []
  }
}

/**
 * Fetches every importable item matching a saved search. The local API has no
 * `/searches/{key}/items/top` route, so the single `/items` response (parents
 * and children mixed) is partitioned by item type before the `mapItems` join.
 */
export const getItemsForSavedSearch = async (
  searchKey: string,
): Promise<ZotData[]> => {
  try {
    const all = await api
      .url(`/searches/${searchKey}/items`)
      .addon(QueryAddon)
      .query({ limit: BATCH_FETCH_LIMIT })
      .get()
      .json<ZotItem[]>()
    const parents = all.filter((i) => !CHILD_ITEM_TYPES.has(i.data.itemType))
    const children = all.filter((i) => CHILD_ITEM_TYPES.has(i.data.itemType))
    return await mapItems(parents, children)
  } catch (error) {
    logseq.UI.showMsg(
      `❌ Could not load saved search items: ${(error as Error).message}`,
      'error',
    )
    return []
  }
}
