import { useState } from 'react'

import type { PropertyPreset } from '../../interfaces'
import type { SchemaSnapshot } from '../../services/schema-snapshot'
import { PresetFieldList } from './PresetFieldList'
import { PropertyPicker } from './PropertyPicker'

const PRESETS: { id: PropertyPreset; label: string; desc: string }[] = [
  {
    id: 'Essentials',
    label: 'Essentials',
    desc: 'Common citation fields for papers & articles',
  },
  { id: 'Full', label: 'Full', desc: 'Every available Zotero field' },
  { id: 'Custom', label: 'Custom', desc: 'Pick exactly the fields you want' },
]

// The shared property schema. Pulled out of the (Zotero-specific) Library
// section because both Zotero imports and Web clips inherit it: the base tag
// holds the properties, and the Web tag extends it. Presets live here, not
// under Zotero, even though the field set is *derived* from Zotero's API.
//
// State is owned by `useSchemaState` (lifted to SetupApp): the base tag + preset
// + custom list span this section, Import Formats, and Web references but share
// one Apply and one notion of "dirty". This section just renders the controls
// and delegates Apply / Delete upward. `baseDirty` is a real diff against the
// last-applied snapshot (not a sticky flag), so the Apply button is disabled
// when nothing schema-relevant has actually changed.
export const SchemaSection = ({
  config,
  schemaReady,
  baseDirty,
  applying,
  deleting,
  onConfigChange,
  onApply,
  onDelete,
}: {
  config: SchemaSnapshot
  schemaReady: boolean | null
  baseDirty: boolean
  applying: boolean
  deleting: boolean
  onConfigChange: (patch: Partial<SchemaSnapshot>) => void
  onApply: () => void
  onDelete: () => void
}) => {
  // Two-click guard for the destructive delete (the former Delete schema cmd).
  const [confirmDelete, setConfirmDelete] = useState(false)

  const status =
    schemaReady === null
      ? ''
      : baseDirty && schemaReady
        ? 'Settings changed. Re-apply to update your graph.'
        : schemaReady
          ? 'Schema applied to your graph.'
          : 'Apply schema to create the tags & properties.'

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Schema</h3>
        <p className="setup-section-desc">
          Properties based on the Zotero API. These are used by both Zotero and
          Web references. Once configured, hit "Apply Schema" at the bottom to
          affect changes.
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="zot-tag">
            Base tag name
          </label>
          <p className="setup-field-hint">
            Tag applied to every reference, regardless of source.
          </p>
          <input
            id="zot-tag"
            className="tagrule-input setup-control"
            value={config.zotTag}
            placeholder="Reference"
            onChange={(e) => onConfigChange({ zotTag: e.target.value })}
          />
        </div>

        <div className="setup-field">
          <span className="setup-field-label">Properties</span>
          <div className="setup-preset-options">
            {PRESETS.map((p) => (
              <label
                key={p.id}
                className={`setup-radio${config.propertyPreset === p.id ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="property-preset"
                  checked={config.propertyPreset === p.id}
                  onChange={() => onConfigChange({ propertyPreset: p.id })}
                />
                <span className="setup-radio-label">{p.label}</span>
                <span className="setup-radio-desc">{p.desc}</span>
              </label>
            ))}
          </div>
          {config.propertyPreset === 'Custom' ? (
            <PropertyPicker
              onChange={(pageProps) => onConfigChange({ pageProps })}
            />
          ) : (
            <PresetFieldList preset={config.propertyPreset} />
          )}
        </div>

        {/* Only offer deletion once a schema exists — nothing to delete (and
            no destructive affordance to dangle) before the first Apply, or
            after a delete. `schemaReady === null` is the in-flight probe → hidden. */}
        {schemaReady === true && (
          <div className="setup-danger">
            <span className="setup-danger-label">Danger zone</span>
            <div className="setup-danger-row">
              <div className="setup-danger-text">
                <span className="setup-danger-title">Delete schema</span>
                <span className="setup-field-hint">
                  Removes every reference property this plugin created. The tag
                  pages (base + Web) are left intact (deleting them would clear
                  their backlinks, so do that manually if you want). You can
                  re-apply afterward.
                </span>
              </div>
              {confirmDelete ? (
                <div className="btn-group">
                  <button
                    type="button"
                    className="btn btn-white"
                    disabled={deleting}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={deleting}
                    onClick={onDelete}
                  >
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger-outline"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete schema
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="setup-section-footer">
        <span className="setup-footer-status">{status}</span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onApply}
          disabled={applying || !baseDirty}
        >
          {applying
            ? 'Applying…'
            : schemaReady
              ? 'Re-apply schema'
              : 'Apply schema'}
        </button>
      </div>
    </>
  )
}
