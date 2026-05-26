import { useState } from 'react'

import { applyCreatorTemplate } from '../../services/resolve-templates'
import type { SchemaSnapshot } from '../../services/schema-snapshot'
import { type FmtPreset, useFmtSample, withCurrent } from './use-fmt-sample'

const CREATOR_PRESETS: FmtPreset[] = [
  { value: '<% firstName %> <% lastName %>', label: 'First Last' },
  { value: '<% lastName %>, <% firstName %>', label: 'Last, First' },
  { value: '<% lastName %> <% firstName %>', label: 'Last First' },
]

// The shared author/creator formatting, lifted out of Zotero's Import Formats
// because it applies to every source: the name format + separator shape how a
// creator is written, and "store creators as page references" sets the creators
// property *type* (node vs default) — which the Web tag already inherits via
// `extends`. So this panel lives in the General group beside Schema, and (like
// the old Import Formats footer) surfaces the shared "Re-apply schema" action,
// since the creators-as-nodes toggle is the one schema-relevant control here.
//
// The name format + separator are still self-persisted local state. The web
// clipper doesn't read them yet (only the inherited property type), so for now
// they shape Zotero imports; web support lands when the extension joins them to
// its settings contract.
export const AuthorsSection = ({
  creatorsAsNodes,
  schemaReady,
  baseDirty,
  applying,
  onConfigChange,
  onApply,
}: {
  // "Store creators as page references" sets the creators property type, so
  // it's owned by the lifted schema state and surfaces a re-apply footer here.
  creatorsAsNodes: boolean
  schemaReady: boolean | null
  baseDirty: boolean
  applying: boolean
  onConfigChange: (patch: Partial<SchemaSnapshot>) => void
  onApply: () => void
}) => {
  const [creatorTpl, setCreatorTpl] = useState<string>(
    (logseq.settings?.creatorNameTemplate as string) ??
      '<% firstName %> <% lastName %>',
  )
  const [separator, setSeparator] = useState<string>(
    (logseq.settings?.creatorSeparator as string) ?? ', ',
  )
  const sample = useFmtSample()

  const onCreator = (v: string) => {
    setCreatorTpl(v)
    void logseq.updateSettings({ creatorNameTemplate: v })
  }
  const onSeparator = (v: string) => {
    setSeparator(v)
    void logseq.updateSettings({ creatorSeparator: v })
  }

  // Mirror the import: text mode joins formatted names with the separator; node
  // mode creates a page per author — shown here as `[[…]]` links. (In node mode
  // the separator is illustrative — Logseq renders the linked list — but it
  // controls the plain-text join exactly.)
  const authorPreview = sample.authors
    .map((c) => applyCreatorTemplate(creatorTpl, c))
    .map((name) => (creatorsAsNodes ? `[[${name}]]` : name))
    .join(separator)

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Authors</h3>
        <p className="setup-section-desc">
          {sample.fromLibrary
            ? `How creators are named and stored, shared across every source. Previewed with "${sample.title}" from your library.`
            : 'How creators are named and stored, shared across every source. The preview uses a sample item until your library loads.'}
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="creator-fmt">
            Author name
          </label>
          <div className="setup-field-row">
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
            <div className="setup-inline-field">
              <label className="setup-inline-label" htmlFor="author-sep">
                Separator
              </label>
              <input
                id="author-sep"
                className="tagrule-input setup-inline-input"
                value={separator}
                placeholder=", "
                aria-label="Separator between author names"
                onChange={(e) => onSeparator(e.target.value)}
              />
            </div>
          </div>
          <div className="setup-preview">
            <span className="setup-preview-label">Preview</span>
            <span className="setup-preview-value">{authorPreview}</span>
          </div>
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={creatorsAsNodes}
              onChange={(e) =>
                onConfigChange({ creatorsAsNodes: e.target.checked })
              }
            />
            Store creators as page references
          </label>
          <p className="setup-field-hint">
            Create a wiki-linked page for each author i.e.{' '}
            <code>[[Author Name]]</code> as shown above
          </p>
        </div>
      </div>

      {/* "Store creators as page references" sets the creators property type,
          so it's schema-relevant: the footer mirrors the Schema section. Apply
          applies the whole schema, and it's enabled only when the live config
          differs from what's applied (`baseDirty`). Hidden until a schema
          exists; the first Apply happens from the Schema section. */}
      {schemaReady === true && (
        <div className="setup-section-footer">
          <span className="setup-footer-status">
            {baseDirty
              ? 'Schema settings changed — re-apply to update your graph.'
              : 'Schema is up to date.'}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onApply}
            disabled={applying || !baseDirty}
          >
            {applying ? 'Applying…' : 'Re-apply schema'}
          </button>
        </div>
      )}
    </>
  )
}
