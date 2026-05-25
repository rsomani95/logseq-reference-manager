// Pure template substitution for the page-name and creator-name formats.
// Deliberately free of any `@logseq/libs` import so it's unit-testable and can
// back the Formats settings preview — the preview renders through these exact
// functions, so what the user sees is what the import writes, by construction.
//
// Tolerance is the point: the old literal `.replace('<% citeKey %>', …)` broke
// silently on case/whitespace variants and let unknown tokens or constant
// (placeholder-free) templates through — the latter collapsing every import to
// one colliding page name. These resolvers normalise the placeholders, strip
// unknown ones, and fall back to a safe default rather than emit garbage.

export interface PageNameItem {
  title: string
  citeKey: string
}

export interface CreatorNameParts {
  firstName?: string
  lastName?: string
  name?: string
}

const CREATOR_FALLBACK = '<% firstName %> <% lastName %>'

// Case-insensitive, whitespace-tolerant matcher for one placeholder name.
const token = (name: string, flags = 'gi'): RegExp =>
  new RegExp(`<%\\s*${name}\\s*%>`, flags)

const hasAnyToken = (template: string, names: string[]): boolean =>
  names.some((n) => token(n, 'i').test(template))

// Drop any leftover `<% … %>` the substitution didn't recognise (a typo'd or
// unknown token from a hand-edited value) so it never reaches the title.
const stripUnknownTokens = (s: string): string => s.replace(/<%[^%]*%>/g, '')

export const hasCiteKeyToken = (template: string | undefined): boolean =>
  token('citeKey', 'i').test(template ?? '')

/**
 * Fills a page-name template. Tolerant of case/whitespace in the placeholders;
 * if the template carries no recognised placeholder (so every item would
 * collapse to the same colliding page name) it falls back to the citeKey
 * default, and if the result still comes out empty it falls back to the bare
 * citeKey, then the title.
 */
export const applyPageNameTemplate = (
  template: string | undefined,
  item: PageNameItem,
): string => {
  const tpl = template || ''
  // A safe per-item default: prefer the citeKey, but fall back to the title
  // when no usable citeKey exists — `@N/A` would collide across every item
  // just as a constant template would.
  const fallback =
    item.citeKey && item.citeKey !== 'N/A'
      ? `@${item.citeKey}`
      : item.title?.trim() || 'Untitled'
  if (!hasAnyToken(tpl, ['citeKey', 'title'])) return fallback
  const out = stripUnknownTokens(
    tpl
      .replace(token('citeKey'), item.citeKey ?? '')
      .replace(token('title'), item.title ?? ''),
  ).trim()
  return out || fallback
}

/**
 * Fills a creator-name template. Single-field creators (institutional authors,
 * "Various", …) bypass the template and use their `name` verbatim. Otherwise
 * tolerant of case/whitespace, falls back to "First Last" when the template has
 * no recognised placeholder, and collapses the double space left when only one
 * of the two name parts is present.
 */
export const applyCreatorTemplate = (
  template: string | undefined,
  creator: CreatorNameParts,
): string => {
  if (creator.name) return creator.name.trim()
  const tpl = template || ''
  const base = hasAnyToken(tpl, ['firstName', 'lastName'])
    ? tpl
    : CREATOR_FALLBACK
  const out = stripUnknownTokens(
    base
      .replace(token('firstName'), creator.firstName ?? '')
      .replace(token('lastName'), creator.lastName ?? ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
  return (
    out ||
    [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim() ||
    'Unknown'
  )
}
