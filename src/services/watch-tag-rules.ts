import { parseTagRules } from '../extended-tags'

// Toast a parse-error summary when the user edits `tagRules`. Without this, a
// typo would only surface as a silent no-match at the next import (the read
// path logs to console, but the user isn't watching DevTools mid-edit).
// Debounced because Logseq fires `onSettingsChanged` on every keystroke in a
// textarea — fire once when typing pauses.
const TOAST_DEBOUNCE_MS = 1500
const TOAST_TIMEOUT_MS = 8000

export const registerTagRulesWatcher = () => {
  let timer: ReturnType<typeof setTimeout> | null = null

  logseq.onSettingsChanged((next, prev) => {
    if (!prev) return
    const nextRules = (next as Record<string, unknown>).tagRules
    const prevRules = (prev as Record<string, unknown>).tagRules
    if (nextRules === prevRules) return

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const { errors } = parseTagRules(nextRules)
      if (errors.length === 0) return
      const summary =
        errors.length === 1
          ? errors[0]
          : `${errors.length} issues — see the console for details.`
      logseq.UI.showMsg(`Tag rules: ${summary}`, 'warning', {
        timeout: TOAST_TIMEOUT_MS,
      })
      console.warn('[extended-tags] tagRules has issues:', errors)
    }, TOAST_DEBOUNCE_MS)
  })
}
