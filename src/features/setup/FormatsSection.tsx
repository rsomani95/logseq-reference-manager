import { useEffect, useState } from 'react'

import type { CreatorItem, ZotData } from '../../interfaces'
import { getSampleParents } from '../../services/get-zot-items'
import {
  applyCreatorTemplate,
  applyPageNameTemplate,
} from '../../services/resolve-templates'

interface FmtPreset {
  value: string
  label: string
}

interface FmtSample {
  title: string
  citeKey: string
  authors: CreatorItem[]
  fromLibrary: boolean
}

// Shown until a real library item loads — and as the permanent fallback when
// the library is empty or unreachable. A real two-author item (from the dev's
// own library) so the preview demonstrates multi-author formatting and the
// `@citeKey` page name out of the box.
const FALLBACK_SAMPLE: FmtSample = {
  title: 'Searching for Computer Vision North Stars',
  citeKey: 'fei-fei_2022_searching_computer_vision',
  authors: [
    { firstName: 'Li', lastName: 'Fei-Fei', creatorType: 'author' },
    { firstName: 'Ranjay', lastName: 'Krishna', creatorType: 'author' },
  ],
  fromLibrary: false,
}

const PAGE_PRESETS: FmtPreset[] = [
  { value: '@<% citeKey %>', label: 'Citekey, @-prefixed' },
  { value: '<% citeKey %>', label: 'Citekey' },
  { value: '<% title %>', label: 'Title' },
  { value: '<% citeKey %> — <% title %>', label: 'Citekey — Title' },
]

const CREATOR_PRESETS: FmtPreset[] = [
  { value: '<% firstName %> <% lastName %>', label: 'First Last' },
  { value: '<% lastName %>, <% firstName %>', label: 'Last, First' },
  { value: '<% lastName %> <% firstName %>', label: 'Last First' },
]

// Append the stored value as a "Custom (current)" entry when it isn't one of
// the presets, so a previously hand-set template isn't silently dropped from
// the dropdown (and the <select> still has a matching option to show).
const withCurrent = (presets: FmtPreset[], current: string): FmtPreset[] =>
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

export const FormatsSection = ({
  onSchemaDirty,
}: {
  // "Store creators as page references" lives here now — it's a formatting
  // choice — but it sets the authors/creators property's schema type, so
  // changing it marks the schema dirty, nudging Library to re-apply.
  onSchemaDirty: () => void
}) => {
  const [pageTpl, setPageTpl] = useState<string>(
    (logseq.settings?.pagenameTemplate as string) ?? '@<% citeKey %>',
  )
  const [creatorTpl, setCreatorTpl] = useState<string>(
    (logseq.settings?.creatorNameTemplate as string) ??
      '<% firstName %> <% lastName %>',
  )
  const [asNodes, setAsNodes] = useState<boolean>(
    (logseq.settings?.creatorsAsNodes as boolean) ?? true,
  )
  const [inline, setInline] = useState<boolean>(
    (logseq.settings?.openAttachmentInline as boolean) ?? true,
  )
  const [sample, setSample] = useState<FmtSample>(FALLBACK_SAMPLE)

  // Swap in a real item from the library once it loads. Silent on failure —
  // the fallback sample stays, and the Connect section owns connection errors.
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

  const onPage = (v: string) => {
    setPageTpl(v)
    void logseq.updateSettings({ pagenameTemplate: v })
  }
  const onCreator = (v: string) => {
    setCreatorTpl(v)
    void logseq.updateSettings({ creatorNameTemplate: v })
  }
  const onAsNodes = (v: boolean) => {
    setAsNodes(v)
    void logseq.updateSettings({ creatorsAsNodes: v })
    onSchemaDirty()
  }
  const onInline = (v: boolean) => {
    setInline(v)
    void logseq.updateSettings({ openAttachmentInline: v })
  }

  const pagePreview = applyPageNameTemplate(pageTpl, {
    title: sample.title,
    citeKey: sample.citeKey,
  })
  // Mirror the import: text mode joins formatted names with ", "; node mode
  // creates a page per author — shown here as `[[…]]` links.
  const authorPreview = sample.authors
    .map((c) => applyCreatorTemplate(creatorTpl, c))
    .map((name) => (asNodes ? `[[${name}]]` : name))
    .join(', ')

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Import formats</h3>
        <p className="setup-section-desc">
          {sample.fromLibrary
            ? `How imported pages and authors are named — previewed with “${sample.title}” from your library.`
            : 'How imported pages and authors are named. The preview uses a sample item until your library loads.'}
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="page-fmt">
            Page name
          </label>
          <select
            id="page-fmt"
            className="tagrule-select setup-control"
            value={pageTpl}
            onChange={(e) => onPage(e.target.value)}
          >
            {withCurrent(PAGE_PRESETS, pageTpl).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="setup-preview">
            <span className="setup-preview-label">Preview</span>
            <span className="setup-preview-value">{pagePreview}</span>
          </div>
        </div>

        <div className="setup-field">
          <label className="setup-field-label" htmlFor="creator-fmt">
            Author name
          </label>
          <select
            id="creator-fmt"
            className="tagrule-select setup-control"
            value={creatorTpl}
            onChange={(e) => onCreator(e.target.value)}
          >
            {withCurrent(CREATOR_PRESETS, creatorTpl).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="setup-preview">
            <span className="setup-preview-label">Preview</span>
            <span className="setup-preview-value">{authorPreview}</span>
          </div>
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={asNodes}
              onChange={(e) => onAsNodes(e.target.checked)}
            />
            Store creators as page references
          </label>
          <p className="setup-field-hint">
            Each author becomes its own page — shown as [[links]] above — so you
            can jump to all their works. Off = plain text. This sets a property
            type, so re-apply the schema in Library after changing it.
          </p>
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={inline}
              onChange={(e) => onInline(e.target.checked)}
            />
            Open attachments in Logseq
          </label>
          <p className="setup-field-hint">
            Off = open attachments in your default system app instead.
          </p>
        </div>
      </div>
    </>
  )
}
