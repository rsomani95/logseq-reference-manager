import { AlertTriangle } from 'lucide-react'
import { type CSSProperties, useState } from 'react'

import {
  ANNOTATION_COLOR_CHOICES,
  ANNOTATION_COLOR_TARGETS,
  type AnnotationColorChoice,
} from '../../constants'
import { hexOf, LOGSEQ_PALETTE } from '../../services/pdf-annot/colors'
import type { LogseqConnResult } from './index'

type ColorChoice = AnnotationColorChoice

// Capitalised display name; the stored setting value stays lowercase.
const label = (c: ColorChoice) => c.charAt(0).toUpperCase() + c.slice(1)

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

// The swatch row: a radiogroup of color dots (auto + Logseq's five). The hidden
// native radio carries semantics + arrow-key nav; the swatch + label carry the
// look. `name` must be unique per row so independent rows don't share a group.
const ColorPicker = ({
  value,
  onChange,
  name,
  labelId,
}: {
  value: ColorChoice
  onChange: (v: ColorChoice) => void
  name: string
  labelId: string
}) => (
  <div
    className="annot-color-picker"
    role="radiogroup"
    aria-labelledby={labelId}
  >
    {ANNOTATION_COLOR_CHOICES.map((c) => (
      <label key={c} className="annot-color-opt annot-swatch-opt">
        <input
          type="radio"
          name={name}
          value={c}
          checked={value === c}
          onChange={() => onChange(c)}
        />
        <span
          className="annot-color-swatch"
          style={swatchStyle(c)}
          aria-hidden="true"
        />
        <span className="annot-color-name">{label(c)}</span>
      </label>
    ))}
  </div>
)

// PDF-annotation import. Highlights you made in an external app (Preview / PDF
// Expert / …) are read straight from the file; a PDF annotated only inside
// Zotero falls back to Zotero's database. Either way the marks become
// first-class Logseq highlight blocks. The enabling Logseq API token lives in
// the Connections section (the write goes through Logseq's own HTTP API); this
// section just configures how the highlights look — one color for all marks, or
// (opt-in) a color per annotation type.
export const AnnotationsSection = ({
  logseqConn,
  onGoToConnections,
}: {
  // Last probe/test of Logseq's HTTP API (lifted in SetupApp). `null` while the
  // probe is still in flight.
  logseqConn: LogseqConnResult | null
  onGoToConnections: () => void
}) => {
  const [color, setColor] = useState<ColorChoice>(
    (logseq.settings?.annotationColor as ColorChoice) ?? 'auto',
  )
  const [perType, setPerType] = useState<boolean>(
    (logseq.settings?.annotationColorPerType as boolean) ?? false,
  )
  // One stored color per category target (markup / text / note), keyed by the
  // target's setting key.
  const [byType, setByType] = useState<Record<string, ColorChoice>>(() => {
    const init: Record<string, ColorChoice> = {}
    for (const t of ANNOTATION_COLOR_TARGETS) {
      init[t.key] = (logseq.settings?.[t.key] as ColorChoice) ?? 'auto'
    }
    return init
  })
  // Fold the PDF block on import so its highlights start tucked away (default
  // on). Only affects the initial import; re-sync leaves the fold state alone.
  const [collapse, setCollapse] = useState<boolean>(
    logseq.settings?.annotationCollapseOnImport !== false,
  )

  const onColor = (v: ColorChoice) => {
    setColor(v)
    void logseq.updateSettings({ annotationColor: v })
  }
  const onPerType = (v: boolean) => {
    setPerType(v)
    void logseq.updateSettings({ annotationColorPerType: v })
  }
  const onByType = (key: string, v: ColorChoice) => {
    setByType((m) => ({ ...m, [key]: v }))
    void logseq.updateSettings({ [key]: v })
  }
  const onCollapse = (v: boolean) => {
    setCollapse(v)
    void logseq.updateSettings({ annotationCollapseOnImport: v })
  }

  // The whole write path goes through Logseq's HTTP API, so import is dead
  // without a working token. Only nag once the probe has resolved to "not
  // connected" — stay quiet while it's in flight (null) or live (ok).
  const apiDown = logseqConn !== null && !logseqConn.ok

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
        {apiDown && (
          <div className="setup-status is-warn">
            <AlertTriangle size={16} aria-hidden />
            <div className="setup-status-text">
              Annotation import is off
              <span className="setup-status-sub">
                It needs Logseq's HTTP API. Set its token under Connections to
                turn it on.
              </span>
            </div>
            <button
              type="button"
              className="btn btn-white setup-gate-action"
              onClick={onGoToConnections}
            >
              Go to Connections
            </button>
          </div>
        )}

        <div className="setup-field">
          <span className="setup-field-label" id="annot-color-label">
            Highlight color
          </span>

          {!perType && (
            <>
              <ColorPicker
                value={color}
                onChange={onColor}
                name="annot-color"
                labelId="annot-color-label"
              />
              <p className="setup-field-hint">
                Logseq highlights come in five fixed colors. "Auto" snaps each
                mark to the nearest one; pick a color to force every highlight
                to it instead.
              </p>
            </>
          )}

          <label className="checkbox-label annot-color-toggle">
            <input
              type="checkbox"
              checked={perType}
              onChange={(e) => onPerType(e.target.checked)}
            />
            Set a color per annotation type
          </label>
          <p className="setup-field-hint">
            {perType
              ? 'Each kind of mark gets its own color. "Auto" snaps that kind to the nearest Logseq color.'
              : 'Give highlights, on-page text, and sticky notes their own colors instead of one for all.'}
          </p>

          {perType && (
            <div className="annot-color-table">
              {/* Column headers: the color names, shown once for the whole table. */}
              <span aria-hidden="true" />
              {ANNOTATION_COLOR_CHOICES.map((c) => (
                <span
                  key={c}
                  className="annot-color-col-head"
                  aria-hidden="true"
                >
                  {label(c)}
                </span>
              ))}

              {/* One radiogroup row per category; cells align under the headers. */}
              {ANNOTATION_COLOR_TARGETS.map((t) => (
                <div
                  key={t.key}
                  className="annot-color-row"
                  role="radiogroup"
                  aria-label={t.label}
                >
                  <span className="annot-color-row-label">{t.label}</span>
                  {ANNOTATION_COLOR_CHOICES.map((c) => (
                    <label
                      key={c}
                      className="annot-color-cell annot-swatch-opt"
                    >
                      <input
                        type="radio"
                        name={t.key}
                        value={c}
                        checked={(byType[t.key] ?? 'auto') === c}
                        onChange={() => onByType(t.key, c)}
                        aria-label={label(c)}
                      />
                      <span
                        className="annot-color-swatch"
                        style={swatchStyle(c)}
                        aria-hidden="true"
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={collapse}
              onChange={(e) => onCollapse(e.target.checked)}
            />
            Collapse highlights on import
          </label>
          <p className="setup-field-hint">
            Fold the PDF block after importing so its highlights start tucked
            away. The count stays visible; expand the PDF to read them. Only
            applies on import, not when you re-sync.
          </p>
        </div>
      </div>
    </>
  )
}
