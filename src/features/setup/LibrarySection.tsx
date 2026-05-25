import { useEffect, useState } from 'react'

import type { PropertyPreset } from '../../interfaces'
import { isSchemaAdded } from '../../services/is-schema-added'
import { setLogseqDbSchema } from '../../services/set-logseqdb-schema'
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

export const LibrarySection = ({
  onSchemaChange,
}: {
  onSchemaChange: (ready: boolean) => void
}) => {
  const [zotTag, setZotTag] = useState<string>(
    (logseq.settings?.zotTag as string) ?? 'Reference',
  )
  const [preset, setPreset] = useState<PropertyPreset>(
    (logseq.settings?.propertyPreset as PropertyPreset) ?? 'Essentials',
  )
  const [asNodes, setAsNodes] = useState<boolean>(
    (logseq.settings?.creatorsAsNodes as boolean) ?? true,
  )
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<boolean | null>(null)
  // Tracks edits made since the last apply — schema changes only land in the
  // graph when the user clicks Apply, so we surface a quiet "re-apply" nudge
  // instead of the old global toast.
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    void isSchemaAdded().then(setApplied)
  }, [])

  const onTag = (v: string) => {
    setZotTag(v)
    setDirty(true)
    void logseq.updateSettings({ zotTag: v })
  }
  const onPreset = (v: PropertyPreset) => {
    setPreset(v)
    setDirty(true)
    void logseq.updateSettings({ propertyPreset: v })
  }
  const onAsNodes = (v: boolean) => {
    setAsNodes(v)
    setDirty(true)
    void logseq.updateSettings({ creatorsAsNodes: v })
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
      // PropertyPicker on toggle.)
      await logseq.updateSettings({
        zotTag,
        propertyPreset: preset,
        creatorsAsNodes: asNodes,
      })
      await setLogseqDbSchema()
      const ready = await isSchemaAdded()
      setApplied(ready)
      setDirty(false)
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

  const status =
    applied === null
      ? ''
      : dirty && applied
        ? 'Settings changed — re-apply to update your graph.'
        : applied
          ? 'Schema applied to your graph.'
          : 'Not applied yet — apply to create the tag & properties.'

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Library</h3>
        <p className="setup-section-desc">
          Choose the tag and properties imported pages carry, then apply the
          schema to your graph.
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="zot-tag">
            Tag name
          </label>
          <p className="setup-field-hint">
            Every imported page is tagged with this.
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
          {preset === 'Custom' && <PropertyPicker />}
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
            Each author becomes its own page, so you can jump from an author to
            all their works. Off = store them as plain text.
          </p>
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
