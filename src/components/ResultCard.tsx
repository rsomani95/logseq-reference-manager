import { memo } from 'react'

import { ZotData } from '../interfaces'
import { ResultCardBody } from './ResultCardBody'

interface ResultCardProps {
  item: ZotData
  query: string
  id: string
  isActive: boolean
  onPick: (item: ZotData) => void
}

export const ResultCard = memo(
  ({ item, query, id, isActive, onPick }: ResultCardProps) => {
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
        id={id}
        role="option"
        aria-selected={isActive}
        onClick={() => onPick(item)}
      >
        <ResultCardBody item={item} query={query} />
      </div>
    )
  },
)
