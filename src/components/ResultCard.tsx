import { ZotData } from '../interfaces'
import { ResultCardBody } from './ResultCardBody'

interface ResultCardProps {
  item: ZotData
  query: string
  onPick: (item: ZotData) => void
}

export const ResultCard = ({ item, query, onPick }: ResultCardProps) => {
  return (
    <div className="result-card" onClick={() => onPick(item)}>
      <ResultCardBody item={item} query={query} />
    </div>
  )
}
