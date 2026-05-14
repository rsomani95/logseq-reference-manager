import { useEffect, useState } from 'react'

import {
  BatchSource,
  ZotCollection,
  ZotData,
  ZotSavedSearch,
} from '../interfaces'
import {
  getItemsForCollection,
  getItemsForSavedSearch,
  getZotCollections,
  getZotSavedSearches,
} from '../services/get-zot-items'
import { MapItemsOptions } from '../services/map-items'

/**
 * Loads the lists of collections and saved searches once, on mount. These
 * populate the source pickers in the batch-import view.
 */
export const useBatchSources = () => {
  const [collections, setCollections] = useState<ZotCollection[]>([])
  const [savedSearches, setSavedSearches] = useState<ZotSavedSearch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([getZotCollections(), getZotSavedSearches()])
      .then(([cols, searches]) => {
        if (cancelled) return
        setCollections(cols)
        setSavedSearches(searches)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { collections, savedSearches, loading }
}

/**
 * Fetches the items for the currently-selected container — a collection or a
 * saved search. Returns an empty list when the search source is active or
 * nothing is picked yet; the search source has its own hook (`useSearchItems`).
 *
 * Items stream in: `mapItems` resolves the in-graph badge in chunks and calls
 * `onChunk` with everything mapped so far, so a large container's list paints
 * almost immediately. `loading` covers the wait for the first chunk (the
 * network round-trip); `loadingMore` stays true while the rest streams in.
 */
export const useContainerItems = (
  source: BatchSource,
  collectionKey: string,
  savedSearchKey: string,
) => {
  const [items, setItems] = useState<ZotData[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    let fetcher: ((options: MapItemsOptions) => Promise<ZotData[]>) | null =
      null
    if (source === 'collection' && collectionKey) {
      fetcher = (options) => getItemsForCollection(collectionKey, options)
    } else if (source === 'savedSearch' && savedSearchKey) {
      fetcher = (options) => getItemsForSavedSearch(savedSearchKey, options)
    }

    if (!fetcher) {
      setItems([])
      setLoading(false)
      setLoadingMore(false)
      setError(null)
      return
    }

    setItems([])
    setLoading(true)
    setLoadingMore(false)
    setError(null)

    fetcher({
      isCancelled: () => cancelled,
      onChunk: (chunk) => {
        if (cancelled) return
        setItems(chunk)
        // First chunk is in — drop the full-list spinner, but keep signalling
        // that more may still be on the way.
        setLoading(false)
        setLoadingMore(true)
      },
    })
      .then((all) => {
        if (cancelled) return
        setItems(all)
        setLoading(false)
        setLoadingMore(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err as Error)
        setLoading(false)
        setLoadingMore(false)
      })

    return () => {
      cancelled = true
    }
  }, [source, collectionKey, savedSearchKey])

  return { items, loading, loadingMore, error }
}
