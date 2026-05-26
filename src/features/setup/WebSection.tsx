import { CheckCircle2, Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { isSchemaAdded } from '../../services/is-schema-added'
import { ensureWebTagExtendsBase } from '../../services/set-web-schema'

// The Web references section. Unlike the Zotero sections, the plugin doesn't do
// the work here — the companion web-clipper browser extension does. The
// extension reads these values over Logseq's HTTP API (it can read the plugin's
// live settings but cannot write them), tags each clipped page with the Web
// tag, and uses the rest to shape the page. So this section is a settings form
// for a *consumer that lives in another process*, plus a button to wire the Web
// tag into the shared schema. The keys are a contract — see settings.md.
export const WebSection = () => {
  const baseTag = (logseq.settings?.zotTag as string) ?? 'Reference'

  const [webTag, setWebTag] = useState<string>(
    (logseq.settings?.webTag as string) ?? 'Web',
  )
  const [capture, setCapture] = useState<boolean>(
    (logseq.settings?.webCapturePageContent as boolean) ?? true,
  )
  const [contentBlock, setContentBlock] = useState<string>(
    (logseq.settings?.webPageContentBlockName as string) ?? 'Page Content',
  )
  const [highlightsBlock, setHighlightsBlock] = useState<string>(
    (logseq.settings?.webHighlightsBlockName as string) ?? 'Highlights',
  )
  const [headingMarkers, setHeadingMarkers] = useState<boolean>(
    (logseq.settings?.webUseHeadingMarkers as boolean) ?? false,
  )
  const [pageTags, setPageTags] = useState<boolean>(
    (logseq.settings?.webPopulatePageTags as boolean) ?? false,
  )

  // Wiring the Web tag needs the base class to already exist (Schema → Apply
  // creates it). Probe once so we can gate the button + explain why.
  const [baseReady, setBaseReady] = useState<boolean | null>(null)
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState(false)
  // Web tag edited since the last wiring → the extension's tag won't carry the
  // schema until it's set up again.
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    void isSchemaAdded().then(setBaseReady)
  }, [])

  const onWebTag = (v: string) => {
    setWebTag(v)
    setDirty(true)
    setLinked(false)
    void logseq.updateSettings({ webTag: v })
  }
  const onCapture = (v: boolean) => {
    setCapture(v)
    void logseq.updateSettings({ webCapturePageContent: v })
  }
  const onContentBlock = (v: string) => {
    setContentBlock(v)
    void logseq.updateSettings({ webPageContentBlockName: v })
  }
  const onHighlightsBlock = (v: string) => {
    setHighlightsBlock(v)
    void logseq.updateSettings({ webHighlightsBlockName: v })
  }
  const onHeadingMarkers = (v: boolean) => {
    setHeadingMarkers(v)
    void logseq.updateSettings({ webUseHeadingMarkers: v })
  }
  const onPageTags = (v: boolean) => {
    setPageTags(v)
    void logseq.updateSettings({ webPopulatePageTags: v })
  }

  const setUpWebTag = async () => {
    if (!webTag.trim()) {
      await logseq.UI.showMsg('Enter a web tag name first.', 'warning')
      return
    }
    if (!baseReady) {
      await logseq.UI.showMsg(
        'Apply the shared schema first (Schema section).',
        'warning',
      )
      return
    }
    setLinking(true)
    try {
      // Flush before wiring, in case the change handler's persist is still in
      // flight, then make the tag extend the base so it inherits the schema.
      await logseq.updateSettings({ webTag })
      await ensureWebTagExtendsBase(webTag, baseTag)
      setLinked(true)
      setDirty(false)
      await logseq.UI.showMsg(
        `“#${webTag.trim()}” now extends “${baseTag}” — web clips inherit the schema.`,
        'success',
      )
    } catch (e) {
      await logseq.UI.showMsg(
        `Couldn’t set up the web tag: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    } finally {
      setLinking(false)
    }
  }

  const status =
    baseReady === false
      ? 'Apply the shared schema first (Schema section), then set up the web tag.'
      : dirty
        ? 'Web tag changed — set it up so clips inherit the schema.'
        : linked
          ? `“#${webTag.trim()}” extends “${baseTag}”.`
          : 'Set up the web tag so clipped pages inherit the shared schema.'

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Web references</h3>
        <p className="setup-section-desc">
          Settings for the companion web-clipper browser extension. It reads
          these over Logseq’s API — it can’t edit them, so this is the only
          place they’re set. Clipped pages are tagged with the Web tag and
          inherit the same schema as Zotero imports.
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="web-tag">
            Web tag
          </label>
          <p className="setup-field-hint">
            The tag every clipped page carries. Extends “{baseTag}”, so it
            inherits the shared schema.
          </p>
          <input
            id="web-tag"
            className="tagrule-input setup-control"
            value={webTag}
            placeholder="Web"
            onChange={(e) => onWebTag(e.target.value)}
          />
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={capture}
              onChange={(e) => onCapture(e.target.checked)}
            />
            Capture page content
          </label>
          <p className="setup-field-hint">
            Save the article body as a block on the clipped page.
          </p>
        </div>

        <div className="setup-field">
          <label className="setup-field-label" htmlFor="web-content-block">
            Page content block
          </label>
          <p className="setup-field-hint">
            Heading the article body nests under.
          </p>
          <input
            id="web-content-block"
            className="tagrule-input setup-control"
            value={contentBlock}
            placeholder="Page Content"
            disabled={!capture}
            onChange={(e) => onContentBlock(e.target.value)}
          />
        </div>

        <div className="setup-field">
          <label className="setup-field-label" htmlFor="web-highlights-block">
            Highlights block
          </label>
          <p className="setup-field-hint">Heading highlights nest under.</p>
          <input
            id="web-highlights-block"
            className="tagrule-input setup-control"
            value={highlightsBlock}
            placeholder="Highlights"
            onChange={(e) => onHighlightsBlock(e.target.value)}
          />
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={headingMarkers}
              onChange={(e) => onHeadingMarkers(e.target.checked)}
            />
            Keep heading markers
          </label>
          <p className="setup-field-hint">
            Keep Markdown <code className="inline-code">#</code> markers on
            headings.
          </p>
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={pageTags}
              onChange={(e) => onPageTags(e.target.checked)}
            />
            Populate page tags
          </label>
          <p className="setup-field-hint">
            Pre-fill the page’s tags from the clipped page’s own keywords.
          </p>
        </div>
      </div>

      <div className="setup-section-footer">
        <span className="setup-footer-status">
          {linked && !dirty ? (
            <span className="setup-status is-ok">
              <CheckCircle2 size={15} aria-hidden /> {status}
            </span>
          ) : (
            status
          )}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={setUpWebTag}
          disabled={linking || baseReady !== true}
        >
          <Link2 size={14} aria-hidden />
          {linking ? 'Setting up…' : 'Set up web tag'}
        </button>
      </div>
    </>
  )
}
