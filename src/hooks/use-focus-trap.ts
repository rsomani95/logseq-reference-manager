import { type RefObject, useEffect } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Keeps Tab / Shift-Tab inside `ref` while it's mounted, and moves focus into
 * it on open. The plugin renders in a real iframe, so without this, tabbing
 * past the last control walks out into the (obscured) Logseq app behind the
 * modal: aria-modal hides that content from screen readers but doesn't stop
 * Tab from reaching it. Escape-to-close lives in handle-popup.ts; this is the
 * keyboard-containment half. Dismissal is an instant hideMainUI() cut, so the
 * host returns focus on close (nothing to restore here).
 */
export const useFocusTrap = (ref: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Pull focus inside on open, unless a control in here already has it
    // (e.g. an autoFocus search input).
    if (!el.contains(document.activeElement)) {
      const firstInside = el.querySelector<HTMLElement>(FOCUSABLE)
      ;(firstInside ?? el).focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      const active = document.activeElement
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }

    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [ref])
}
