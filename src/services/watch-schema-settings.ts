// Schema-affecting settings only take effect after the user re-runs the
// "Add Zotero schema to Logseq" command — the panel's `Schema` heading says
// this once, and this watcher fires a single trailing-debounced toast at the
// moment of change so the requirement isn't lost between reading and acting.
// Render-only settings (creatorNameTemplate, pagenameTemplate, etc.) are
// intentionally absent from this set.
const SCHEMA_AFFECTING_KEYS = [
  'zotTag',
  'propertyPreset',
  'pageProps',
  'creatorsAsNodes',
] as const

const TOAST_DEBOUNCE_MS = 1500
const TOAST_TIMEOUT_MS = 8000

export const registerSchemaSettingsWatcher = () => {
  let timer: ReturnType<typeof setTimeout> | null = null

  logseq.onSettingsChanged((next, prev) => {
    // First emit (defaults populate on connect) has no prior state to diff.
    if (!prev) return

    const changed = SCHEMA_AFFECTING_KEYS.some(
      (key) =>
        JSON.stringify((next as Record<string, unknown>)[key]) !==
        JSON.stringify((prev as Record<string, unknown>)[key]),
    )
    if (!changed) return

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      logseq.UI.showMsg(
        'Schema setting changed — run "Zotero: Add Zotero schema to Logseq" from the command palette to apply.',
        'warning',
        { timeout: TOAST_TIMEOUT_MS },
      )
    }, TOAST_DEBOUNCE_MS)
  })
}
