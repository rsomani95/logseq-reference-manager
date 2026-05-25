import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { PropertyPreset } from '../../interfaces'
import { buildPropertyOptions } from '../../services/page-props-choice'

/**
 * Read-only disclosure of the fields a fixed preset applies. Essentials is a
 * curated subset — "what's in it?" isn't obvious — and Full is everything;
 * neither is editable, so this just lets the user inspect the list without
 * having to switch to Custom (and risk forgetting to switch back). Custom has
 * its own interactive `PropertyPicker` instead. Rows mirror the picker's
 * styling, minus the checkboxes.
 */
export const PresetFieldList = ({
  preset,
}: {
  preset: Exclude<PropertyPreset, 'Custom'>
}) => {
  const [open, setOpen] = useState(false)
  const options = useMemo(() => {
    const all = buildPropertyOptions()
    return preset === 'Essentials' ? all.filter((o) => o.isEssential) : all
  }, [preset])

  return (
    <div className="setup-fieldlist">
      <button
        type="button"
        className="setup-disclosure"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          size={14}
          aria-hidden
          className={`setup-disclosure-chevron${open ? ' is-open' : ''}`}
        />
        {open ? 'Hide fields' : `Show the ${options.length} included fields`}
      </button>
      {open && (
        <div className="setup-picker">
          <div className="setup-picker-list">
            {options.map((o) => (
              <div key={o.key} className="setup-picker-item is-readonly">
                <span className="setup-picker-item-text">
                  <span className="setup-picker-item-name">
                    {o.displayName}
                    {/* In Full, flag the curated ones; in Essentials they all
                        are, so the badge would be noise. */}
                    {preset === 'Full' && o.isEssential && (
                      <span className="setup-picker-badge">essential</span>
                    )}
                  </span>
                  {o.description && (
                    <span className="setup-picker-item-desc">
                      {o.description}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
