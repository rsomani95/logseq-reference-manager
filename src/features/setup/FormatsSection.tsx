import { useState } from 'react'

import { applyPageNameTemplate } from '../../services/resolve-templates'
import { type FmtPreset, useFmtSample, withCurrent } from './use-fmt-sample'

// The literal `@` lives in the separate Prefix field now (see `pagenamePrefix`
// + migratePagenamePrefixIfNeeded), so the structure presets carry tokens only.
const PAGE_PRESETS: FmtPreset[] = [
  { value: '<% citeKey %>', label: 'Citekey' },
  { value: '<% title %>', label: 'Title' },
]

// Zotero-only naming + attachment behavior. Author formatting moved to the
// shared Authors panel (General group) since it applies to every source —
// leaving this section purely cosmetic: nothing here touches the schema, so
// there's no re-apply footer. Page name (citeKey / title) is Zotero-specific —
// web clips have no citeKey — so it stays under Zotero.
export const FormatsSection = () => {
  const [pageTpl, setPageTpl] = useState<string>(
    (logseq.settings?.pagenameTemplate as string) ?? '<% citeKey %>',
  )
  const [prefix, setPrefix] = useState<string>(
    (logseq.settings?.pagenamePrefix as string) ?? '',
  )
  const [inline, setInline] = useState<boolean>(
    (logseq.settings?.openAttachmentInline as boolean) ?? true,
  )
  const sample = useFmtSample()

  const onPage = (v: string) => {
    setPageTpl(v)
    void logseq.updateSettings({ pagenameTemplate: v })
  }
  const onPrefix = (v: string) => {
    setPrefix(v)
    void logseq.updateSettings({ pagenamePrefix: v })
  }
  const onInline = (v: boolean) => {
    setInline(v)
    void logseq.updateSettings({ openAttachmentInline: v })
  }

  const pagePreview = applyPageNameTemplate(
    pageTpl,
    { title: sample.title, citeKey: sample.citeKey },
    prefix,
  )

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Import Formats</h3>
        <p className="setup-section-desc">
          {sample.fromLibrary
            ? `How imported pages are named. Previewed with “${sample.title}” from your library.`
            : 'How imported pages are named. The preview uses a sample item until your library loads.'}
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="page-fmt">
            Page name
          </label>
          <div className="setup-field-row">
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
            <div className="setup-inline-field">
              <label className="setup-inline-label" htmlFor="page-prefix">
                Prefix
              </label>
              <input
                id="page-prefix"
                className="tagrule-input setup-inline-input"
                value={prefix}
                placeholder="@"
                aria-label="Page name prefix"
                onChange={(e) => onPrefix(e.target.value)}
              />
            </div>
          </div>
          <div className="setup-preview">
            <span className="setup-preview-label">Preview</span>
            <span className="setup-preview-value">{pagePreview}</span>
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
