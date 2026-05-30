/**
 * Annotation import orchestrator — the picking rule.
 *
 * For one PDF that already exists as an asset block in the graph:
 *   1. Resolve the file on disk and read its bytes.
 *   2. Convert whatever annotations are embedded in the file (mupdf). If that
 *      yields any renderable highlight, the file was annotated in an external
 *      app (Preview / PDF Expert / …) → use it and IGNORE Zotero (the file is
 *      the strictly-better source — it even recovers the FreeText notes Zotero
 *      drops on import).
 *   3. Otherwise (the file has no highlight we can place — nothing embedded, or
 *      only ink / stamps / form-field widgets we don't render) → fall back to
 *      Zotero's database annotations for that attachment.
 *   4. Write the resulting `Pdf-annotation` records via the live build-import
 *      path. Idempotent (re-running upserts by uuid).
 *
 * The decision is made on the *converted records*, not on the bare presence of
 * any `/Annots` entry: keying off "are there embedded annotations" would commit
 * a file whose only marks are ink/stamps/widgets to the PDF path, produce zero
 * records, and silently skip the Zotero fallback.
 *
 * The mupdf-backed core is dynamically imported so its ~10 MB WASM only loads
 * the first time annotations are actually imported, not on every plugin start.
 */

import { findPdfAssetsForPage } from './find-pdf-asset'
import { getRawAnnotationsForAttachment } from './get-zot-items'
import { importAnnotationRecords } from './logseq-import-edn'
import type { ColorName } from './pdf-annot/types'
import { readPdfBytes } from './read-pdf-bytes'

export interface AnnotImportResult {
  /** Where the annotations came from (or none found). */
  source: 'pdf' | 'zotero' | 'none'
  count: number
}

/** Optional forced highlight color from settings; null = nearest-pastel mapping. */
const colorOverride = (): ColorName | null => {
  const c = (logseq.settings?.annotationColor as string | undefined)?.trim()
  const valid = ['yellow', 'red', 'green', 'blue', 'purple']
  return c && valid.includes(c) ? (c as ColorName) : null
}

export interface AssetImportArgs {
  assetUuid: string
  pageTitle: string
  absPath: string
  attachmentKey: string | null
}

/**
 * Import annotations for a single PDF asset block. Reads the file, applies the
 * PDF-native-first → Zotero-fallback rule, and writes the resulting records.
 */
export const importAnnotationsForAsset = async (
  args: AssetImportArgs,
): Promise<AnnotImportResult> => {
  const { assetUuid, pageTitle, absPath, attachmentKey } = args
  const bytes = await readPdfBytes(absPath)

  const pa = await import('./pdf-annot')
  const color = colorOverride()

  // PDF-native first: convert whatever the file carries and decide on the
  // *records* it yields. A file with only ink / stamps / form-field widgets (or
  // markup we can't place) converts to zero records and must fall through to
  // Zotero, not commit to the PDF path and import nothing.
  const pdfConv = pa.convert(pa.extract(bytes), {
    assetUuid,
    assetTitle: pageTitle,
    color,
  })
  if (pdfConv.records.length > 0) {
    await importAnnotationRecords(pdfConv.records, assetUuid, pageTitle)
    return { source: 'pdf', count: pdfConv.records.length }
  }

  // Zotero-database fallback. Needs the attachment key to fetch its annotations
  // and the PDF's page dimensions for the coordinate transform.
  if (!attachmentKey) return { source: 'none', count: 0 }
  const { annotations, libraryID } =
    await getRawAnnotationsForAttachment(attachmentKey)
  if (annotations.length === 0) return { source: 'none', count: 0 }

  const conv = pa.convertZoteroAnnotations(
    annotations,
    pa.pageGeometriesFromBytes(bytes),
    { assetUuid, assetTitle: pageTitle, libraryID, color },
  )
  await importAnnotationRecords(conv.records, assetUuid, pageTitle)
  return { source: 'zotero', count: conv.records.length }
}

export interface PageSyncResult {
  /** Annotations written across this page's PDF asset(s). */
  total: number
  /** PDF targets that threw (unreadable file, API error, …). */
  failed: number
  /** Which sources contributed, for an aggregate summary. */
  sources: Set<'pdf' | 'zotero'>
  /** Whether the page had any PDF asset at all. */
  hadPdf: boolean
}

/**
 * "Sync annotations" entry point for one page: find its PDF asset block(s) and
 * (re-)import each, isolating per-target failures. Safe to re-run (idempotent).
 * Toasts a summary when `announce` (the default, single-page command); "Sync
 * all" passes `announce: false` and aggregates the returned tallies instead, so
 * it doesn't fire a toast per (often PDF-less) page.
 */
export const syncAnnotationsForPage = async (
  pageName: string,
  opts: { announce?: boolean } = {},
): Promise<PageSyncResult> => {
  const announce = opts.announce ?? true
  const targets = await findPdfAssetsForPage(pageName)
  if (targets.length === 0) {
    if (announce) {
      await logseq.UI.showMsg(
        'No PDF asset on this page to sync annotations from.',
        'warning',
      )
    }
    return { total: 0, failed: 0, sources: new Set(), hadPdf: false }
  }

  // Per-target isolation: one unreadable/corrupt PDF (or a transient API error)
  // must not abort the page's other PDFs or swallow the summary.
  let total = 0
  let failed = 0
  const sources = new Set<'pdf' | 'zotero'>()
  for (const target of targets) {
    try {
      const result = await importAnnotationsForAsset(target)
      total += result.count
      if (result.source !== 'none') sources.add(result.source)
    } catch (e) {
      failed += 1
      console.warn(`[annotations] sync failed for ${target.absPath}:`, e)
    }
  }

  if (announce) {
    const from =
      sources.size > 1
        ? ' from the PDF files and Zotero'
        : sources.has('pdf')
          ? ' from the PDF file'
          : sources.has('zotero')
            ? ' from Zotero'
            : ''
    const failSuffix =
      failed > 0
        ? ` (${failed} PDF${failed > 1 ? 's' : ''} failed — see console)`
        : ''
    if (total > 0) {
      await logseq.UI.showMsg(
        `Synced ${total} annotation(s)${from}${failSuffix}`,
        'success',
      )
    } else if (failed > 0) {
      await logseq.UI.showMsg(`Annotation sync failed${failSuffix}`, 'error')
    } else {
      await logseq.UI.showMsg('No annotations found to sync', 'warning')
    }
  }

  return { total, failed, sources, hadPdf: true }
}
