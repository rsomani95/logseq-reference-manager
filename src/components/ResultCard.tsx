import { ZotData } from '../interfaces'
import { ResultCardBody } from './ResultCardBody'

interface ResultCardProps {
  item: ZotData
  query: string
  isActive: boolean
  onPick: (item: ZotData) => void
}

/**
 * Click-to-insert result row for the search popup. The popup is an
 * aria-activedescendant combobox — the search input keeps real focus, so
 * this row is a `role="option"` that's *highlighted* (`.result-card-active`)
 * rather than focused. `id` ties it back to the input's
 * `aria-activedescendant`; `isActive` is owned by `SearchItem`'s keyboard nav.
 */
export const ResultCard = ({
  item,
  query,
  isActive,
  onPick,
}: ResultCardProps) => {
  const className = [
    'result-card',
    item.inGraph && 'result-card-in-graph',
    isActive && 'result-card-active',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      id={`zot-opt-${item.key}`}
      role="option"
      aria-selected={isActive}
      onClick={() => onPick(item)}
    >
      <ResultCardBody item={item} query={query} />
    </div>
  )
}
