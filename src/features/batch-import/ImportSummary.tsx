import { Ban, Check, X } from 'lucide-react'

import { BatchResult } from '../../services/batch-insert-into-graph'

/**
 * The post-import breakdown, shown in place of the list once a batch run
 * finishes: how many were imported, skipped, and failed — with the failed
 * items and their reasons listed so the user can act on them.
 */
export const ImportSummary = ({ summary }: { summary: BatchResult }) => {
  const { imported, skipped, failed, cancelled } = summary

  return (
    <div className="batch-summary">
      {cancelled && (
        <div className="batch-summary-note">
          Import cancelled. Items already processed are kept.
        </div>
      )}

      <div className="batch-summary-stats">
        <div className="batch-summary-stat">
          <Check size={16} className="batch-stat-icon batch-stat-ok" />
          <span className="batch-stat-count">{imported.length}</span>
          <span className="batch-stat-label">imported</span>
        </div>
        <div className="batch-summary-stat">
          <Ban size={16} className="batch-stat-icon batch-stat-skip" />
          <span className="batch-stat-count">{skipped.length}</span>
          <span className="batch-stat-label">already in graph</span>
        </div>
        <div className="batch-summary-stat">
          <X size={16} className="batch-stat-icon batch-stat-fail" />
          <span className="batch-stat-count">{failed.length}</span>
          <span className="batch-stat-label">failed</span>
        </div>
      </div>

      {failed.length > 0 && (
        <div className="batch-summary-failed">
          <div className="batch-summary-failed-header">Failed items</div>
          <ul className="batch-summary-failed-list">
            {failed.map(({ item, message }) => (
              <li key={item.key} className="batch-summary-failed-item">
                <span className="batch-summary-failed-title">{item.title}</span>
                <span className="batch-summary-failed-reason">{message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
