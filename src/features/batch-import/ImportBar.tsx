import { BatchProgress } from '../../services/batch-insert-into-graph'

interface ImportBarProps {
  phase: 'select' | 'importing' | 'done'
  selectedCount: number
  progress: BatchProgress | null
  onImport: () => void
  onCancel: () => void
  onReset: () => void
  onClose: () => void
}

/**
 * The batch-import footer. Morphs across the three phases: a count + Import
 * button while selecting, a progress bar + Cancel while importing, and
 * Import-more / Close once done.
 */
export const ImportBar = ({
  phase,
  selectedCount,
  progress,
  onImport,
  onCancel,
  onReset,
  onClose,
}: ImportBarProps) => {
  if (phase === 'importing') {
    const done = progress?.done ?? 0
    const total = progress?.total ?? 0
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    return (
      <div className="batch-footer">
        <div className="batch-progress-bar">
          <div className="batch-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="batch-footer-row">
          <span className="batch-footer-status">
            Importing {done} / {total}
            {progress?.currentTitle ? ` — ${progress.currentTitle}` : '…'}
          </span>
          <button type="button" className="btn btn-gray" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="batch-footer">
        <div className="batch-footer-row is-end">
          <button type="button" className="btn btn-white" onClick={onReset}>
            Import more
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  // phase === 'select'
  const label =
    selectedCount === 0
      ? 'Import'
      : `Import ${selectedCount} ${selectedCount === 1 ? 'item' : 'items'}`

  return (
    <div className="batch-footer">
      <div className="batch-footer-row">
        <span className="batch-footer-status">
          {selectedCount === 0
            ? 'Select items to import'
            : `${selectedCount} selected`}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={selectedCount === 0}
          onClick={onImport}
        >
          {label}
        </button>
      </div>
    </div>
  )
}
