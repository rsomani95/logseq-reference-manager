import { Bookmark, FolderOpen, LucideIcon, Search } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

import { useBatchSources, useContainerItems } from '../../hooks/use-batch'
import { useSearchItems } from '../../hooks/use-items'
import { BatchSource, ZotData } from '../../interfaces'
import {
  BatchProgress,
  BatchResult,
  batchInsertIntoGraph,
} from '../../services/batch-insert-into-graph'
import { ImportBar } from './ImportBar'
import { ImportSummary } from './ImportSummary'
import { SelectableResultCard } from './SelectableResultCard'
import { SourcePicker } from './SourcePicker'

export type Phase = 'select' | 'importing' | 'done'

const TABS: { id: BatchSource; label: string; icon: LucideIcon }[] = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'collection', label: 'Collection', icon: FolderOpen },
  { id: 'savedSearch', label: 'Saved search', icon: Bookmark },
]

const batchOptionId = (key: string): string => `batch-opt-${key}`

export const BatchView = () => {
  const [source, setSource] = useState<BatchSource>('search')
  const [query, setQuery] = useState('')
  const [collectionKey, setCollectionKey] = useState('')
  const [savedSearchKey, setSavedSearchKey] = useState('')
  const [selected, setSelected] = useState<Map<string, ZotData>>(new Map())
  const [phase, setPhase] = useState<Phase>('select')
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [summary, setSummary] = useState<BatchResult | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const cancelledRef = useRef(false)
  const lastIndexRef = useRef<number | null>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const {
    collections,
    savedSearches,
    loading: sourcesLoading,
  } = useBatchSources()
  const search = useSearchItems(source === 'search' ? query : '')
  const container = useContainerItems(source, collectionKey, savedSearchKey)

  const items = source === 'search' ? search.results : container.items
  const loading =
    source === 'search'
      ? search.isLoadingInitial || search.isLoadingFallback
      : container.loading
  // Streamed sources keep loading after the first chunk; search doesn't stream.
  const loadingMore = source === 'search' ? false : container.loadingMore
  const error = source === 'search' ? search.error : container.error
  const cardQuery = source === 'search' ? query : ''

  const selectableItems = useMemo(
    () => items.filter((i) => !i.inGraph),
    [items],
  )
  const inGraphCount = items.length - selectableItems.length
  const selectedVisibleCount = useMemo(
    () => selectableItems.filter((i) => selected.has(i.key)).length,
    [selectableItems, selected],
  )
  const allSelected =
    selectableItems.length > 0 &&
    selectedVisibleCount === selectableItems.length
  const someSelected = selectedVisibleCount > 0 && !allSelected
  const locked = phase !== 'select'

  // Source switches reset shift-anchor and roving cursor (their positions are
  // tied to the current list). Streaming chunks within a source must NOT —
  // they'd yank the cursor back to 0 every time a container chunk arrives.
  useEffect(() => {
    lastIndexRef.current = null
    setActiveIndex(0)
  }, [source, collectionKey, savedSearchKey])

  // `indeterminate` is a DOM property, not a React prop.
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggleItem = (item: ZotData) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(item.key)) next.delete(item.key)
      else next.set(item.key, item)
      return next
    })
  }

  const handleToggle = (index: number, shiftKey: boolean) => {
    setActiveIndex(index)
    const item = items[index]
    if (!item || item.inGraph) return

    if (shiftKey && lastIndexRef.current !== null) {
      const lo = Math.min(lastIndexRef.current, index)
      const hi = Math.max(lastIndexRef.current, index)
      const range = items.slice(lo, hi + 1).filter((i) => !i.inGraph)
      setSelected((prev) => {
        const next = new Map(prev)
        for (const i of range) next.set(i.key, i)
        return next
      })
    } else {
      toggleItem(item)
    }
    lastIndexRef.current = index
  }

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (allSelected) {
        for (const i of selectableItems) next.delete(i.key)
      } else {
        for (const i of selectableItems) next.set(i.key, i)
      }
      return next
    })
  }

  const focusCard = (index: number) => {
    const item = items[index]
    if (!item) return
    // .focus() on the option scrolls it into view — no separate call needed.
    document.getElementById(batchOptionId(item.key))?.focus()
  }

  const handleListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked || items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(activeIndex + 1, items.length - 1)
      setActiveIndex(next)
      focusCard(next)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.max(activeIndex - 1, 0)
      setActiveIndex(next)
      focusCard(next)
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      handleToggle(activeIndex, e.shiftKey)
    }
  }

  const runImport = async () => {
    const toImport = [...selected.values()]
    if (toImport.length === 0) return
    cancelledRef.current = false
    setProgress({ done: 0, total: toImport.length, currentTitle: '' })
    setPhase('importing')
    try {
      const result = await batchInsertIntoGraph(toImport, {
        onProgress: setProgress,
        isCancelled: () => cancelledRef.current,
      })
      setSummary(result)
      setPhase('done')
    } catch (e) {
      await logseq.UI.showMsg(
        e instanceof Error ? e.message : String(e),
        'error',
      )
      setPhase('select')
    }
  }

  const resetForMore = () => {
    setSelected(new Map())
    setSummary(null)
    setProgress(null)
    cancelledRef.current = false
    setPhase('select')
  }

  const renderList = () => {
    if (loading) return <div className="batch-empty">Loading…</div>
    if (error)
      return (
        <div className="batch-empty">
          Couldn’t reach Zotero. Make sure Zotero is running.
        </div>
      )
    if (source === 'collection' && !collectionKey)
      return (
        <div className="batch-empty">
          Pick a collection above to see its items.
        </div>
      )
    if (source === 'savedSearch' && !savedSearchKey)
      return (
        <div className="batch-empty">
          Pick a saved search above to see its items.
        </div>
      )
    if (items.length === 0)
      return <div className="batch-empty">No items here.</div>

    return (
      <>
        {items.map((item, index) => (
          <SelectableResultCard
            key={item.key}
            item={item}
            query={cardQuery}
            id={batchOptionId(item.key)}
            index={index}
            selected={selected.has(item.key)}
            isActive={index === activeIndex}
            locked={locked}
            onToggle={handleToggle}
          />
        ))}
        {loadingMore && <div className="batch-loading-more">Loading more…</div>}
      </>
    )
  }

  const listStatus = () => {
    if (items.length === 0) return ''
    const base = `${selectedVisibleCount}/${selectableItems.length} selected`
    return inGraphCount > 0
      ? `${base} · ${inGraphCount} already in graph`
      : base
  }

  return (
    <div className="batch-container">
      <div className="batch-source-tabs">
        {TABS.map((tab) => {
          const TabIcon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              className={`batch-source-tab${
                source === tab.id ? ' is-active' : ''
              }`}
              onClick={() => setSource(tab.id)}
              disabled={locked}
            >
              <TabIcon size={14} aria-hidden />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="batch-source-input">
        {source === 'search' && (
          <input
            type="text"
            className="search-input"
            placeholder="Search your library, or browse recently added"
            aria-label="Search your Zotero library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={locked}
            autoFocus
          />
        )}
        {source === 'collection' && (
          <SourcePicker
            options={collections.map((c) => ({
              key: c.key,
              label: c.name,
              count: c.numItems,
            }))}
            selectedKey={collectionKey}
            onSelect={setCollectionKey}
            loading={sourcesLoading}
            disabled={locked}
            emptyLabel="No collections found in your Zotero library."
          />
        )}
        {source === 'savedSearch' && (
          <SourcePicker
            options={savedSearches.map((s) => ({ key: s.key, label: s.name }))}
            selectedKey={savedSearchKey}
            onSelect={setSavedSearchKey}
            loading={sourcesLoading}
            disabled={locked}
            emptyLabel="No saved searches found in your Zotero library."
          />
        )}
      </div>

      {phase === 'done' && summary ? (
        <ImportSummary summary={summary} />
      ) : (
        <>
          <div className="batch-list-header">
            <label className="checkbox-label">
              <input
                type="checkbox"
                ref={selectAllRef}
                checked={allSelected}
                onChange={toggleAll}
                disabled={locked || selectableItems.length === 0}
              />
              Select all
            </label>
            <span className="batch-list-header-status">{listStatus()}</span>
          </div>
          <div
            className={`batch-results${
              phase === 'importing' ? ' is-disabled' : ''
            }`}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Zotero items to import"
            onKeyDown={handleListKeyDown}
          >
            {renderList()}
          </div>
        </>
      )}

      <ImportBar
        phase={phase}
        selectedCount={selected.size}
        progress={progress}
        onImport={runImport}
        onCancel={() => {
          cancelledRef.current = true
        }}
        onReset={resetForMore}
        onClose={() => logseq.hideMainUI()}
      />
    </div>
  )
}
