/**
 * Locate the PDF asset block(s) on an existing reference page, for the
 * "Sync annotations" path (where, unlike fresh import, we don't already hold the
 * asset uuid). Each plugin-created PDF asset block carries
 * `:logseq.property.asset/external-url` (→ the on-disk path) and the plugin's
 * `zotero-attachment-key` (→ the Zotero attachment, for the Zotero fallback). The
 * host page title is what `build-import` matches on, so we read it too.
 */
import type { BlockEntity } from '@logseq/libs/dist/LSPlugin'

import { ZOTERO_ATTACHMENT_KEY_PROP } from '../constants'

const ASSET_EXTERNAL_URL_PROP = ':logseq.property.asset/external-url'

/** Percent-decoded absolute path from a `file://` URL (per-segment decode). */
const fileUrlToPath = (fileUrl: string): string =>
  fileUrl
    .replace(/^file:\/\//, '')
    .split('/')
    .map(decodeURIComponent)
    .join('/')

export interface PdfAssetTarget {
  /** uuid of the Logseq asset block the annotations attach to. */
  assetUuid: string
  /** host reference-page title (build-import matches the page by title). */
  pageTitle: string
  /** absolute on-disk path to the PDF, for reading its bytes. */
  absPath: string
  /** Zotero attachment key, for the Zotero-database fallback (null if unknown). */
  attachmentKey: string | null
}

const flatten = (blocks: BlockEntity[]): BlockEntity[] => {
  const out: BlockEntity[] = []
  const walk = (b: BlockEntity): void => {
    out.push(b)
    for (const c of (b.children ?? []) as BlockEntity[]) walk(c)
  }
  for (const b of blocks) walk(b)
  return out
}

/**
 * Every PDF asset block on `pageName` (a block carrying an asset external-url),
 * resolved to an import target. Empty when the page has no PDF asset.
 */
export const findPdfAssetsForPage = async (
  pageName: string,
): Promise<PdfAssetTarget[]> => {
  const page = await logseq.Editor.getPage(pageName)
  if (!page) return []

  // Read the page's real title via a scalar query (avoids the name/title
  // ambiguity of the page entity, and the pull-shape ambiguity of a richer query).
  const titleRows = (await logseq.DB.datascriptQuery(
    `[:find ?t :where [?p :block/uuid #uuid "${page.uuid}"] [?p :block/title ?t]]`,
  )) as [string][] | null
  const pageTitle = titleRows?.[0]?.[0] ?? pageName

  const tree = (await logseq.Editor.getPageBlocksTree(pageName)) as
    | BlockEntity[]
    | null
  if (!tree) return []

  const targets: PdfAssetTarget[] = []
  for (const block of flatten(tree)) {
    const props = await logseq.Editor.getBlockProperties(block.uuid)
    const url = props?.[ASSET_EXTERNAL_URL_PROP] as string | undefined
    if (!url) continue
    const attachmentKey =
      (props?.[ZOTERO_ATTACHMENT_KEY_PROP] as string | undefined) ?? null
    targets.push({
      assetUuid: block.uuid,
      pageTitle,
      absPath: fileUrlToPath(url),
      attachmentKey,
    })
  }
  return targets
}
