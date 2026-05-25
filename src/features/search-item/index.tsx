import { differenceInDays, isToday } from 'date-fns'
import {
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { ResultCard } from '../../components/ResultCard'
import { useSearchItems } from '../../hooks/use-items'
import { ZotData } from '../../interfaces'
import { listNavIntent } from '../../keyboard'
import { insertZotIntoGraph } from '../../services/insert-zot-into-graph'

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
  const [query, setQuery] = useState('')
  // Input commits the new character at urgent priority; everything downstream
  // (the server fetch, fuse-free re-render of the result list, card highlight
  // re-render) reads the deferred value and runs at low priority. So a fast
  // typist never sees the typed character held back by render work.
  const deferredQuery = useDeferredValue(query)
  const inputRef = useRef<HTMLInputElement>(null)

  const { results, mode, isLoadingInitial, isLoadingFallback, error } =
    useSearchItems(deferredQuery, openedAt)

  const grouped = useMemo(
    () => (mode === 'recents' ? groupByBucket(results) : null),
    [mode, results],
  )

  const flatResults = useMemo<ZotData[]>(
    () =>
      mode === 'recents' && grouped
        ? BUCKET_ORDER.flatMap((b) => grouped.get(b) ?? [])
        : results,
    [mode, grouped, results],
  )

  const [importing, setImporting] = useState<ZotData | null>(null)
  // Default to top hit so 'type, Enter' picks the first result.
  const [activeIndex, setActiveIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const firstRenderRef = useRef(true)

  // First mount needs nothing — autoFocus and the CSS keyframe handle entry.
  // Each *reopen* clears a leftover spinner, restarts the entry animation
  // (CSS alone fires it only once), and refocuses the input.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }
    setImporting(null)
    const el = containerRef.current
    if (el) {
      el.style.animation = 'none'
      void el.offsetHeight
      el.style.animation = ''
    }
    inputRef.current?.focus()
  }, [openedAt])

  useEffect(() => {
    setActiveIndex(0)
  }, [flatResults, openedAt])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const { left, top } = clampToViewport(x, y, width, height)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [x, y, flatResults.length, importing, openedAt])

  const handlePick = useCallback(
    async (item: ZotData) => {
      // Build the page off-screen, write the back-link into the source block
      // *while* the journal page is still the active route (so Logseq
      // re-renders it reactively), THEN navigate. Doing updateBlock after
      // pushState writes to an offscreen page — DB updates, but the frontend
      // keeps a stale render of the journal block until manual reload.
      setImporting(item)
      const pageName = await insertZotIntoGraph(item, { navigate: false })
      if (pageName) {
        await logseq.Editor.updateBlock(uuid, `[[${pageName}]]`)
        logseq.App.pushState('page', { name: pageName.toLowerCase() })
      }
      logseq.hideMainUI()
      setQuery('')
      setImporting(null)
    },
    [uuid],
  )

  const scrollOptionIntoView = (index: number) => {
    const item = flatResults[index]
    if (!item) return
    document
      .getElementById(optionId(item.key))
      ?.scrollIntoView({ block: 'nearest' })
  }

  // aria-activedescendant combobox: input keeps focus, highlight moves.
  // ArrowUp/Down and the emacs Ctrl-P/Ctrl-N both drive the highlight.
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (flatResults.length === 0) return
    const nav = listNavIntent(e)
    if (nav === 'down') {
      e.preventDefault()
      const next = Math.min(activeIndex + 1, flatResults.length - 1)
      setActiveIndex(next)
      scrollOptionIntoView(next)
    } else if (nav === 'up') {
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

  const activeKey = flatResults[activeIndex]?.key
  const activeId = activeKey ? optionId(activeKey) : undefined

  // Stale when typing has run ahead of the deferred query, or while the server
  // fetch is in flight. The list dims after a 120ms CSS delay so fast-path
  // cycles (typical localhost search) never flash a dim — only slower cycles
  // cross the threshold and get the ACK.
  const isStale = query !== deferredQuery || isLoadingFallback

  return (
    <div
      className="search-container"
      ref={containerRef}
      style={{ left: x, top: y }}
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
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
          <div
            className={`results-list${isStale ? ' is-stale' : ''}`}
            id="zot-results"
            role="listbox"
          >
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
                          id={optionId(item.key)}
                          isActive={item.key === activeKey}
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
                    query={deferredQuery}
                    id={optionId(item.key)}
                    isActive={item.key === activeKey}
                    onPick={handlePick}
                  />
                ))}
          </div>
        </>
      )}
    </div>
  )
}
