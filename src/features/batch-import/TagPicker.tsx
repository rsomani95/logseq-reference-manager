import { X } from 'lucide-react'
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { listNavIntent } from '../../keyboard'
import { computeTagOptions } from '../../services/tag-suggestions'

interface TagPickerProps {
  value: string[]
  onChange: (next: string[]) => void
  suggestions: string[]
  disabled?: boolean
  label?: string
  placeholder?: string
}

export const TagPicker = ({
  value,
  onChange,
  suggestions,
  disabled = false,
  label = 'Extra tags to apply',
  placeholder = 'Add a tag',
}: TagPickerProps) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-opt-${i}`

  const options = useMemo(
    () => computeTagOptions(suggestions, value, query),
    [suggestions, value, query],
  )

  // Reset the active row whenever the option set changes shape.
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const addTag = (tag: string) => {
    const t = tag.trim()
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) {
      onChange([...value, t])
    }
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
    // Return focus to the input so it's never lost to <body> when a chip in
    // the middle of the row unmounts (keeps the modal's focus trap satisfied).
    inputRef.current?.focus()
  }

  const commitActive = () => {
    const opt = options[activeIndex]
    if (opt) addTag(opt.value)
    else {
      const t = query.trim()
      if (t) addTag(t)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const nav = listNavIntent(e)
    if (nav) {
      e.preventDefault()
      e.stopPropagation()
      if (!open) setOpen(true)
      const last = Math.max(0, options.length - 1)
      const next =
        nav === 'down'
          ? Math.min(activeIndex + 1, last)
          : Math.max(activeIndex - 1, 0)
      setActiveIndex(next)
      // Keep the keyboard-active row visible, like SearchItem and the batch
      // list — the dropdown scrolls past its max-height once tags pile up.
      document
        .getElementById(optionId(next))
        ?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      commitActive()
      return
    }
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (e.key === ' ') {
      // Let the space type into the input, but never reach the batch root toggle.
      e.stopPropagation()
      return
    }
    if (e.key === 'Backspace' && query === '' && value.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      onChange(value.slice(0, -1))
    }
  }

  const activeId = options.length > 0 ? optionId(activeIndex) : undefined

  return (
    <div className="tag-picker">
      {/* Click-to-focus wrapper: focus is delegated to the inner input, which
          is the real combobox and is fully keyboard-driven; the wrapper only
          widens the click target. */}
      <div
        className="tag-picker-control"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="tag-picker-chip">
            {tag}
            <button
              type="button"
              className="tag-picker-chip-remove"
              aria-label={`Remove ${tag}`}
              disabled={disabled}
              onClick={() => removeTag(tag)}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="tag-picker-input"
          value={query}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-label={label}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && options.length > 0 && (
        <ul className="tag-picker-dropdown" id={listboxId} role="listbox">
          {options.map((opt, i) => (
            <li
              key={opt.kind === 'create' ? `__create__${opt.value}` : opt.value}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={`tag-picker-option${
                i === activeIndex ? ' is-active' : ''
              }${opt.kind === 'create' ? ' tag-picker-create' : ''}`}
              // onMouseDown (not onClick) so the input's onBlur doesn't fire and
              // close the list before the pick is handled.
              onMouseDown={(e) => {
                e.preventDefault()
                addTag(opt.value)
              }}
            >
              {opt.kind === 'create' ? (
                <>
                  Create{' '}
                  <span className="tag-picker-create-name">"{opt.value}"</span>
                </>
              ) : (
                opt.value
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
