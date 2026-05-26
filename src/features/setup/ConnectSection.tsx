import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

import { testZotConnection } from '../../services/get-zot-items'
import type { ConnResult } from './index'

export const ConnectSection = ({
  initial,
  onResult,
}: {
  initial: ConnResult | null
  onResult: (r: ConnResult) => void
}) => {
  const [result, setResult] = useState<ConnResult | null>(initial)
  const [testing, setTesting] = useState(false)

  // The parent probe may resolve after this mounts — adopt its result.
  useEffect(() => {
    if (initial) setResult(initial)
  }, [initial])

  const test = async () => {
    setTesting(true)
    const r = await testZotConnection()
    setResult(r)
    onResult(r)
    setTesting(false)
  }

  const ok = result?.code === 'success'

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Connection</h3>
        <p className="setup-section-desc">
          The plugin talks to a running Zotero 7+ instance over its local API at{' '}
          <code className="inline-code">127.0.0.1:23119</code>. Keep Zotero open
          while you import.
        </p>
      </div>

      <div className="setup-section-body">
        {result === null ? (
          <div className="setup-status">
            <span className="spinner" />
            <div className="setup-status-text">Checking connection…</div>
          </div>
        ) : ok ? (
          <div className="setup-status is-ok">
            <CheckCircle2 size={18} aria-hidden />
            <div className="setup-status-text">Connected to Zotero.</div>
          </div>
        ) : (
          <>
            <div className="setup-status is-error">
              <XCircle size={18} aria-hidden />
              <div className="setup-status-text">
                Can’t reach Zotero.
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
                  that it’s open.
                </li>
                <li>
                  Keep Zotero running while you import — references are read
                  directly from it, with no cloud sync.
                </li>
                <li>
                  In Zotero, open <strong>Settings → Advanced</strong> and turn
                  on{' '}
                  <strong>
                    “Allow other applications on this computer to communicate
                    with Zotero.”
                  </strong>
                </li>
                <li>
                  The plugin connects locally at{' '}
                  <code className="inline-code">127.0.0.1:23119</code>. If
                  you’ve changed Zotero’s port or a firewall is blocking it, the
                  connection will fail.
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
      </div>

      <div className="setup-section-footer">
        <span className="setup-footer-status" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={test}
          disabled={testing}
        >
          <RefreshCw size={14} aria-hidden />
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>
    </>
  )
}
