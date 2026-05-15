export const handlePopup = () => {
  // Hit 'Esc' to close pop-up. stopPropagation is scoped to Escape only —
  // bubbling stopped on every keydown would silently swallow arrow keys,
  // Enter, every character for anything else listening on document.
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      logseq.hideMainUI({ restoreEditingCursor: true })
      e.stopPropagation()
    }
  })
}
