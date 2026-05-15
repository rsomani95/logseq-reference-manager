import { differenceInDays, isToday } from 'date-fns'
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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

// Stable per-row id, shared by the option element and the input's
// aria-activedescendant so the combobox keyboard wiring lines up.
const optionId = (key: string): string => `zot-opt-${key}`

// The popup is anchored to the editing cursor, which can sit anywhere —
// including hard against a viewport edge. Clamp the raw x/y against the
// measured popup box, flipping above the cursor when it would overflow the
// bottom, so the popup is never partly off-screen.
const VIEWPORT_MARGIN = 8

const clampToViewport = (
  x: number,
  y: number,
  width: number,
  height: number,
): { left: number; top: number } => {
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN),
  )
  let top = y
  if (y + height > window.innerHeight - VIEWPORT_MARGIN) {
    top =
      y - height >= VIEWPORT_MARGIN
        ? y - height
        : window.innerHeight - height - VIEWPORT_MARGIN
  }
  return { left, top: Math.max(VIEWPORT_MARGIN, top) }
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
  const { register, watch, reset, setFocus } = useForm<FormValues>({
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

  // The list in render order — recents flatten their buckets, search is
  // already flat. Drives keyboard nav and the row → index lookup.
  const flatResults = useMemo<ZotData[]>(
    () =>
      mode === 'recents' && grouped
        ? BUCKET_ORDER.flatMap((b) => grouped.get(b) ?? [])
        : results,
    [mode, grouped, results],
  )
  const indexOfKey = useMemo(
    () => new Map(flatResults.map((it, i) => [it.key, i])),
    [flatResults],
  )

  const [importing, setImporting] = useState<ZotData | null>(null)
  // The keyboard-highlighted row. Defaults to the top hit so "type, Enter"
  // lands on the first result without an extra arrow press.
  const [activeIndex, setActiveIndex] = useState(0)
  const [pos, setPos] = useState({ left: x, top: y })

  const containerRef = useRef<HTMLDivElement>(null)
  const firstRenderRef = useRef(true)

  // This UI reconciles across slash invocations (it isn't keyed — see the
  // openedAt refresh in use-items.ts). First mount needs nothing (autoFocus
  // and the CSS animation handle it); every *reopen* clears a leftover
  // import spinner, restarts the whisper-fast entry animation (the CSS
  // animation alone would only fire once), and refocuses the input.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }
    setImporting(null)
    const el = containerRef.current
    if (el) {
      el.style.animation = 'none'
      void el.offsetHeight // reflow so the animation can replay
      el.style.animation = ''
    }
    setFocus('search')
  }, [openedAt, setFocus])

  // Keep the highlight in range as the result set changes (new query, cache
  // update) or the popup reopens — always re-pin to the top row.
  useEffect(() => {
    setActiveIndex(0)
  }, [flatResults, openedAt])

  // Clamp the cursor-anchored position once the popup has a measured size;
  // re-run whenever the height could have changed (results arrive, the
  // import morph swaps the body, a reopen at a new cursor point).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const next = clampToViewport(x, y, width, height)
    setPos((prev) =>
      prev.left === next.left && prev.top === next.top ? prev : next,
    )
  }, [x, y, flatResults.length, importing, openedAt])

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

  const scrollOptionIntoView = (index: number) => {
    const item = flatResults[index]
    if (!item) return
    document
      .getElementById(optionId(item.key))
      ?.scrollIntoView({ block: 'nearest' })
  }

  // Arrow keys move the highlight, Enter picks it. Focus never leaves the
  // input, so typing always works mid-navigation (aria-activedescendant
  // combobox pattern).
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (flatResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(activeIndex + 1, flatResults.length - 1)
      setActiveIndex(next)
      scrollOptionIntoView(next)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.max(activeIndex - 1, 0)
      setActiveIndex(next)
      scrollOptionIntoView(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatResults[activeIndex]
      if (item) handlePick(item)
    }
  }

  const renderStatus = () => {
    if (isLoadingInitial) return 'Loading library…'
    if (error) return 'Can’t reach Zotero'
    if (mode === 'recents') return `${results.length} recent`
    if (results.length === 0)
      return isLoadingFallback ? 'Searching library…' : 'No matches'
    return isLoadingFallback
      ? `${results.length} results · searching…`
      : `${results.length} results`
  }

  const activeItem = flatResults[activeIndex]
  const activeId = activeItem ? optionId(activeItem.key) : undefined

  return (
    <div
      className="search-container"
      ref={containerRef}
      style={{ left: pos.left, top: pos.top }}
    >
      {importing ? (
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
      ) : (
        <>
          <div className="search-input-wrapper">
            <input
              id="search-field"
              {...register('search')}
              type="text"
              placeholder="Search your library, or browse recently added"
              className="search-input"
              autoFocus
              role="combobox"
              aria-label="Search your Zotero library"
              aria-autocomplete="list"
              aria-expanded={true}
              aria-controls="zot-results"
              aria-activedescendant={activeId}
              onKeyDown={handleKeyDown}
            />
            <span className="search-result-count">{renderStatus()}</span>
          </div>
          <div className="results-list" id="zot-results" role="listbox">
            {mode === 'recents' && grouped
              ? BUCKET_ORDER.map((bucket) => {
                  const items = grouped.get(bucket)
                  if (!items || items.length === 0) return null
                  return (
                    <div
                      key={bucket}
                      className="time-group"
                      role="group"
                      aria-label={bucket}
                    >
                      <div className="time-group-header">{bucket}</div>
                      {items.map((item) => (
                        <ResultCard
                          key={item.key}
                          item={item}
                          query=""
                          isActive={indexOfKey.get(item.key) === activeIndex}
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
                    isActive={indexOfKey.get(item.key) === activeIndex}
                    onPick={handlePick}
                  />
                ))}
          </div>
        </>
      )}
    </div>
  )
}
