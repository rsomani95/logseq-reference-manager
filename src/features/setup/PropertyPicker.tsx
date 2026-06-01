import { useMemo, useState } from 'react'

import {
  buildPropertyOptions,
  formatPagePropChoice,
  parsePagePropChoice,
} from '../../services/page-props-choice'
import { PropertyList } from './PropertyList'

export const PropertyPicker = ({
  onChange,
}: {
  // Toggling a custom property changes the schema. Report the new (canonically
  // ordered) list up — the lifted schema state persists it and recomputes the
  // dirty flag the Apply button keys off.
  onChange?: (pageProps: string[]) => void
}) => {
  const options = useMemo(() => buildPropertyOptions(), [])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => {
    const raw = (logseq.settings?.pageProps as string[] | undefined) ?? []
    const keys = raw
      .map(parsePagePropChoice)
      .filter((k): k is string => k !== null)
    return new Set(keys)
  })

  // Emit in the canonical option order so the stored list is stable, as
  // `formatPagePropChoice` strings — the format set-logseqdb-schema.ts and
  // handle-zot-db.ts both read back via parsePagePropChoice.
  const persist = (next: Set<string>) => {
    const ordered = options
      .filter((o) => next.has(o.key))
      .map((o) => formatPagePropChoice(o.key))
    onChange?.(ordered)
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      persist(next)
      return next
    })
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter(
        (o) =>
          o.displayName.toLowerCase().includes(q) ||
          o.key.toLowerCase().includes(q),
      )
    : options

  return (
    <div className="setup-picker">
      <div className="setup-picker-head">
        <input
          className="tagrule-input setup-picker-search"
          placeholder="Filter properties…"
          aria-label="Filter properties"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="setup-picker-count">{selected.size} selected</span>
      </div>
      <div className="setup-picker-list">
        {filtered.length === 0 ? (
          <div className="batch-empty">No properties match "{query}".</div>
        ) : (
          <PropertyList
            options={filtered}
            selectable
            selected={selected}
            onToggle={toggle}
          />
        )}
      </div>
    </div>
  )
}
