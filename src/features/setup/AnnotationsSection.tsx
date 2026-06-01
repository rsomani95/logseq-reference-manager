import { Info } from 'lucide-react'
import { type CSSProperties, useState } from 'react'

import { hexOf, LOGSEQ_PALETTE } from '../../services/pdf-annot/colors'

// Highlight colors Logseq supports, plus "auto" (nearest-pastel mapping from the
// source annotation's color). Matches the `annotationColor` enum in settings.ts.
const COLOR_CHOICES = [
  'auto',
  'yellow',
  'red',
  'green',
  'blue',
  'purple',
] as const
type ColorChoice = (typeof COLOR_CHOICES)[number]

// Capitalised display names; the stored setting value stays lowercase.
const COLOR_LABELS: Record<ColorChoice, string> = {
  auto: 'Auto',
  yellow: 'Yellow',
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
}

// Each swatch is painted from Logseq's real fixed highlight palette
// (LOGSEQ_PALETTE), so the dot is exactly the color the highlight will take.
// "auto" has no single color — it snaps each mark to the nearest one — so its
// dot is split into five equal wedges, one per palette color.
const swatchStyle = (c: ColorChoice): CSSProperties => {
  if (c === 'auto') {
    const order = ['yellow', 'green', 'blue', 'purple', 'red'] as const
    const step = 360 / order.length
    const wedges = order
      .map(
        (n, i) =>
          `${hexOf(LOGSEQ_PALETTE[n])} ${i * step}deg ${(i + 1) * step}deg`,
      )
      .join(', ')
    return { background: `conic-gradient(${wedges})` }
  }
  return { background: hexOf(LOGSEQ_PALETTE[c]) ?? undefined }
}

// PDF-annotation import. Highlights you made in an external app (Preview / PDF
// Expert / …) are read straight from the file; a PDF annotated only inside
// Zotero falls back to Zotero's database. Either way the marks become
// first-class Logseq highlight blocks. The enabling Logseq API token lives in
// the Connections section (the write goes through Logseq's own HTTP API); this
// section just configures how the highlights look.
export const AnnotationsSection = ({
  onGoToConnections,
}: {
  onGoToConnections: () => void
}) => {
  const [color, setColor] = useState<ColorChoice>(
    (logseq.settings?.annotationColor as ColorChoice) ?? 'auto',
  )

  const onColor = (v: ColorChoice) => {
    setColor(v)
    void logseq.updateSettings({ annotationColor: v })
  }

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Annotations</h3>
        <p className="setup-section-desc">
          Bring a PDF's highlights into Logseq as real, linkable highlight
          blocks. Marks made in an external app (Preview, PDF Expert, …) are
          read from the file itself; a PDF annotated only in Zotero falls back
          to Zotero's database. Runs automatically on import, and on demand via{' '}
          <strong>Zotero: Sync annotations</strong>.
        </p>
      </div>

      <div className="setup-section-body">
        <div>
          <div className="setup-status">
            <Info size={18} aria-hidden />
            <div className="setup-status-text">
              Annotation import needs Logseq's HTTP API.
              <span className="setup-status-sub">
                Set its token under Connections to turn it on.
              </span>
            </div>
          </div>
          <button
            type="button"
            className="setup-help-link"
            onClick={onGoToConnections}
          >
            Open Connections →
          </button>
        </div>

        <div className="setup-field">
          <span className="setup-field-label" id="annot-color-label">
            Highlight color
          </span>
          <div
            className="annot-color-picker"
            role="radiogroup"
            aria-labelledby="annot-color-label"
          >
            {COLOR_CHOICES.map((c) => (
              <label key={c} className="annot-color-opt">
                <input
                  type="radio"
                  name="annot-color"
                  value={c}
                  checked={color === c}
                  onChange={() => onColor(c)}
                />
                <span
                  className="annot-color-swatch"
                  style={swatchStyle(c)}
                  aria-hidden="true"
                />
                <span className="annot-color-name">{COLOR_LABELS[c]}</span>
              </label>
            ))}
          </div>
          <p className="setup-field-hint">
            Logseq highlights come in five fixed colors. "Auto" snaps each mark
            to the nearest one; pick a color to force every highlight to it
            instead.
          </p>
        </div>
      </div>
    </>
  )
}
