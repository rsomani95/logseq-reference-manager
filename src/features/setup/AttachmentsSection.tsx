import { useState } from 'react'

import {
  ATTACHMENT_EXTERNAL_PDF_LABEL_DEFAULT,
  ATTACHMENT_IMPORT_MODES,
  ATTACHMENTS_BLOCK_NAME_DEFAULT,
  type AttachmentImportMode,
} from '../../constants'

// Zotero-only: how attachments are pulled into the page. Defaults are tuned for
// the practitioner-researcher whose attachment of interest is the PDF — "PDFs
// only" mode emits each PDF as a first-class Logseq asset block (embedded
// viewer + annotation tooling). "All attachments" widens the net for users who
// also keep snapshots / supplementary files. The optional external-openers
// block sits below the attachments and is the escape hatch out of Logseq —
// useful when you want Preview/Skim instead of the embedded viewer.
export const AttachmentsSection = () => {
  const [importMode, setImportMode] = useState<AttachmentImportMode>(
    (logseq.settings?.attachmentImportMode as AttachmentImportMode) ??
      'PDFs only',
  )
  const [blockName, setBlockName] = useState<string>(
    (logseq.settings?.attachmentsBlockName as string) ??
      ATTACHMENTS_BLOCK_NAME_DEFAULT,
  )
  const [openInline, setOpenInline] = useState<boolean>(
    (logseq.settings?.openAttachmentInline as boolean) ?? true,
  )
  const [showExternalLinks, setShowExternalLinks] = useState<boolean>(
    (logseq.settings?.attachmentShowExternalLinks as boolean) ?? false,
  )
  const [externalPdfLabel, setExternalPdfLabel] = useState<string>(
    (logseq.settings?.attachmentExternalPdfLabel as string) ??
      ATTACHMENT_EXTERNAL_PDF_LABEL_DEFAULT,
  )

  const onImportMode = (v: AttachmentImportMode) => {
    setImportMode(v)
    void logseq.updateSettings({ attachmentImportMode: v })
  }
  const onBlockName = (v: string) => {
    setBlockName(v)
    void logseq.updateSettings({ attachmentsBlockName: v })
  }
  const onOpenInline = (v: boolean) => {
    setOpenInline(v)
    void logseq.updateSettings({ openAttachmentInline: v })
  }
  const onShowExternalLinks = (v: boolean) => {
    setShowExternalLinks(v)
    void logseq.updateSettings({ attachmentShowExternalLinks: v })
  }
  const onExternalPdfLabel = (v: string) => {
    setExternalPdfLabel(v)
    void logseq.updateSettings({ attachmentExternalPdfLabel: v })
  }

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Attachments</h3>
        <p className="setup-section-desc">
          How Zotero attachments come into the page: the wrapping block, which
          attachments to import, and optional shortcuts out to your OS or
          Zotero.
        </p>
      </div>

      <div className="setup-section-body">
        <div className="setup-field">
          <label className="setup-field-label" htmlFor="attach-mode">
            Import
          </label>
          <select
            id="attach-mode"
            className="tagrule-select setup-control"
            value={importMode}
            onChange={(e) =>
              onImportMode(e.target.value as AttachmentImportMode)
            }
          >
            {ATTACHMENT_IMPORT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <p className="setup-field-hint">
            PDFs come in as first-class Logseq assets so the embedded viewer and
            annotation tools work first-try. "All attachments" also brings in
            snapshots, supplementary files, and linked web pages as markdown
            links.
          </p>
        </div>

        <div className="setup-field">
          <label className="setup-field-label" htmlFor="attach-block-name">
            Block heading
          </label>
          <input
            id="attach-block-name"
            className="tagrule-input setup-control"
            value={blockName}
            placeholder={ATTACHMENTS_BLOCK_NAME_DEFAULT}
            onChange={(e) => onBlockName(e.target.value)}
          />
          <p className="setup-field-hint">
            The wrapping block under which attachments are inserted.
          </p>
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={openInline}
              onChange={(e) => onOpenInline(e.target.checked)}
            />
            Open non-PDF attachments in Logseq
          </label>
          <p className="setup-field-hint">
            Off = open in your default system app instead. Doesn't affect PDFs:
            those always use Logseq's embedded viewer (use the link below to
            jump out).
          </p>
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showExternalLinks}
              onChange={(e) => onShowExternalLinks(e.target.checked)}
            />
            Add an "open externally" links block
          </label>
          <p className="setup-field-hint">
            A single extra block with quick links: opens the PDF in your OS app
            (Preview / Skim / etc.) and opens the item in Zotero.
          </p>

          {showExternalLinks && (
            <div className="setup-field-row" style={{ marginTop: '0.6rem' }}>
              <label
                className="setup-inline-label"
                htmlFor="attach-external-pdf-label"
              >
                PDF link label
              </label>
              <input
                id="attach-external-pdf-label"
                className="tagrule-input setup-control"
                value={externalPdfLabel}
                placeholder={ATTACHMENT_EXTERNAL_PDF_LABEL_DEFAULT}
                onChange={(e) => onExternalPdfLabel(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
