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
 */
export const useContainerItems = (
  source: BatchSource,
  collectionKey: string,
  savedSearchKey: string,
) => {
  const [items, setItems] = useState<ZotData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    let fetcher: (() => Promise<ZotData[]>) | null = null
    if (source === 'collection' && collectionKey) {
      fetcher = () => getItemsForCollection(collectionKey)
    } else if (source === 'savedSearch' && savedSearchKey) {
      fetcher = () => getItemsForSavedSearch(savedSearchKey)
    }

    if (!fetcher) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    fetcher()
      .then((result) => {
        if (cancelled) return
        setItems(result)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err as Error)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [source, collectionKey, savedSearchKey])

  return { items, loading, error }
}
