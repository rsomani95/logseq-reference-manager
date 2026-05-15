import { ResultCardBody } from '../../components/ResultCardBody'
import { ZotData } from '../../interfaces'

interface SelectableResultCardProps {
  item: ZotData
  query: string
  index: number
  selected: boolean
  isActive: boolean
  locked: boolean
  onToggle: (index: number, shiftKey: boolean) => void
}

/**
 * A selectable row in the batch list. The list is a multi-select
 * `role="listbox"` with roving tabindex — exactly one card is the tab stop
 * (`isActive`), arrow keys move it, Space toggles. The card itself is the
 * control, so the checkbox is taken out of the tab order. `locked` (set
 * during the import phase) removes the row from the tab order entirely.
 */
export const SelectableResultCard = ({
  item,
  query,
  index,
  selected,
  isActive,
  locked,
  onToggle,
}: SelectableResultCardProps) => {
  // Items already in the graph can't be selected — batch import skips them.
  const disabled = item.inGraph

  const className = [
    'result-card',
    'result-card-selectable',
    item.inGraph && 'result-card-in-graph',
    disabled && 'result-card-disabled',
    selected && 'result-card-selected',
    isActive && 'result-card-active',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      id={`batch-opt-${item.key}`}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled}
      tabIndex={!locked && isActive ? 0 : -1}
      onClick={disabled ? undefined : (e) => onToggle(index, e.shiftKey)}
    >
      <input
        type="checkbox"
        className="result-card-checkbox"
        checked={selected}
        disabled={disabled}
        tabIndex={-1}
        readOnly
      />
      <ResultCardBody item={item} query={query} />
    </div>
  )
}
