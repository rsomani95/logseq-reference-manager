import { useState } from 'react'

import {
  COMMON_FIELD_OPTIONS,
  isKnownField,
  OTHER_FIELD_OPTIONS,
} from '../../services/tag-rule-fields'

// Sentinel option value that flips the control into free-text mode.
const CUSTOM = '__custom__'

interface FieldSelectProps {
  value: string
  invalid?: boolean
  /** id of the error message to tie to the control via aria-describedby. */
  errorId?: string
  disabled?: boolean
  onChange: (value: string) => void
}

/**
 * Field chooser for a condition. A native `<select>` of known fields (grouped
 * common-first) gives free keyboard support and friendly labels for the common
 * case; a "Custom field…" option drops to a text input so a forward-compat or
 * unusual field can still be typed — the parser accepts any string. A value
 * loaded from a hand-written rule that isn't in the list opens in custom mode.
 */
export const FieldSelect = ({
  value,
  invalid,
  errorId,
  disabled,
  onChange,
}: FieldSelectProps) => {
  const [custom, setCustom] = useState(value !== '' && !isKnownField(value))

  if (custom) {
    return (
      <span className="tagrule-field-custom">
        <input
          type="text"
          className={`tagrule-input${invalid ? ' is-invalid' : ''}`}
          value={value}
          placeholder="field name"
          aria-label="Custom field name"
          aria-invalid={invalid || undefined}
          aria-describedby={errorId}
          disabled={disabled}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="tagrule-link-btn"
          disabled={disabled}
          onClick={() => {
            setCustom(false)
            onChange('')
          }}
        >
          list
        </button>
      </span>
    )
  }

  return (
    <select
      className={`tagrule-select tagrule-field${invalid ? ' is-invalid' : ''}`}
      value={isKnownField(value) ? value : ''}
      aria-label="Condition field"
      aria-invalid={invalid || undefined}
      aria-describedby={errorId}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value
        if (next === CUSTOM) {
          setCustom(true)
          onChange('')
        } else {
          onChange(next)
        }
      }}
    >
      <option value="" disabled>
        Choose field…
      </option>
      <optgroup label="Common">
        {COMMON_FIELD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="All fields">
        {OTHER_FIELD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
      <option value={CUSTOM}>Custom field…</option>
    </select>
  )
}
