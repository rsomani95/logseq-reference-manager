import { BlockEntity } from '@logseq/libs/dist/LSPlugin'

import {
  ATTACHMENTS_BLOCK_NAME_DEFAULT,
  PLUGIN_ID,
  ZOTERO_ATTACHMENT_KEY_PROP,
  ZOTERO_CODE_PROP,
  ZOTERO_LAST_SYNC_PROP,
} from '../constants'
import { getAnnotationsByItemKey } from './get-zot-items'

/**
 * Parse a stored zotero-last-sync value into a Date, or null if it's missing
 * or unparseable. Without this guard, sync would re-fetch every annotation
 * from Zotero and append each one again, duplicating the page contents.
 */
export const parseLastSync = (raw: unknown): Date | null => {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export const syncAnnotations = async (pageName: string) => {
  const pageProps = await logseq.Editor.getPageProperties(pageName)
  if (!pageProps) throw new Error('No page properties found')

  const itemKey = pageProps[ZOTERO_CODE_PROP]
  if (!itemKey) throw new Error('Not a valid Zotero page')

  const lastSync = parseLastSync(pageProps[ZOTERO_LAST_SYNC_PROP])
  if (!lastSync) {
    throw new Error(
      'This page is missing a valid zotero-last-sync timestamp. Re-import the item to set one — refusing to sync to avoid duplicating annotations.',
    )
  }

  // Fetch new annotations from Zotero (only those added after last sync)
  const annotationMap = await getAnnotationsByItemKey(
    itemKey as string,
    lastSync.toISOString(),
  )

  if (annotationMap.size === 0) {
    await logseq.UI.showMsg('No new annotations found', 'warning')
    return
  }

  // Find the attachments wrapper in the page block tree by the user's
  // configured `attachmentsBlockName` (Attachments tab → block name).
  const blockTree = await logseq.Editor.getPageBlocksTree(pageName)
  if (!blockTree) throw new Error('Could not read page blocks')

  const configuredBlockName =
    (logseq.settings?.attachmentsBlockName as string | undefined)?.trim() ||
    ATTACHMENTS_BLOCK_NAME_DEFAULT

  let attachmentsBlock = blockTree.find(
    (b) => b.content === configuredBlockName,
  )

  // Create the section if it doesn't exist
  if (!attachmentsBlock) {
    const lastBlock = blockTree[blockTree.length - 1]
    if (!lastBlock) throw new Error('Page has no blocks')
    attachmentsBlock = (await logseq.Editor.insertBlock(
      lastBlock.uuid,
      configuredBlockName,
      { sibling: true },
    )) as BlockEntity
  }

  // Get existing attachment child blocks
  const attachmentBlocks = attachmentsBlock.children as
    | BlockEntity[]
    | undefined

  let totalInserted = 0

  for (const [attachmentKey, annotations] of annotationMap) {
    // Find the attachment block by matching the zotero-attachment-key property
    let targetAttachmentBlock: BlockEntity | undefined

    if (attachmentBlocks) {
      for (const child of attachmentBlocks) {
        const block = child as BlockEntity
        const blockProps = await logseq.Editor.getBlockProperties(block.uuid)
        if (blockProps?.[ZOTERO_ATTACHMENT_KEY_PROP] === attachmentKey) {
          targetAttachmentBlock = block
          break
        }
      }
    }

    if (!targetAttachmentBlock) {
      console.log(
        `${PLUGIN_ID}: No matching attachment block for key ${attachmentKey}, skipping`,
      )
      continue
    }

    // Append new annotations sorted by document position
    const sortedAnnotations = [...annotations].sort((a, b) =>
      a.annotationSortIndex.localeCompare(b.annotationSortIndex),
    )
    for (const annotation of sortedAnnotations) {
      const annotationBlock = await logseq.Editor.insertBlock(
        targetAttachmentBlock.uuid,
        annotation.annotationText,
        { sibling: false },
      )

      if (annotationBlock && annotation.annotationComment) {
        await logseq.Editor.insertBlock(
          annotationBlock.uuid,
          annotation.annotationComment,
          { sibling: false },
        )
      }

      totalInserted++
    }
  }

  // Update the sync timestamp
  const page = await logseq.Editor.getPage(pageName)
  if (page) {
    await logseq.Editor.upsertBlockProperty(
      page.uuid,
      'zotero-last-sync',
      new Date().toISOString(),
    )
  }

  await logseq.UI.showMsg(
    `Synced ${totalInserted} new annotation(s)`,
    'success',
  )
}
