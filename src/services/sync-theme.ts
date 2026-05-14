// Logseq does not propagate its theme CSS variables into plugin iframes.
// resolveThemeCssPropsVals runs getComputedStyle in the host app and returns
// the values over IPC; we mirror them onto our own :root so the stylesheet's
// var(--ls-*) references resolve against the user's active theme.
const THEME_CSS_VARS = [
  '--ls-primary-background-color',
  '--ls-secondary-background-color',
  '--ls-tertiary-background-color',
  '--ls-primary-text-color',
  '--ls-secondary-text-color',
  '--ls-border-color',
  '--ls-icon-color',
  '--ls-link-text-color',
  '--ls-link-text-hover-color',
  '--ls-active-primary-color',
  '--ls-menu-hover-color',
  '--ls-page-mark-bg-color',
  '--ls-page-mark-color',
  '--ls-scrollbar-foreground-color',
  '--ls-font-family',
]

const syncTheme = async () => {
  if (!logseq.UI?.resolveThemeCssPropsVals) return
  const resolved = await logseq.UI.resolveThemeCssPropsVals(THEME_CSS_VARS)
  if (!resolved) return
  const root = document.documentElement
  for (const [name, value] of Object.entries(resolved)) {
    if (value) root.style.setProperty(name, value)
  }
}

export const registerThemeSync = () => {
  syncTheme().catch(console.error)

  // The host's computed styles lag the change event slightly, hence the delay.
  logseq.App.onThemeChanged(() => {
    setTimeout(() => syncTheme().catch(console.error), 100)
  })
  logseq.App.onThemeModeChanged(({ mode }) => {
    document.documentElement.dataset.theme = mode
    setTimeout(() => syncTheme().catch(console.error), 100)
  })

  // The popup is a showMainUI overlay; re-sync each time it becomes visible.
  logseq.on('ui:visible:changed', ({ visible }: { visible: boolean }) => {
    if (visible) syncTheme().catch(console.error)
  })

  logseq.App.getUserConfigs()
    .then(({ preferredThemeMode }) => {
      if (preferredThemeMode) {
        document.documentElement.dataset.theme = preferredThemeMode
      }
    })
    .catch(console.error)
}
