/** Minimal shape both React's KeyboardEvent and a test stub satisfy. */
export interface NavKeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/**
 * Maps a keydown to a vertical list-navigation intent, treating the emacs
 * bindings Ctrl-N / Ctrl-P as Down / Up alongside the arrow keys. Plain Ctrl
 * only — Cmd-N (new window) and Alt chords are left to the host. Returns null
 * for anything that isn't a navigation key.
 */
export const listNavIntent = (e: NavKeyEvent): 'down' | 'up' | null => {
  if (e.key === 'ArrowDown') return 'down'
  if (e.key === 'ArrowUp') return 'up'
  if (e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key.toLowerCase()
    if (k === 'n') return 'down'
    if (k === 'p') return 'up'
  }
  return null
}
