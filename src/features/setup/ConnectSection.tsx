import { CheckCircle2, Info, RefreshCw, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

import { LOGSEQ_API_BASE_DEFAULT } from '../../constants'
import { testZotConnection } from '../../services/get-zot-items'
import { testLogseqApi } from '../../services/logseq-import-edn'
import type { ConnResult, LogseqConnResult } from './index'

// 3-4 line setup walkthrough for the Logseq HTTP API, linked from the failure
// help below so non-technical users have somewhere to go. Lives in the repo so
// it can grow without shipping a new plugin build.
const HTTP_API_DOC_URL =
  'https://github.com/rsomani95/logseq-reference-manager/blob/main/docs/logseq-http-api.md'

// Both local services the plugin talks to: Zotero (reads the library) and
// Logseq's own HTTP API (writes PDF highlights back in). The nav tick only goes
// green when both are live, so each gets its own status + test here.
export const ConnectSection = ({
  zot,
  logseqConn,
  onZotResult,
  onLogseqResult,
}: {
  zot: ConnResult | null
  logseqConn: LogseqConnResult | null
  onZotResult: (r: ConnResult) => void
  onLogseqResult: (r: LogseqConnResult) => void
}) => {
  // --- Zotero ---
  const [zotResult, setZotResult] = useState<ConnResult | null>(zot)
  const [zotTesting, setZotTesting] = useState(false)
  // The parent probe may resolve after this mounts — adopt its result.
  useEffect(() => {
    if (zot) setZotResult(zot)
  }, [zot])

  const testZot = async () => {
    setZotTesting(true)
    const r = await testZotConnection()
    setZotResult(r)
    onZotResult(r)
    setZotTesting(false)
  }
  const zotOk = zotResult?.code === 'success'

  // --- Logseq HTTP API ---
  const [token, setToken] = useState<string>(
    (logseq.settings?.logseqApiToken as string) ?? '',
  )
  const [baseUrl, setBaseUrl] = useState<string>(
    (logseq.settings?.logseqApiBaseUrl as string) ?? LOGSEQ_API_BASE_DEFAULT,
  )
  const [lsResult, setLsResult] = useState<LogseqConnResult | null>(logseqConn)
  const [lsTesting, setLsTesting] = useState(false)
  // Adopt the parent probe (including its `null` while still in flight). Local
  // edits below set `lsResult` to null without touching the parent, so this only
  // refires when the parent itself re-probes or records a test result.
  useEffect(() => {
    setLsResult(logseqConn)
  }, [logseqConn])

  const onToken = (v: string) => {
    setToken(v)
    setLsResult(null) // status is stale until re-tested
    void logseq.updateSettings({ logseqApiToken: v })
  }
  const onBaseUrl = (v: string) => {
    setBaseUrl(v)
    setLsResult(null)
    void logseq.updateSettings({ logseqApiBaseUrl: v })
  }
  const testLs = async () => {
    setLsTesting(true)
    setLsResult(null)
    try {
      const r = await testLogseqApi()
      setLsResult(r)
      onLogseqResult(r)
    } finally {
      setLsTesting(false)
    }
  }
  const lsOk = lsResult?.ok === true

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Connections</h3>
        <p className="setup-section-desc">
          The plugin talks to two local services: <strong>Zotero</strong>, to
          read your library, and <strong>Logseq's own HTTP API</strong>, to
          import PDF annotations as highlight blocks. Set up both below.
        </p>
      </div>

      <div className="setup-section-body">
        {/* ---------- Zotero ---------- */}
        <section className="setup-conn">
          <h4 className="setup-conn-title">Zotero</h4>
          <p className="setup-field-hint">
            Reads your library over its local API at{' '}
            <code className="inline-code">127.0.0.1:23119</code>. Keep Zotero 7+
            open while you import.
          </p>

          {zotResult === null ? (
            <div className="setup-status">
              <span className="spinner" />
              <div className="setup-status-text">Checking connection…</div>
            </div>
          ) : zotOk ? (
            <div className="setup-status is-ok">
              <CheckCircle2 size={18} aria-hidden />
              <div className="setup-status-text">Connected to Zotero.</div>
            </div>
          ) : (
            <>
              <div className="setup-status is-error">
                <XCircle size={18} aria-hidden />
                <div className="setup-status-text">
                  Can't reach Zotero.
                  <span className="setup-status-sub">
                    Make sure Zotero 7+ is open, then test again.
                  </span>
                </div>
              </div>

              <div className="setup-help">
                <span className="setup-help-label">How to connect</span>
                <ol className="setup-steps">
                  <li>
                    Make sure you have <strong>Zotero 7 or later</strong>, and
                    that it's open.
                  </li>
                  <li>
                    Keep Zotero running while you import — references are read
                    directly from it, with no cloud sync.
                  </li>
                  <li>
                    In Zotero, open <strong>Settings → Advanced</strong> and
                    turn on{' '}
                    <strong>
                      "Allow other applications on this computer to communicate
                      with Zotero."
                    </strong>
                  </li>
                  <li>
                    The plugin connects locally at{' '}
                    <code className="inline-code">127.0.0.1:23119</code>. If
                    you've changed Zotero's port or a firewall is blocking it,
                    the connection will fail.
                  </li>
                </ol>
                <button
                  type="button"
                  className="setup-help-link"
                  onClick={() =>
                    void logseq.App.openExternalLink(
                      'https://www.zotero.org/support/dev/web_api/v3/start',
                    )
                  }
                >
                  Zotero local API documentation ↗
                </button>
              </div>
            </>
          )}

          <div className="setup-field-row">
            <button
              type="button"
              className="btn btn-white"
              onClick={testZot}
              disabled={zotTesting}
            >
              <RefreshCw size={14} aria-hidden />
              {zotTesting ? 'Testing…' : 'Test connection'}
            </button>
          </div>
        </section>

        {/* ---------- Logseq HTTP API ---------- */}
        <section className="setup-conn">
          <h4 className="setup-conn-title">Logseq HTTP API</h4>

          <div className="setup-field">
            <label className="setup-field-label" htmlFor="ls-token">
              API token
            </label>
            <input
              id="ls-token"
              className="tagrule-input setup-control"
              value={token}
              placeholder="paste the HTTP APIs Server token"
              onChange={(e) => onToken(e.target.value)}
            />
            <p className="setup-field-hint">
              Needed to <strong>sync PDF annotations</strong>. Highlight blocks
              are written through Logseq's own importer, which is only reachable
              over its local API.
            </p>
          </div>

          {lsTesting ? (
            <div className="setup-status">
              <span className="spinner" />
              <div className="setup-status-text">Testing connection…</div>
            </div>
          ) : lsResult === null ? (
            logseqConn === null ? (
              <div className="setup-status">
                <span className="spinner" />
                <div className="setup-status-text">Checking connection…</div>
              </div>
            ) : (
              <div className="setup-status">
                <Info size={18} aria-hidden />
                <div className="setup-status-text">
                  Not tested yet.
                  <span className="setup-status-sub">
                    Run Test connection below to check the token.
                  </span>
                </div>
              </div>
            )
          ) : lsOk ? (
            <div className="setup-status is-ok">
              <CheckCircle2 size={18} aria-hidden />
              <div className="setup-status-text">Connected to Logseq.</div>
            </div>
          ) : (
            <>
              <div className="setup-status is-error">
                <XCircle size={18} aria-hidden />
                <div className="setup-status-text">
                  {lsResult.msg}
                  <span className="setup-status-sub">
                    Turn on Logseq's HTTP API server and paste its token above.
                  </span>
                </div>
              </div>

              <div className="setup-help">
                <span className="setup-help-label">How to connect</span>
                <ol className="setup-steps">
                  <li>
                    In Logseq, open <strong>Settings → Features</strong> and
                    enable <strong>HTTP APIs Server</strong>.
                  </li>
                  <li>
                    Open the <strong>API</strong> panel and click{' '}
                    <strong>Start Server</strong>.
                  </li>
                  <li>
                    Under <strong>Authorization tokens</strong>, click{' '}
                    <strong>Add new token</strong> (any name).
                  </li>
                  <li>Copy the token into the field above, then test again.</li>
                </ol>
                <button
                  type="button"
                  className="setup-help-link"
                  onClick={() =>
                    void logseq.App.openExternalLink(HTTP_API_DOC_URL)
                  }
                >
                  Setting up Logseq's HTTP API ↗
                </button>
              </div>
            </>
          )}

          <details className="setup-field">
            <summary
              className="setup-field-label"
              style={{ cursor: 'pointer' }}
            >
              Advanced
            </summary>
            <div style={{ marginTop: '0.5rem' }}>
              <label className="setup-inline-label" htmlFor="ls-base-url">
                API base URL
              </label>
              <input
                id="ls-base-url"
                className="tagrule-input setup-control"
                value={baseUrl}
                placeholder={LOGSEQ_API_BASE_DEFAULT}
                onChange={(e) => onBaseUrl(e.target.value)}
              />
              <p className="setup-field-hint">
                Change only if you've moved Logseq's HTTP API off its default
                host/port ({LOGSEQ_API_BASE_DEFAULT}).
              </p>
            </div>
          </details>

          <div className="setup-field-row">
            <button
              type="button"
              className="btn btn-white"
              onClick={testLs}
              disabled={lsTesting || token.trim().length === 0}
            >
              <RefreshCw size={14} aria-hidden />
              {lsTesting ? 'Testing…' : 'Test connection'}
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
