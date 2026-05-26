import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { PropertyPreset } from '../../interfaces'
import { buildPropertyOptions } from '../../services/page-props-choice'
import { PropertyList } from './PropertyList'

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
            {/* Full → Essentials + "All other fields" sections; the Essentials
                preset is all-essential, so PropertyList renders it flat. */}
            <PropertyList options={options} />
          </div>
        </div>
      )}
    </div>
  )
}
