import Fuse, { IFuseOptions } from 'fuse.js'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DEBOUNCE_DELAY } from '../constants'
import { ZotData } from '../interfaces'
import {
  getZotItemsFromQueryString,
  getZotItemsWithoutQueryString,
} from '../services/get-zot-items'

export type SearchMode = 'recents' | 'search'

const MIN_SERVER_QUERY_LENGTH = 3

const FUSE_OPTIONS: IFuseOptions<ZotData> = {
  threshold: 0.35,
  ignoreLocation: true,
  keys: [
    { name: 'title', weight: 1 },
    { name: 'shortTitle', weight: 0.6 },
    {
      name: 'creators',
      weight: 0.9,
      getFn: (item) =>
        (item.creators ?? item.authors ?? [])
          .map((c) => `${c.firstName} ${c.lastName}`)
          .join(' '),
    },
    { name: 'citeKey', weight: 0.5 },
    { name: 'publicationTitle', weight: 0.4 },
    { name: 'journalAbbreviation', weight: 0.3 },
    { name: 'abstractNote', weight: 0.2 },
    { name: 'date', weight: 0.3 },
  ],
}

export const useSearchItems = (query: string) => {
  const cacheRef = useRef<ZotData[]>([])
  const [cache, setCache] = useState<ZotData[]>([])
  const [isLoadingInitial, setIsLoadingInitial] = useState(true)
  const [isLoadingFallback, setIsLoadingFallback] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoadingInitial(true)
    getZotItemsWithoutQueryString()
      .then((result) => {
        if (cancelled) return
        cacheRef.current = result
        setCache(result)
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
    if (query.length < MIN_SERVER_QUERY_LENGTH) {
      setIsLoadingFallback(false)
      return
    }
    let cancelled = false
    setIsLoadingFallback(true)
    const handle = setTimeout(() => {
      getZotItemsFromQueryString(query)
        .then((serverResults) => {
          if (cancelled) return
          const seen = new Set(cacheRef.current.map((i) => i.key))
          const additions = serverResults.filter((i) => !seen.has(i.key))
          if (additions.length > 0) {
            const merged = [...cacheRef.current, ...additions]
            cacheRef.current = merged
            setCache(merged)
          }
          setIsLoadingFallback(false)
        })
        .catch(() => {
          if (!cancelled) setIsLoadingFallback(false)
        })
    }, DEBOUNCE_DELAY)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  const fuse = useMemo(() => new Fuse<ZotData>(cache, FUSE_OPTIONS), [cache])

  const results: ZotData[] = useMemo(() => {
    if (!query) return cache
    return fuse.search(query).map((r) => r.item)
  }, [query, cache, fuse])

  const mode: SearchMode = query ? 'search' : 'recents'

  return { results, mode, isLoadingInitial, isLoadingFallback, error }
}
