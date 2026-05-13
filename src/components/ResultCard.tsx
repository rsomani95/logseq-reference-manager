import { useCallback, useMemo, useState } from 'react'
import { UseFormReset } from 'react-hook-form'

import { FormValues } from '../features/search-item'
import { CreatorItem, ZotData } from '../interfaces'
import { insertZotIntoGraph } from '../services/insert-zot-into-graph'
import { getItemTypeIcon } from '../services/item-type-icon'

interface ResultCardProps {
  uuid: string
  item: ZotData
  reset: UseFormReset<FormValues>
  query: string
}

const COLLAPSED_AUTHOR_COUNT = 3

const matchesQuery = (creator: CreatorItem, q: string): boolean => {
  if (!q) return false
  const fullName = `${creator.firstName} ${creator.lastName}`.toLowerCase()
  return fullName.includes(q.toLowerCase())
}

const HighlightedName = ({ name, query }: { name: string; query: string }) => {
  if (!query) return <>{name}</>
  const lowerName = name.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lowerName.indexOf(lowerQuery)
  if (idx === -1) return <>{name}</>
  return (
    <>
      {name.slice(0, idx)}
      <mark className="author-match">
        {name.slice(idx, idx + lowerQuery.length)}
      </mark>
      {name.slice(idx + lowerQuery.length)}
    </>
  )
}

const CreatorEntry = ({
  creator,
  isLast,
  query,
}: {
  creator: CreatorItem
  isLast: boolean
  query: string
}) => {
  const fullName = `${creator.firstName} ${creator.lastName}`.trim()
  return (
    <span className="author-text">
      <HighlightedName name={fullName} query={query} />
      {isLast ? '' : ','}
    </span>
  )
}

export const ResultCard = ({ uuid, item, reset, query }: ResultCardProps) => {
  const { title, authors, creators, itemType, citeKey, date } = item
  const displayCreators = useMemo(
    () => (authors && authors.length > 0 ? authors : (creators ?? [])),
    [authors, creators],
  )

  const [expanded, setExpanded] = useState(false)

  const visibleCreators = useMemo(() => {
    if (expanded) return displayCreators
    if (displayCreators.length <= COLLAPSED_AUTHOR_COUNT) return displayCreators

    const matched: CreatorItem[] = []
    const rest: CreatorItem[] = []
    for (const c of displayCreators) {
      if (matchesQuery(c, query)) matched.push(c)
      else rest.push(c)
    }
    const visible = [...matched]
    while (
      visible.length < COLLAPSED_AUTHOR_COUNT &&
      rest.length > 0 &&
      visible.length < displayCreators.length
    ) {
      visible.push(rest.shift()!)
    }
    return visible.slice(0, COLLAPSED_AUTHOR_COUNT)
  }, [displayCreators, expanded, query])

  const hiddenCount = displayCreators.length - visibleCreators.length

  const handleClick = useCallback(async () => {
    const pageName = await insertZotIntoGraph(item)
    reset()
    if (!pageName) return

    await logseq.Editor.updateBlock(uuid, `[[${pageName}]]`)
  }, [item])

  const TypeIcon = getItemTypeIcon(itemType)

  return (
    <div className="result-card" onClick={handleClick}>
      <div className="result-card-left">
        <div className="result-title-row">
          <TypeIcon className="item-type-icon" size={14} aria-hidden />
          <span className="result-title">
            <HighlightedName name={title} query={query} />
          </span>
          <span className="badge badge-type">{itemType}</span>
        </div>
        <div className="authors-list">
          {visibleCreators.map((creator, index) => (
            <CreatorEntry
              key={`${creator.firstName}-${creator.lastName}-${index}`}
              creator={creator}
              isLast={index === visibleCreators.length - 1 && hiddenCount === 0}
              query={query}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="more-authors-toggle"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(true)
              }}
            >
              +{hiddenCount} more
            </button>
          )}
          {expanded && displayCreators.length > COLLAPSED_AUTHOR_COUNT && (
            <button
              type="button"
              className="more-authors-toggle"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(false)
              }}
            >
              show less
            </button>
          )}
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
