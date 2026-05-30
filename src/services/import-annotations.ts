/**
 * Annotation import orchestrator — the picking rule.
 *
 * For one PDF that already exists as an asset block in the graph:
 *   1. Resolve the file on disk and read its bytes.
 *   2. Inspect the PDF for embedded markup (any non-`/Link`, non-`/Popup`
 *      annotation). If present, the file was annotated in an external app
 *      (Preview / PDF Expert / …) → extract from the file with mupdf and IGNORE
 *      Zotero (the file is the strictly-better source — it even recovers the
 *      FreeText notes Zotero drops on import).
 *   3. Otherwise (no embedded markup) → fall back to Zotero's database
 *      annotations for that attachment.
 *   4. Convert to Logseq `Pdf-annotation` records and write them via the live
 *      build-import path. Idempotent (re-running upserts by uuid).
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

  const extracted = pa.extract(bytes)
  // "Annotations inside the file" = any real markup or note — Link/Popup are
  // document plumbing, not reading notes (see pdf-annot zotero-annotations.md §9).
  const hasNativeMarkup = extracted.annotations.some(
    (a) => !a.is_link && a.subtype !== 'Popup',
  )

  const color = colorOverride()

  if (hasNativeMarkup) {
    const conv = pa.convert(extracted, {
      assetUuid,
      assetTitle: pageTitle,
      color,
    })
    await importAnnotationRecords(conv.records, assetUuid, pageTitle)
    return { source: 'pdf', count: conv.records.length }
  }

  // Zotero-database fallback (file has no embedded markup). Needs the attachment
  // key to fetch its annotations and the PDF's page dimensions for the transform.
  if (!attachmentKey) return { source: 'none', count: 0 }
  const { annotations, libraryID } =
    await getRawAnnotationsForAttachment(attachmentKey)
  if (annotations.length === 0) return { source: 'none', count: 0 }

  const pages = pa.pageGeometriesFromBytes(bytes)
  const conv = pa.convertZoteroAnnotations(annotations, pages, {
    assetUuid,
    assetTitle: pageTitle,
    libraryID,
    color,
  })
  await importAnnotationRecords(conv.records, assetUuid, pageTitle)
  return { source: 'zotero', count: conv.records.length }
}

/**
 * "Sync annotations" entry point for one page: find its PDF asset block(s) and
 * (re-)import each. Surfaces a single summary toast. Safe to re-run.
 */
export const syncAnnotationsForPage = async (
  pageName: string,
): Promise<void> => {
  const targets = await findPdfAssetsForPage(pageName)
  if (targets.length === 0) {
    await logseq.UI.showMsg(
      'No PDF asset on this page to sync annotations from.',
      'warning',
    )
    return
  }

  let total = 0
  let source: AnnotImportResult['source'] = 'none'
  for (const target of targets) {
    const result = await importAnnotationsForAsset(target)
    total += result.count
    if (result.source !== 'none') source = result.source
  }

  await logseq.UI.showMsg(
    total > 0
      ? `Synced ${total} annotation(s) from ${source === 'pdf' ? 'the PDF file' : 'Zotero'}`
      : 'No annotations found to sync',
    total > 0 ? 'success' : 'warning',
  )
}
