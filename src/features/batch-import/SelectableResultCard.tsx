import { ResultCardBody } from '../../components/ResultCardBody'
import { ZotData } from '../../interfaces'

interface SelectableResultCardProps {
  item: ZotData
  query: string
  index: number
  selected: boolean
  onToggle: (index: number, shiftKey: boolean) => void
}

export const SelectableResultCard = ({
  item,
  query,
  index,
  selected,
  onToggle,
}: SelectableResultCardProps) => {
  // Items already in the graph can't be selected — batch import skips them.
  const disabled = item.inGraph

  const className = [
    'result-card',
    'result-card-selectable',
    disabled && 'result-card-disabled',
    selected && 'result-card-selected',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      onClick={disabled ? undefined : (e) => onToggle(index, e.shiftKey)}
    >
      <input
        type="checkbox"
        className="result-card-checkbox"
        checked={selected}
        disabled={disabled}
        readOnly
      />
      <div className="result-card-body">
        <ResultCardBody item={item} query={query} />
      </div>
    </div>
  )
}
