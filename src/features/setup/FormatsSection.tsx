import { useState } from 'react'

import {
  applyCreatorTemplate,
  applyPageNameTemplate,
} from '../../services/resolve-templates'

interface FmtPreset {
  value: string
  label: string
}

const SAMPLE_PAGE = {
  title: 'Attention Is All You Need',
  citeKey: 'vaswani2017',
}
const SAMPLE_CREATOR = { firstName: 'Ada', lastName: 'Lovelace' }

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

export const FormatsSection = () => {
  const [pageTpl, setPageTpl] = useState<string>(
    (logseq.settings?.pagenameTemplate as string) ?? '@<% citeKey %>',
  )
  const [creatorTpl, setCreatorTpl] = useState<string>(
    (logseq.settings?.creatorNameTemplate as string) ??
      '<% firstName %> <% lastName %>',
  )
  const [inline, setInline] = useState<boolean>(
    (logseq.settings?.openAttachmentInline as boolean) ?? true,
  )

  const onPage = (v: string) => {
    setPageTpl(v)
    void logseq.updateSettings({ pagenameTemplate: v })
  }
  const onCreator = (v: string) => {
    setCreatorTpl(v)
    void logseq.updateSettings({ creatorNameTemplate: v })
  }
  const onInline = (v: boolean) => {
    setInline(v)
    void logseq.updateSettings({ openAttachmentInline: v })
  }

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Import formats</h3>
        <p className="setup-section-desc">
          How imported pages and authors are named. The preview shows a real
          example.
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
            <span className="setup-preview-value">
              {applyPageNameTemplate(pageTpl, SAMPLE_PAGE)}
            </span>
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
            <span className="setup-preview-value">
              {applyCreatorTemplate(creatorTpl, SAMPLE_CREATOR)}
            </span>
          </div>
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
