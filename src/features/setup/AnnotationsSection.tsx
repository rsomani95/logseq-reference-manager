import { useState } from 'react'

import { LOGSEQ_API_BASE_DEFAULT } from '../../constants'
import { testLogseqApi } from '../../services/logseq-import-edn'

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

// PDF-annotation import. Highlights you made in an external app (Preview / PDF
// Expert / …) are read straight from the file; a PDF annotated only inside
// Zotero falls back to Zotero's database. Either way the marks become
// first-class Logseq highlight blocks. The write goes through Logseq's own
// HTTP API (the only path that can set the highlight's color ref + geometry),
// so it needs the API server's token.
export const AnnotationsSection = () => {
  const [token, setToken] = useState<string>(
    (logseq.settings?.logseqApiToken as string) ?? '',
  )
  const [baseUrl, setBaseUrl] = useState<string>(
    (logseq.settings?.logseqApiBaseUrl as string) ?? LOGSEQ_API_BASE_DEFAULT,
  )
  const [color, setColor] = useState<ColorChoice>(
    (logseq.settings?.annotationColor as ColorChoice) ?? 'auto',
  )
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(
    null,
  )

  const onToken = (v: string) => {
    setToken(v)
    setResult(null)
    void logseq.updateSettings({ logseqApiToken: v })
  }
  const onBaseUrl = (v: string) => {
    setBaseUrl(v)
    setResult(null)
    void logseq.updateSettings({ logseqApiBaseUrl: v })
  }
  const onColor = (v: ColorChoice) => {
    setColor(v)
    void logseq.updateSettings({ annotationColor: v })
  }
  const onTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await testLogseqApi())
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Annotations</h3>
        <p className="setup-section-desc">
          Bring a PDF’s highlights into Logseq as real, linkable highlight
          blocks. Marks made in an external app (Preview, PDF Expert, …) are
          read from the file itself; a PDF annotated only in Zotero falls back
          to Zotero’s database. Runs automatically on import, and on demand via{' '}
          <strong>Zotero: Sync annotations</strong>.
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="annot-token">
            Logseq API token
          </label>
          <input
            id="annot-token"
            className="tagrule-input setup-control"
            value={token}
            placeholder="paste the HTTP APIs Server token"
            onChange={(e) => onToken(e.target.value)}
          />
          <p className="setup-field-hint">
            Required. Writing highlight blocks goes through Logseq’s own
            importer, which is only reachable over its local API. Turn it on at{' '}
            <strong>Logseq → Settings → Features → HTTP APIs Server</strong> and
            copy the authorization token here.
          </p>
          <div className="setup-field-row" style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-white"
              disabled={testing || token.trim().length === 0}
              onClick={() => void onTest()}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {result && (
              <span
                className="setup-field-hint"
                style={{
                  margin: 0,
                  color: result.ok
                    ? 'var(--zot-color-success)'
                    : 'var(--zot-color-danger)',
                }}
              >
                {result.msg}
              </span>
            )}
          </div>
        </div>

        <div className="setup-field">
          <label className="setup-field-label" htmlFor="annot-color">
            Highlight color
          </label>
          <select
            id="annot-color"
            className="tagrule-select setup-control"
            value={color}
            onChange={(e) => onColor(e.target.value as ColorChoice)}
          >
            {COLOR_CHOICES.map((c) => (
              <option key={c} value={c}>
                {c === 'auto' ? 'Auto (match the source)' : c}
              </option>
            ))}
          </select>
          <p className="setup-field-hint">
            Logseq highlights come in five fixed colors. “Auto” snaps each mark
            to the nearest one; pick a color to force every highlight to it
            instead.
          </p>
        </div>

        <details className="setup-field">
          <summary className="setup-field-label" style={{ cursor: 'pointer' }}>
            Advanced
          </summary>
          <div style={{ marginTop: '0.5rem' }}>
            <label className="setup-inline-label" htmlFor="annot-base-url">
              API base URL
            </label>
            <input
              id="annot-base-url"
              className="tagrule-input setup-control"
              value={baseUrl}
              placeholder={LOGSEQ_API_BASE_DEFAULT}
              onChange={(e) => onBaseUrl(e.target.value)}
            />
            <p className="setup-field-hint">
              Change only if you’ve moved Logseq’s HTTP API off its default
              host/port ({LOGSEQ_API_BASE_DEFAULT}).
            </p>
          </div>
        </details>
      </div>
    </>
  )
}
