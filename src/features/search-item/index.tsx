import { differenceInDays, isToday } from 'date-fns'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'

import { ResultCard } from '../../components/ResultCard'
import { useSearchItems } from '../../hooks/use-items'
import { ZotData } from '../../interfaces'
import { insertZotIntoGraph } from '../../services/insert-zot-into-graph'

export interface FormValues {
  search: string
}

type Bucket = 'Today' | 'Last 7 days' | 'Last 30 days' | 'Earlier'

const BUCKET_ORDER: Bucket[] = [
  'Today',
  'Last 7 days',
  'Last 30 days',
  'Earlier',
]

const bucketOf = (dateAdded: string): Bucket => {
  const d = new Date(dateAdded)
  if (isToday(d)) return 'Today'
  const diff = differenceInDays(new Date(), d)
  if (diff <= 7) return 'Last 7 days'
  if (diff <= 30) return 'Last 30 days'
  return 'Earlier'
}

const groupByBucket = (items: ZotData[]): Map<Bucket, ZotData[]> => {
  const map = new Map<Bucket, ZotData[]>()
  for (const item of items) {
    const b = bucketOf(item.dateAdded)
    const arr = map.get(b) ?? []
    arr.push(item)
    map.set(b, arr)
  }
  return map
}

export const SearchItem = ({
  rect: { x, y },
  uuid,
  openedAt,
}: {
  rect: { x: number; y: number }
  uuid: string
  openedAt?: number
}) => {
  const { register, watch, reset } = useForm<FormValues>({
    defaultValues: {
      search: '',
    },
  })
  const queryString = watch('search')

  const { results, mode, isLoadingInitial, isLoadingFallback, error } =
    useSearchItems(queryString, openedAt)

  const grouped = useMemo(
    () => (mode === 'recents' ? groupByBucket(results) : null),
    [mode, results],
  )

  const [importing, setImporting] = useState<ZotData | null>(null)

  // This UI reconciles across slash invocations (it isn't keyed — see the
  // openedAt refresh in use-items.ts), so clear a leftover import spinner
  // whenever the popup is reopened.
  useEffect(() => {
    setImporting(null)
  }, [openedAt])

  const handlePick = useCallback(
    async (item: ZotData) => {
      // Show the inline spinner, build the page off-screen, then drop the
      // overlay to reveal the finished page (handleZotInDb already navigated).
      setImporting(item)
      const pageName = await insertZotIntoGraph(item)
      logseq.hideMainUI()
      if (pageName) await logseq.Editor.updateBlock(uuid, `[[${pageName}]]`)
      reset()
      setImporting(null)
    },
    [uuid, reset],
  )

  const renderStatus = () => {
    if (isLoadingInitial) return 'Loading library…'
    if (error) return 'Connection error'
    if (mode === 'recents') return `${results.length} recent`
    if (results.length === 0)
      return isLoadingFallback ? 'Searching library…' : 'No matches'
    return isLoadingFallback
      ? `${results.length} results · searching…`
      : `${results.length} results`
  }

  if (importing) {
    return (
      <div className="search-container" style={{ left: x, top: y }}>
        <div className="search-importing">
          <span className="spinner" />
          <div className="search-importing-text">
            <span>
              Importing <strong>{importing.title}</strong>…
            </span>
            <span className="search-importing-sub">
              Writing properties, attachments and abstract
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="search-container" style={{ left: x, top: y }}>
      <div className="search-input-wrapper">
        <input
          id="search-field"
          {...register('search')}
          type="text"
          placeholder="Search your library, or browse recently added"
          className="search-input"
          autoFocus
        />
        <span className="search-result-count">{renderStatus()}</span>
      </div>
      <div className="results-list">
        {mode === 'recents' && grouped
          ? BUCKET_ORDER.map((bucket) => {
              const items = grouped.get(bucket)
              if (!items || items.length === 0) return null
              return (
                <div key={bucket} className="time-group">
                  <div className="time-group-header">{bucket}</div>
                  {items.map((item) => (
                    <ResultCard
                      key={item.key}
                      item={item}
                      query=""
                      onPick={handlePick}
                    />
                  ))}
                </div>
              )
            })
          : results.map((item) => (
              <ResultCard
                key={item.key}
                item={item}
                query={queryString}
                onPick={handlePick}
              />
            ))}
      </div>
    </div>
  )
}
