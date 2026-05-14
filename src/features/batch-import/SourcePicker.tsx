import { useState } from 'react'

interface SourcePickerOption {
  key: string
  label: string
  count?: number
}

interface SourcePickerProps {
  options: SourcePickerOption[]
  selectedKey: string
  onSelect: (key: string) => void
  loading: boolean
  disabled: boolean
  emptyLabel: string
  visibleCount?: number
}

/**
 * Inline chip list for picking a batch-import container (a collection or a
 * saved search). Shows up to `visibleCount` chips directly — no dropdown to
 * open — and folds any extras behind a "+N more" chip.
 */
export const SourcePicker = ({
  options,
  selectedKey,
  onSelect,
  loading,
  disabled,
  emptyLabel,
  visibleCount = 5,
}: SourcePickerProps) => {
  const [expanded, setExpanded] = useState(false)

  if (loading) return <span className="batch-picker-status">Loading…</span>
  if (options.length === 0)
    return <span className="batch-picker-status">{emptyLabel}</span>

  const visible = expanded ? options : options.slice(0, visibleCount)
  const hiddenCount = options.length - visible.length

  return (
    <div className="batch-picker">
      {visible.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`batch-picker-chip${
            opt.key === selectedKey ? ' is-selected' : ''
          }`}
          onClick={() => onSelect(opt.key)}
          disabled={disabled}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span className="batch-picker-count">{opt.count}</span>
          )}
        </button>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="batch-picker-chip batch-picker-more"
          onClick={() => setExpanded(true)}
          disabled={disabled}
        >
          +{hiddenCount} more
        </button>
      )}
      {expanded && options.length > visibleCount && (
        <button
          type="button"
          className="batch-picker-chip batch-picker-more"
          onClick={() => setExpanded(false)}
          disabled={disabled}
        >
          Show fewer
        </button>
      )}
    </div>
  )
}
