import { useEffect, useState } from 'react'

import { normalizeTagSuggestions } from '../services/tag-suggestions'

/**
 * Loads the graph's existing tags (class pages) once when the component mounts,
 * for the tag picker's autocomplete. `getAllTags()` returns only class entities
 * (no journals / properties / soft-deleted), so no post-filtering is needed.
 *
 * The modal is remounted with a fresh key on every invocation
 * (BatchContainer), so a fresh fetch per open is automatic — no in-session
 * refresh is wired (a just-typed-to-create tag legitimately isn't here yet; the
 * picker's create row covers that). Returns [] until loaded, and [] on failure
 * (the call returns null rather than throwing).
 */
export const useTagSuggestions = (): string[] => {
  const [suggestions, setSuggestions] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    logseq.Editor.getAllTags()
      .then((tags) => {
        if (cancelled) return
        setSuggestions(normalizeTagSuggestions(tags ?? []))
      })
      .catch((e) => {
        console.warn('[tags] Failed to load tag suggestions:', e)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return suggestions
}
