import { IBatchBlock } from '@logseq/libs/dist/LSPlugin'
import { format, parse, parseISO } from 'date-fns'

import { PROP_PRESETS, ZOT_DATA_KEY_MAP } from '../constants'
import { matchTagRules } from '../extended-tags'
import { PropertyPreset, ZotData } from '../interfaces'
import { convertPropToKebabCase } from './convert-prop-to-kebab'
import { isRecycledPage } from './is-recycled-page'
import { isSchemaAdded } from './is-schema-added'
import { parseHtml } from './parse-html'

/**
 * Resolves the Logseq page name for a Zotero item by filling the configured
 * `pagenameTemplate`. Shared by the single-item and batch import paths.
 */
export const resolvePageName = (zotItem: ZotData): string =>
  (logseq.settings!.pagenameTemplate as string)
    .replace('<% title %>', zotItem.title)
    .replace('<% citeKey %>', zotItem.citeKey)
    .trim()

export const handleZotInDb = async (
  zotItem: ZotData,
  pageName: string,
  opts: { navigate?: boolean } = {},
) => {
  // When false (batch import), suppress the page navigation that's helpful for
  // a single insert but would yank the user around mid-batch.
  const navigate = opts.navigate ?? true

  // Check if citekey has been configured correctly
  if (
    (logseq.settings!.pagenameTemplate as string).includes('<% citeKey %>') &&
    zotItem.citeKey === 'N/A'
  ) {
    //logseq.UI.showMsg(
    //  'Cite key is not configured properly in BetterBibTex',
    //  'error',
    //)
    throw new Error('Citekey has not been configured properly')
  }

  // Check if schema has been added
  const schemaAdded = await isSchemaAdded()
  if (!schemaAdded) {
    await logseq.UI.showMsg(
      'Double-check settings to ensure that all schema has been setup before trying again',
      'error',
    )
    throw new Error()
  }

  // Create page for Zotero item
  let existingPage = await logseq.Editor.getPage(pageName)
  if (existingPage) {
    // Logseq DB recycles pages instead of hard-deleting (30-day retention),
    // so a "deleted" page still shows up here. The in-app restore handler
    // retracts :block/parent, :block/order, :block/page and the recycle
    // markers — none of which a plugin can do, and Editor.createPage on a
    // recycled name silently returns the recycled entity without restoring
    // (it short-circuits before the actual create). So we can't fix this in
    // the plugin; punt to the user with an actionable message.
    if (await isRecycledPage(existingPage)) {
      throw new Error(
        `"${pageName}" exists in Logseq's Recycle bin. Open the Recycle page, permanently delete this entry, then re-import.`,
      )
    }
    if (navigate) logseq.App.pushState('page', { name: existingPage.name })
    throw new Error('Page already exists')
  }
  existingPage = await logseq.Editor.createPage(
    pageName,
    {},
    {
      redirect: navigate,
      createFirstBlock: false,
      journal: false,
    },
  )
  if (!existingPage) return

  // Add Zotero tag to page
  const zotTag = logseq.settings?.zotTag as string
  await logseq.Editor.addBlockTag(existingPage.uuid, zotTag)

  // Apply matched extended tags, if any. Assumes each tag exists in Logseq
  // and extends the base Zotero tag — see feature_extended_tags.md.
  for (const tag of matchTagRules(zotItem)) {
    if (tag === zotTag) continue
    console.log(`[extended-tags] Applying matched tag: ${tag}`)
    await logseq.Editor.addBlockTag(existingPage.uuid, tag)
  }

  /*
  1. Adds props to page
  2. Adds abstract, attachments and annotations to page
  */

  // Resolve which properties to use based on the selected preset
  const preset =
    (logseq.settings?.propertyPreset as PropertyPreset) ?? 'Essentials'
  let userSelectedPageProps: string[]
  if (preset === 'Custom') {
    userSelectedPageProps = logseq.settings?.pageProps as string[]
  } else if (preset === 'Full') {
    userSelectedPageProps = Object.keys(ZOT_DATA_KEY_MAP).filter(
      (prop) =>
        prop !== 'abstractNote' &&
        prop !== 'attachments' &&
        prop !== 'notes' &&
        prop !== 'inGraph',
    )
  } else {
    userSelectedPageProps = [...PROP_PRESETS[preset]]
  }
  for (const prop of userSelectedPageProps) {
    console.log('Inserting prop into page', prop)

    const fixedProp = convertPropToKebabCase(prop)

    // @ts-expect-error need to type later
    const value = zotItem[prop]

    /*******
    Insert properties
    *******/
    if (
      prop === 'inGraph' ||
      prop === 'annotations' ||
      prop === 'attachments' ||
      prop === 'abstractNote' ||
      prop === 'notes' ||
      prop === 'version' ||
      prop === 'collections' ||
      prop === 'pages' ||
      prop === 'parentItem' ||
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) || // Empty array
      (typeof value === 'object' && Object.keys(value).length === 0)
    ) {
      continue
      //} else if (prop === 'attachments') {
      //  for (const attachment of value) {
      //    const url = `![${attachment.title}](${decodeURI(attachment.url ?? attachment.href)})`
      //    await logseq.Editor.upsertBlockProperty(
      //      existingPage.uuid,
      //      fixedProp,
      //      url,
      //    )
      //  }
    } else if (
      prop === 'accessDate' ||
      prop === 'dateAdded' ||
      prop === 'dateModified'
    ) {
      const page = await logseq.Editor.createJournalPage(
        format(
          parseISO(value) || parse(value, 'yyyy-MM-dd', new Date()),
          'yyyy-MM-dd',
        ),
      )
      if (!page) continue
      await logseq.Editor.upsertBlockProperty(
        existingPage.uuid,
        fixedProp,
        page.id,
      )
    } else if (prop === 'authors' || prop === 'creators') {
      const pageIds: number[] = []

      for (const c of value) {
        const page = await logseq.Editor.createPage(
          `${c.firstName} ${c.lastName}`,
          {},
          { redirect: false },
        )
        if (page) pageIds.push(page.id)
      }

      for (const id of pageIds) {
        await logseq.Editor.upsertBlockProperty(
          existingPage.uuid,
          fixedProp,
          id,
        )
      }
    } else if (prop === 'tags') {
      const tagPageIds = []

      for (const t of value) {
        const page = await logseq.Editor.createPage(
          t.tag,
          {},
          { redirect: false },
        )
        if (page) tagPageIds.push(page.id)
      }

      for (const id of tagPageIds) {
        await logseq.Editor.upsertBlockProperty(existingPage.uuid, 'tags', id)
      }
    } else {
      await logseq.Editor.upsertBlockProperty(
        existingPage.uuid,
        fixedProp,
        value,
      )
    }
  }

  // Always populate zotero-code (not part of presets, but always needed)
  if (zotItem['zotero-code']) {
    await logseq.Editor.upsertBlockProperty(
      existingPage.uuid,
      'zotero-code',
      zotItem['zotero-code'],
    )
  }

  // Set initial sync timestamp
  await logseq.Editor.upsertBlockProperty(
    existingPage.uuid,
    'zotero-last-sync',
    new Date().toISOString(),
  )

  /*******
    Insert blocks
    *******/

  let glossaryBatchBlk: IBatchBlock[] = []

  // Insert attachments with annotations — done individually so we can set
  // the zotero-attachment-key property on each attachment block for sync
  if (zotItem.attachments && zotItem.attachments.length > 0) {
    const headerBlock = await logseq.Editor.insertBlock(
      existingPage.uuid,
      '## Attachments and Annotations',
      { sibling: false },
    )

    if (headerBlock) {
      for (const attachment of zotItem.attachments) {
        const link =
          attachment.linkMode === 'linked_url'
            ? `${logseq.settings?.openAttachmentInline ? '!' : ''}[${attachment.title}](${decodeURI(attachment.url)})`
            : `${logseq.settings?.openAttachmentInline ? '!' : ''}[${attachment.title}](${decodeURI(attachment.href)})`

        const attachmentBlock = await logseq.Editor.insertBlock(
          headerBlock.uuid,
          link,
          { sibling: false },
        )

        if (attachmentBlock) {
          // Store the Zotero attachment key for sync matching
          await logseq.Editor.upsertBlockProperty(
            attachmentBlock.uuid,
            'zotero-attachment-key',
            attachment.key,
          )

          // Insert annotations sorted by document position
          const sortedAnnotations = [...attachment.annotations].sort((a, b) =>
            a.annotationSortIndex.localeCompare(b.annotationSortIndex),
          )
          for (const annotation of sortedAnnotations) {
            if (!annotation.annotationText) continue
            const annotationBlock = await logseq.Editor.insertBlock(
              attachmentBlock.uuid,
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
          }
        }
      }
    }
  }

  // Insert abstract
  if (zotItem.abstractNote) {
    const abstractBlk = {
      content: '**Abstract**',
      children: [
        {
          content: zotItem.abstractNote
            .split('\n')
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter((line) => line.length > 0)
            .join('\n'),
        },
      ],
    }
    glossaryBatchBlk.push(abstractBlk)
  }

  // Insert notes
  if (zotItem.notes && zotItem.notes.length > 0 && zotItem.notes[0]) {
    const htmlBlk = parseHtml(zotItem.notes[0].note)
    glossaryBatchBlk = [...glossaryBatchBlk, ...htmlBlk]
  }

  if (glossaryBatchBlk.length > 0)
    await logseq.Editor.insertBatchBlock(existingPage.uuid, glossaryBatchBlk)
}
