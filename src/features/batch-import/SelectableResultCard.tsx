import { memo } from 'react'

import { ResultCardBody } from '../../components/ResultCardBody'
import { ZotData } from '../../interfaces'

interface SelectableResultCardProps {
  item: ZotData
  query: string
  id: string
  index: number
  selected: boolean
  isActive: boolean
  locked: boolean
  onToggle: (index: number, shiftKey: boolean) => void
}

export const SelectableResultCard = memo(
  ({
    item,
    query,
    id,
    index,
    selected,
    isActive,
    locked,
    onToggle,
  }: SelectableResultCardProps) => {
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
        id={id}
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
  },
)
