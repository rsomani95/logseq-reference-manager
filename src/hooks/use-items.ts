import { useEffect, useRef, useState } from 'react'

import { DEBOUNCE_DELAY } from '../constants'
import { ZotData } from '../interfaces'
import { getZotParents } from '../services/get-zot-items'
import { refreshInGraphFlags } from '../services/zotero-code-index'

export type SearchMode = 'recents' | 'search'

/**
 * Backs the search popup and the batch view's "Search" source.
 *
 * - `query === ''` → "recents": fetch the top-N parents by dateAdded once on
 *   mount, cache them. Re-resolve the `inGraph` flags every time the popup
 *   reopens (`openedAt` changes) — the plugin gets no signal when the user
 *   renames / imports / removes pages, so a cached snapshot drifts.
 * - `query !== ''` → "search": after a tight debounce, hit Zotero's
 *   `/items/top?q=...&qmode=everything` directly. Their SQLite index covers
 *   title, creator, year *and* abstract, and runs in single-digit ms on
 *   localhost — no client-side fuzzy pass needed. Stale responses are dropped.
 *
 * Callers should pass the *deferred* query (`useDeferredValue`) so the network
 * round-trip never blocks the typed character from painting.
 */
export const useSearchItems = (query: string, openedAt?: number) => {
  const recentsRef = useRef<ZotData[]>([])
  const [recents, setRecents] = useState<ZotData[]>([])
  const [searchResults, setSearchResults] = useState<ZotData[]>([])
  const [isLoadingInitial, setIsLoadingInitial] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoadingInitial(true)
    getZotParents()
      .then((result) => {
        if (cancelled) return
        recentsRef.current = result
        setRecents(result)
        setIsLoadingInitial(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setIsLoadingInitial(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const snapshot = recentsRef.current
    if (snapshot.length === 0) return
    let cancelled = false
    refreshInGraphFlags(snapshot).then((refreshed) => {
      if (cancelled || refreshed === snapshot) return
      if (recentsRef.current !== snapshot) return
      recentsRef.current = refreshed
      setRecents(refreshed)
    })
    return () => {
      cancelled = true
    }
  }, [openedAt])

  useEffect(() => {
    if (!query) {
      setSearchResults([])
      setIsSearching(false)
      return
    }
    let cancelled = false
    setIsSearching(true)
    const handle = setTimeout(() => {
      getZotParents(query)
        .then((results) => {
          if (cancelled) return
          setSearchResults(results)
          setIsSearching(false)
        })
        .catch(() => {
          if (!cancelled) setIsSearching(false)
        })
    }, DEBOUNCE_DELAY)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  const mode: SearchMode = query ? 'search' : 'recents'
  const results = mode === 'recents' ? recents : searchResults

  return {
    results,
    mode,
    isLoadingInitial,
    isLoadingFallback: isSearching,
    error,
  }
}
