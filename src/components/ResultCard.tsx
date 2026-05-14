import { ZotData } from '../interfaces'
import { ResultCardBody } from './ResultCardBody'

interface ResultCardProps {
  item: ZotData
  query: string
  onPick: (item: ZotData) => void
}

export const ResultCard = ({ item, query, onPick }: ResultCardProps) => {
  const className = item.inGraph
    ? 'result-card result-card-in-graph'
    : 'result-card'
  return (
    <div className={className} onClick={() => onPick(item)}>
      <ResultCardBody item={item} query={query} />
    </div>
  )
}
