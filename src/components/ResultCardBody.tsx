import { memo, type ReactNode, useMemo } from 'react'

import { CreatorItem, ZotData } from '../interfaces'
import { getItemTypeIcon } from '../services/item-type-icon'

// How many names the author line shows before "+N more".
const AUTHORS_LINE_LIMIT = 10

// Suffixes Zotero sometimes mis-files into the `lastName` field — e.g. a bad
// import lands firstName "Sebastian Raschka" / lastName "PhD". When the last
// name is really a suffix, the first name carries the actual name.
const NAME_SUFFIXES = new Set([
  'phd',
  'md',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'msc',
  'ma',
  'ba',
])

const isSuffix = (s: string): boolean =>
  NAME_SUFFIXES.has(s.toLowerCase().replace(/\./g, ''))

const fullNameOf = (c: CreatorItem): string => {
  const last = c.lastName.trim()
  const first = c.firstName.trim()
  return isSuffix(last) ? first : `${first} ${last}`.trim()
}

// The source shown on the footer line: a named publication when there is one,
// otherwise the URL's host — so a bare webpage still says where it lives.
const venueOf = (item: ZotData): string => {
  const named =
    item.publicationTitle ||
    item.repository ||
    item.libraryCatalog ||
    item.websiteTitle ||
    item.blogTitle
  if (named) return named
  if (item.url) {
    try {
      return new URL(item.url).hostname.replace(/^www\./, '')
    } catch {
      // not a parseable URL — no source
    }
  }
  return ''
}

interface MatchInfo {
  titleHit: boolean
  authorHit: boolean
  venueHit: boolean
  yearHit: boolean
  abstractHit: boolean
  // A hit on a field with no home on the card (cite key / short title /
  // journal abbreviation / non-author creator like an editor), surfaced as
  // the `↳` match line so the result never looks like a phantom.
  hidden: { label: string; value: string } | null
}

// The popup searches more fields than the card shows (see the fuse keys in
// `use-items.ts`). This works out where a query landed so every match can
// explain itself — substring matching, consistent with `Highlighted` below.
const analyzeMatch = (
  item: ZotData,
  query: string,
  displayCreators: CreatorItem[],
  venue: string,
  year: string,
): MatchInfo => {
  const has = (s: string | undefined): boolean =>
    !!s && s.toLowerCase().includes(query)

  const titleHit = has(item.title)
  const authorHit = displayCreators.some((c) =>
    fullNameOf(c).toLowerCase().includes(query),
  )
  const venueHit = has(venue)
  const yearHit = has(year)
  const abstractHit = has(item.abstractNote)

  let hidden: MatchInfo['hidden'] = null
  if (!titleHit && !authorHit && !venueHit && !yearHit && !abstractHit) {
    // A creator that isn't in the displayed author line (e.g. the editor on
    // a chapter where chapter authors show but the book's editor doesn't).
    // Without this the row would render with no highlight anywhere, even
    // though Fuse indexes editors via the combined creators key.
    const displayedNames = new Set(
      displayCreators.map((c) => fullNameOf(c).toLowerCase()),
    )
    const matchedOther = (item.creators ?? []).find((c) => {
      const name = fullNameOf(c).toLowerCase()
      return !displayedNames.has(name) && name.includes(query)
    })
    if (matchedOther) {
      hidden = {
        label: matchedOther.creatorType || 'creator',
        value: fullNameOf(matchedOther),
      }
    }

    if (!hidden) {
      const offRow: [string, string | undefined][] = [
        ['short title', item.shortTitle],
        ['cite key', item.citationKey],
        ['journal', item.journalAbbreviation],
      ]
      for (const [label, value] of offRow) {
        if (has(value)) {
          hidden = { label, value: value as string }
          break
        }
      }
    }
  }
  return { titleHit, authorHit, venueHit, yearHit, abstractHit, hidden }
}

