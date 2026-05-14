import { useCallback } from 'react'
import { UseFormReset } from 'react-hook-form'

import { FormValues } from '../features/search-item'
import { ZotData } from '../interfaces'
import { insertZotIntoGraph } from '../services/insert-zot-into-graph'
import { ResultCardBody } from './ResultCardBody'

interface ResultCardProps {
  uuid: string
  item: ZotData
  reset: UseFormReset<FormValues>
  query: string
}

export const ResultCard = ({ uuid, item, reset, query }: ResultCardProps) => {
  const handleClick = useCallback(async () => {
    const pageName = await insertZotIntoGraph(item)
    reset()
    if (!pageName) return

    await logseq.Editor.updateBlock(uuid, `[[${pageName}]]`)
  }, [item])

  return (
    <div className="result-card" onClick={handleClick}>
      <ResultCardBody item={item} query={query} />
    </div>
  )
}
