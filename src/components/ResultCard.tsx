import { useCallback } from 'react'
import { UseFormReset } from 'react-hook-form'

import { FormValues } from '../features/search-item'
import { CreatorItem, ZotData } from '../interfaces'
import { insertZotIntoGraph } from '../services/insert-zot-into-graph'

interface ResultCardProps {
  flag: 'full' | 'table' | 'citation'
  uuid: string
  item: ZotData
  reset: UseFormReset<FormValues>
}

const Creators = ({
  index,
  length,
  creator,
}: {
  index: number
  length: number
  creator: CreatorItem
}) => {
  return (
    <span className="creator-text">
      {creator.firstName} {creator.lastName} ({creator.creatorType})
      {length - index === 1 ? '' : ','}
    </span>
  )
}

export const ResultCard = ({ flag, uuid, item, reset }: ResultCardProps) => {
  const { title, creators, itemType, citeKey, date } = item

  const insertCitation = useCallback(async () => {
    if (!citeKey || citeKey === 'N/A') {
      logseq.UI.showMsg(
        'Citation key not configured properly in Better BibTex',
        'error',
      )
      return
    }
    const templateStr = (logseq.settings!.citekeyTemplate as string).replace(
      `<% citeKey %>`,
      citeKey,
    )
    await logseq.Editor.insertAtEditingCursor(templateStr)

    reset()
    logseq.hideMainUI()
  }, [item])

  const insertZot = useCallback(async () => {
    const pageName = await insertZotIntoGraph(item)
    reset()
    if (!pageName) return

    await logseq.Editor.updateBlock(uuid, `[[${pageName}]]`)
  }, [item])

  const handleClick = () => {
    if (flag === 'citation') insertCitation()
    if (flag === 'full') insertZot()
  }

  return (
    <div className="result-card" onClick={handleClick}>
      <div className="result-card-left">
        <div className="result-title-row">
          <span className="result-title">{title}</span>
          <span className="badge badge-type">{itemType}</span>
        </div>
        <div className="creators-list">
          {creators &&
            creators.map((creator, index) => (
              <Creators
                key={index}
                index={index}
                length={creators.length}
                creator={creator}
              />
            ))}
        </div>
        {citeKey && <span className="cite-key-text">Cite Key: {citeKey}</span>}
      </div>
      <div className="result-card-right">
        <span className="date-text">{date}</span>
        <span
          className={`badge ${item.inGraph ? 'badge-in-graph' : 'badge-not-in-graph'}`}
        >
          {item.inGraph ? 'in graph' : 'not in graph'}
        </span>
      </div>
    </div>
  )
}