// Wraps every occurrence of `query` (already lower-cased) in a <mark>.
const Highlighted = ({ text, query }: { text: string; query: string }) => {
  if (!query) return text
  const lower = text.toLowerCase()
  if (!lower.includes(query)) return text

  const parts: ReactNode[] = []
  let cursor = 0
  let idx = lower.indexOf(query)
  let key = 0
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx))
    parts.push(
      <mark key={key++} className="result-card-mark">
        {text.slice(idx, idx + query.length)}
      </mark>,
    )
    cursor = idx + query.length
    idx = lower.indexOf(query, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

// A comma-joined run of highlighted full names.
const nameRun = (creators: CreatorItem[], query: string): ReactNode[] =>
  creators.map((c, i) => (
    <span key={`${c.lastName}-${i}`}>
      {i > 0 ? ', ' : ''}
      <Highlighted text={fullNameOf(c)} query={query} />
    </span>
  ))

// The author line: up to AUTHORS_LINE_LIMIT names, then "+N more". When a
// query matches a co-author past that cut, it's surfaced after a "…" so the
// search hit is never hidden — "Gadre, Ilharco, … , Schmidt +22 more".
const AuthorsLine = ({
  creators,
  query,
}: {
  creators: CreatorItem[]
  query: string
}) => {
  const shown = creators.slice(0, AUTHORS_LINE_LIMIT)
  const matchedBeyond = query
    ? creators
        .slice(AUTHORS_LINE_LIMIT)
        .filter((c) => fullNameOf(c).toLowerCase().includes(query))
    : []

  if (matchedBeyond.length === 0) {
    const extra = creators.length - shown.length
    return (
      <>
        {nameRun(shown, query)}
        {extra > 0 && (
          <span className="result-card-authors-count"> +{extra} more</span>
        )}
      </>
    )
  }

  const rest = creators.length - shown.length - matchedBeyond.length
  return (
    <>
      {nameRun(shown, query)}
      <span className="result-card-ellipsis"> … </span>
      {nameRun(matchedBeyond, query)}
      {rest > 0 && (
        <span className="result-card-authors-count"> +{rest} more</span>
      )}
    </>
  )
}

// The abstract block — a static two-line clamp. No query, or a hit near the
// start → show from the top. A deeper hit → window in (leading "…") so the
// match still lands inside the two visible lines.
const AbstractBlock = ({
  abstract,
  query,
}: {
  abstract: string
  query: string
}) => {
  if (!query) return abstract
  const idx = abstract.toLowerCase().indexOf(query)
  if (idx <= 150) return <Highlighted text={abstract} query={query} />
  const frag = abstract.slice(idx - 60).replace(/^\S*\s+/, '')
  return (
    <>
      {'… '}
      <Highlighted text={frag} query={query} />
    </>
  )
}

interface ResultCardBodyProps {
  item: ZotData
  query: string
}

export const ResultCardBody = memo(({ item, query }: ResultCardBodyProps) => {
  const { title, authors, creators, itemType, abstractNote } = item
  const q = query.trim().toLowerCase()

  const displayCreators = useMemo(
    () => (authors && authors.length > 0 ? authors : (creators ?? [])),
    [authors, creators],
  )

  const venue = useMemo(() => venueOf(item), [item])
  const year = item.year ?? ''

  const match = useMemo(
    () => (q ? analyzeMatch(item, q, displayCreators, venue, year) : null),
    [item, q, displayCreators, venue, year],
  )

  const TypeIcon = getItemTypeIcon(itemType)

  return (
    <div className="result-card-body">
      <div className="result-card-headline">
        <TypeIcon className="result-card-icon" size={13} aria-hidden />
        <span className="result-card-title" title={title}>
          <Highlighted text={title} query={q} />
        </span>
        {item.inGraph && <span className="sr-only"> — already in graph</span>}
      </div>

      {displayCreators.length > 0 && (
        <div className="result-card-authors">
          <AuthorsLine creators={displayCreators} query={q} />
        </div>
      )}

      {abstractNote && (
        <div className="result-card-abstract">
          <AbstractBlock abstract={abstractNote} query={q} />
        </div>
      )}

      {(venue || year) && (
        <div className="result-card-source">
          {venue && (
            <span className="result-card-source-venue">
              {match?.venueHit ? <Highlighted text={venue} query={q} /> : venue}
            </span>
          )}
          {venue && year && <span className="result-card-sep">·</span>}
          {year && (
            <span className="result-card-source-year">
              {match?.yearHit ? <Highlighted text={year} query={q} /> : year}
            </span>
          )}
        </div>
      )}

      {match?.hidden && (
        <div className="result-card-match">
          <span className="result-card-match-field">{match.hidden.label}</span>
          <span className="result-card-match-text">
            <Highlighted text={match.hidden.value} query={q} />
          </span>
        </div>
      )}
    </div>
  )
})
