import type { PageEntity } from '@logseq/libs/dist/LSPlugin'

/**
 * Normalizes the raw class entities from `logseq.Editor.getAllTags()` into a
 * deduped, sorted list of display names for the tag picker.
 *
 * - Prefers `title` (display case, e.g. "to-read"); falls back to `name`
 *   (the lowercased page name). Drops blank/whitespace-only entries.
 * - Dedupes case-insensitively (Logseq resolves classes by lowercased name, so
 *   "ml" and "ML" are the same class) — the first display-cased spelling seen
 *   wins.
 * - Sorts with localeCompare for a stable, human-friendly order.
 *
 * Pure: feed it any PageEntity[]; no SDK access. `getAllTags` returns null when
 * unavailable, so callers should pass `?? []`.
 */
export const normalizeTagSuggestions = (
  tags: readonly Partial<Pick<PageEntity, 'title' | 'name'>>[],
): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    // Prefer `title`, but treat a blank/whitespace-only title as absent and
    // fall back to `name` — `??` alone only catches null/undefined, not "".
    const label = ((t.title ?? '').trim() || (t.name ?? '').trim()).trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/** A single navigable row in the tag picker dropdown. */
export type TagOption =
  | { kind: 'existing'; value: string }
  | { kind: 'create'; value: string }

/**
 * Computes the dropdown rows for the current input. Returns the matching
 * existing suggestions (case-insensitive substring, excluding tags already
 * chosen), followed by a synthetic "create" row when the trimmed query is
 * non-empty and matches neither an existing suggestion nor an already-chosen
 * tag (both compared case-insensitively).
 *
 * Pure + in-memory (the list is tiny): no debounce, no fuzzy index — substring
 * only, matching the rest of the plugin's deliberately fuse-free filtering.
 */
export const computeTagOptions = (
  suggestions: readonly string[],
  selected: readonly string[],
  query: string,
): TagOption[] => {
  const trimmed = query.trim()
  const q = trimmed.toLowerCase()
  const chosen = new Set(selected.map((s) => s.toLowerCase()))

  const matches: TagOption[] = suggestions
    .filter((s) => !chosen.has(s.toLowerCase()) && s.toLowerCase().includes(q))
    .map((value) => ({ kind: 'existing', value }))

  const exactExists =
    trimmed !== '' &&
    (suggestions.some((s) => s.toLowerCase() === q) || chosen.has(q))

  if (trimmed !== '' && !exactExists) {
    matches.push({ kind: 'create', value: trimmed })
  }
  return matches
}
