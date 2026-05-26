import { useEffect, useState } from 'react'

import type { CreatorItem, ZotData } from '../../interfaces'
import { getSampleParents } from '../../services/get-zot-items'

export interface FmtSample {
  title: string
  citeKey: string
  authors: CreatorItem[]
  fromLibrary: boolean
}

export interface FmtPreset {
  value: string
  label: string
}

// Shown until a real library item loads — and as the permanent fallback when
// the library is empty or unreachable. A real two-author item (from the dev's
// own library) so the preview demonstrates multi-author formatting and the
// `@citeKey` page name out of the box.
export const FALLBACK_SAMPLE: FmtSample = {
  title: 'Searching for Computer Vision North Stars',
  citeKey: 'fei-fei_2022_searching_computer_vision',
  authors: [
    { firstName: 'Li', lastName: 'Fei-Fei', creatorType: 'author' },
    { firstName: 'Ranjay', lastName: 'Krishna', creatorType: 'author' },
  ],
  fromLibrary: false,
}

// Append the stored value as a "Custom (current)" entry when it isn't one of
// the presets, so a previously hand-set template isn't silently dropped from
// the dropdown (and the <select> still has a matching option to show).
export const withCurrent = (
  presets: FmtPreset[],
  current: string,
): FmtPreset[] =>
  !current || presets.some((p) => p.value === current)
    ? presets
    : [...presets, { value: current, label: 'Custom (current)' }]

// Pick the richest real item for the preview: prefer a real citeKey (so the
// `@citeKey` format reads naturally) and 2+ authors (so multi-author formatting
// shows), but accept any item that has at least one author. Recents come back
// dateAdded-desc, so ties resolve to the most recent.
const pickSample = (items: ZotData[]): FmtSample | null => {
  const best = items
    .filter((i) => (i.authors?.length ?? 0) > 0)
    .map((i) => ({
      item: i,
      score:
        (i.citeKey && i.citeKey !== 'N/A' ? 2 : 0) +
        ((i.authors?.length ?? 0) >= 2 ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.item
  if (!best) return null
  return {
    title: best.title,
    citeKey: best.citeKey,
    authors: best.authors ?? [],
    fromLibrary: true,
  }
}

// Shared by the Import Formats (page name) and Authors panels — both preview
// against a real library item, swapping in the richest one once it loads.
// Silent on failure: the fallback sample stays, and the Connect section owns
// connection errors. Each panel mounts its own copy; only the active panel is
// rendered, so this fetches at most once per panel visit.
export const useFmtSample = (): FmtSample => {
  const [sample, setSample] = useState<FmtSample>(FALLBACK_SAMPLE)

  useEffect(() => {
    let cancelled = false
    void getSampleParents().then((items) => {
      if (cancelled) return
      const picked = pickSample(items)
      if (picked) setSample(picked)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return sample
}
