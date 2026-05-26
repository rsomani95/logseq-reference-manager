import type { PropertyOption } from '../../services/page-props-choice'

/**
 * The grouped property rows shared by the Custom `PropertyPicker` (selectable,
 * with checkboxes) and the read-only `PresetFieldList`. Splits the options into
 * the curated Essentials and everything else and labels each as its own section
 * — the legible replacement for the old per-row "essential" dot (an accent glyph
 * nobody could decode).
 *
 * Rendered inside the parent's `.setup-picker-list` (the scroll container) so the
 * section headers stay stuck while scrolling the ~90-field Full list. Headers
 * show only when BOTH groups are present; a single group (the Essentials preset,
 * or a filter narrowed to one side) renders flat — a lone "Essentials" label over
 * an all-essential list is just noise.
 *
 * Each row is a term + gloss: name and description at one text size, the name in
 * medium weight, the description muted. Hierarchy comes from weight + color, not
 * a size jump, so the pair reads as one glossary entry rather than a heading over
 * a caption (see `.setup-picker-item-text`).
 */
const PropertyRow = ({
  option,
  selectable,
  checked,
  onToggle,
}: {
  option: PropertyOption
  selectable: boolean
  checked: boolean
  onToggle?: (key: string) => void
}) => {
  const body = (
    <span className="setup-picker-item-text">
      <span className="setup-picker-item-name">{option.displayName}</span>
      {option.description && (
        <span className="setup-picker-item-desc">{option.description}</span>
      )}
    </span>
  )

  if (!selectable) {
    return <div className="setup-picker-item is-readonly">{body}</div>
  }

  return (
    <label className="setup-picker-item">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle?.(option.key)}
      />
      {body}
    </label>
  )
}

const SectionHeader = ({ label, count }: { label: string; count: number }) => (
  <div className="setup-picker-section">
    <span className="setup-picker-section-label">{label}</span>
    <span className="setup-picker-section-count">{count}</span>
  </div>
)

export const PropertyList = ({
  options,
  selectable = false,
  selected,
  onToggle,
}: {
  options: PropertyOption[]
  selectable?: boolean
  selected?: Set<string>
  onToggle?: (key: string) => void
}) => {
  const rows = (items: PropertyOption[]) =>
    items.map((o) => (
      <PropertyRow
        key={o.key}
        option={o}
        selectable={selectable}
        checked={selected?.has(o.key) ?? false}
        onToggle={onToggle}
      />
    ))

  const essentials = options.filter((o) => o.isEssential)
  const others = options.filter((o) => !o.isEssential)

  // Both groups present → label each. A single group renders flat (see above).
  if (essentials.length > 0 && others.length > 0) {
    return (
      <>
        <SectionHeader label="Essentials" count={essentials.length} />
        {rows(essentials)}
        <SectionHeader label="All other fields" count={others.length} />
        {rows(others)}
      </>
    )
  }

  return <>{rows(options)}</>
}
