import { useEffect, useState } from 'react'

import type { PropertyPreset } from '../../interfaces'
import { deleteZoteroSchema } from '../../services/delete-zotero-schema'
import { isSchemaAdded } from '../../services/is-schema-added'
import { setLogseqDbSchema } from '../../services/set-logseqdb-schema'
import { PresetFieldList } from './PresetFieldList'
import { PropertyPicker } from './PropertyPicker'

const PRESETS: { id: PropertyPreset; label: string; desc: string }[] = [
  {
    id: 'Essentials',
    label: 'Essentials',
    desc: 'Common citation fields for papers & articles.',
  },
  { id: 'Full', label: 'Full', desc: 'Every available Zotero field.' },
  { id: 'Custom', label: 'Custom', desc: 'Pick exactly the fields you want.' },
]

// The shared property schema. Pulled out of the (Zotero-specific) Library
// section because both Zotero imports and Web clips inherit it: the base tag
// holds the properties, and the Web tag extends it. Presets live here, not
// under Zotero, even though the field set is *derived* from Zotero's API.
export const SchemaSection = ({
  onSchemaChange,
  schemaDirty,
  onSchemaDirty,
}: {
  onSchemaChange: (ready: boolean) => void
  // `schemaDirty` is lifted to SetupApp: a schema-affecting change in another
  // section (Import formats' "store creators as page references", or the web
  // tag) still raises this section's quiet "re-apply" nudge, and the flag
  // survives navigating away and back (a section remount would otherwise reset
  // a local flag).
  schemaDirty: boolean
  onSchemaDirty: (dirty: boolean) => void
}) => {
  const [zotTag, setZotTag] = useState<string>(
    (logseq.settings?.zotTag as string) ?? 'Reference',
  )
  const [preset, setPreset] = useState<PropertyPreset>(
    (logseq.settings?.propertyPreset as PropertyPreset) ?? 'Essentials',
  )
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<boolean | null>(null)
  // Two-click guard for the destructive delete (the former Delete schema cmd).
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    void isSchemaAdded().then(setApplied)
  }, [])

  const onTag = (v: string) => {
    setZotTag(v)
    onSchemaDirty(true)
    void logseq.updateSettings({ zotTag: v })
  }
  const onPreset = (v: PropertyPreset) => {
    setPreset(v)
    onSchemaDirty(true)
    void logseq.updateSettings({ propertyPreset: v })
  }

  const apply = async () => {
    if (!zotTag.trim()) {
      await logseq.UI.showMsg('Enter a tag name first.', 'warning')
      return
    }
    setApplying(true)
    try {
      // The change handlers fire-and-forget updateSettings; flush this
      // section's values before setLogseqDbSchema reads them back, so a quick
      // change-then-apply can't race the persist. (pageProps is flushed by the
      // PropertyPicker, creatorsAsNodes by the Import-formats section, webTag by
      // the Web references section.)
      await logseq.updateSettings({
        zotTag,
        propertyPreset: preset,
      })
      await setLogseqDbSchema()
      const ready = await isSchemaAdded()
      setApplied(ready)
      onSchemaDirty(false)
      onSchemaChange(ready)
    } catch (e) {
      await logseq.UI.showMsg(
        `Schema setup failed: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    } finally {
      setApplying(false)
    }
  }

  const doDelete = async () => {
    setDeleting(true)
    try {
      const removed = await deleteZoteroSchema()
      // Re-derive applied state from the graph rather than assuming success.
      const stillThere = await isSchemaAdded()
      setApplied(stillThere)
      onSchemaDirty(false)
      onSchemaChange(stillThere)
      if (stillThere) {
        await logseq.UI.showMsg(
          removed > 0
            ? `Removed ${removed}, but some reference properties remain — see the console.`
            : 'Couldn’t remove the reference properties — see the console.',
          'warning',
        )
      } else {
        await logseq.UI.showMsg(
          removed > 0
            ? `Removed ${removed} reference ${removed === 1 ? 'property' : 'properties'}.`
            : 'No reference properties to remove.',
          'success',
        )
      }
    } catch (e) {
      await logseq.UI.showMsg(
        `Couldn't delete schema: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const status =
    applied === null
      ? ''
      : schemaDirty && applied
        ? 'Settings changed — re-apply to update your graph.'
        : applied
          ? 'Schema applied to your graph.'
          : 'Not applied yet — apply to create the tags & properties.'

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Schema</h3>
        <p className="setup-section-desc">
          The shared property schema every reference carries — derived from
          Zotero's fields and inherited by both Zotero imports and Web clips.
          Choose the base tag and properties, then apply the schema to your
          graph.
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="zot-tag">
            Base tag
          </label>
          <p className="setup-field-hint">
            Every reference page carries this. The Web tag extends it, so it
            inherits the same schema.
          </p>
          <input
            id="zot-tag"
            className="tagrule-input setup-control"
            value={zotTag}
            placeholder="Reference"
            onChange={(e) => onTag(e.target.value)}
          />
        </div>

        <div className="setup-field">
          <span className="setup-field-label">Properties</span>
          <div className="setup-preset-options">
            {PRESETS.map((p) => (
              <label
                key={p.id}
                className={`setup-radio${preset === p.id ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="property-preset"
                  checked={preset === p.id}
                  onChange={() => onPreset(p.id)}
                />
                <span className="setup-radio-label">{p.label}</span>
                <span className="setup-radio-desc">{p.desc}</span>
              </label>
            ))}
          </div>
          {preset === 'Custom' ? (
            <PropertyPicker onSchemaDirty={() => onSchemaDirty(true)} />
          ) : (
            <PresetFieldList preset={preset} />
          )}
        </div>

        <div className="setup-danger">
          <span className="setup-danger-label">Danger zone</span>
          <div className="setup-danger-row">
            <div className="setup-danger-text">
              <span className="setup-danger-title">Delete schema</span>
              <span className="setup-field-hint">
                Removes every reference property this plugin created. The tag
                pages (base + Web) are left intact (deleting them would clear
                their backlinks — do that manually if you want). You can
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
                  onClick={doDelete}
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
      </div>

      <div className="setup-section-footer">
        <span className="setup-footer-status">{status}</span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={apply}
          disabled={applying}
        >
          {applying
            ? 'Applying…'
            : applied
              ? 'Re-apply schema'
              : 'Apply schema'}
        </button>
      </div>
    </>
  )
}
