export const handlePopup = () => {
  // stopPropagation is scoped to Escape only — bubbling stopped on every
  // keydown would silently swallow arrows, Enter, and characters for anything
  // else listening on document.
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      logseq.hideMainUI({ restoreEditingCursor: true })
      e.stopPropagation()
    }
  })
}
