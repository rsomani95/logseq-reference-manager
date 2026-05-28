import { IBatchBlock } from '@logseq/libs/dist/LSPlugin'
import { format, parse, parseISO } from 'date-fns'

import { PROP_PRESETS, ZOT_DATA_KEY_MAP } from '../constants'
import { getConfiguredTagRules, matchTagRules } from '../extended-tags'
import { CreatorItem, PropertyPreset, ZotData } from '../interfaces'
import { convertPropToKebabCase } from './convert-prop-to-kebab'
import { isRecycledPage } from './is-recycled-page'
import { isSchemaAdded } from './is-schema-added'
import { parsePagePropChoice } from './page-props-choice'
import { parseHtml } from './parse-html'
import {
  applyCreatorTemplate,
  applyPageNameTemplate,
  hasCiteKeyToken,
} from './resolve-templates'
import { buildZoteroCodeIndex, ZoteroCodedPage } from './zotero-code-index'

/**
 * Resolves the Logseq page name for a Zotero item by filling the configured
 * `pagenameTemplate`. Shared by the single-item and batch import paths. The
 * substitution is tolerant of placeholder case/whitespace and falls back to a
 * collision-safe default — the real work lives in `applyPageNameTemplate`,
 * which is pure so the Formats settings preview can render through it too.
 */
export const resolvePageName = (zotItem: ZotData): string =>
  applyPageNameTemplate(
    logseq.settings?.pagenameTemplate as string,
    { title: zotItem.title, citeKey: zotItem.citeKey },
    (logseq.settings?.pagenamePrefix as string) ?? '',
  )

/**
 * Renders a single creator's name via `creatorNameTemplate`. Used for both the
 * Logseq page title when creators are stored as page references, and for each
 * entry when they're stored as comma-separated text.
 */
export const resolveCreatorName = (creator: CreatorItem): string =>
  applyCreatorTemplate(logseq.settings?.creatorNameTemplate as string, creator)

/**
 * Builds a properly percent-encoded `file://` URL from an absolute filesystem
 * path. Distinct from the bare-path form used for the Markdown link in the
 * attachment loop below, which deliberately avoids `file://` to dodge mldoc's
 * missing decode (see `dev_notes/LOGSEQ_FILE_LINKS.md`). The asset-block
 * renderer is a different code path — PDF.js consumes the URL directly, so it
 * wants a real, encoded URL.
 */
const pathToFileUrl = (absPath: string): string =>
  // encodeURIComponent encodes `/` too, so encode per-segment then rejoin.
  `file://${absPath.split('/').map(encodeURIComponent).join('/')}`

/** Lowercase file extension without the dot, or '' if none. */
const extensionFromPath = (path: string): string => {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
}

/** SHA-256 hex digest of a string. Needed upstram. */
const sha256Hex = async (s: string): Promise<string> => {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// FIXME: Add docstring. what does this do?
export const handleZotInDb = async (
  zotItem: ZotData,
  pageName: string,
  opts: {
    navigate?: boolean
    zoteroCodeIndex?: Map<string, ZoteroCodedPage>
  } = {},
): Promise<{ status: 'created' | 'exists'; pageName: string }> => {
  // When false (batch import), suppress the page navigation that's helpful for
  // a single insert but would yank the user around mid-batch.
  const navigate = opts.navigate ?? true

  // Check if citekey has been configured correctly
  if (
    hasCiteKeyToken(logseq.settings?.pagenameTemplate as string) &&
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

  // Rename-proof in-graph check: match the item by its Zotero key, not by the
  // page name. If this item was imported and the user later renamed the page,
  // this still finds it — so we surface / link the existing page instead of
  // creating a duplicate under the template-derived name.
  const codeIndex = opts.zoteroCodeIndex ?? (await buildZoteroCodeIndex())
  const zoteroCode = zotItem['zotero-code']
  const alreadyInGraph = zoteroCode ? codeIndex.get(zoteroCode) : undefined
  if (alreadyInGraph) {
    if (navigate) {
      // pushState resolves by the lowercased page name (cf. PageEntity.name,
      // and `page.title.toLowerCase()` in index.tsx); the [[link]] / message
      // use the display title.
      logseq.App.pushState('page', {
        name: alreadyInGraph.title.toLowerCase(),
      })
    }
    return { status: 'exists', pageName: alreadyInGraph.title }
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
    // A different page already occupies this name — one the user made by
    // hand, or an imported page whose zotero-code we couldn't read. Don't
    // clobber it.
    if (navigate) logseq.App.pushState('page', { name: existingPage.name })
    throw new Error('Page already exists')
  }
  existingPage = await logseq.Editor.createPage(
    pageName,
    {},
    {
      redirect: false,
      createFirstBlock: false,
      journal: false,
    },
  )
  if (!existingPage) {
    throw new Error('Failed to create the Logseq page')
  }

  // Add Zotero tag to page
  const zotTag = logseq.settings?.zotTag as string
  await logseq.Editor.addBlockTag(existingPage.uuid, zotTag)

  // Apply matched extended tags, if any. Rules come from the `tagRules`
  // setting (JSON). Auto-create the tag (extending the base Zotero tag) if
  // it doesn't exist yet — a rule targeting e.g. "MLPaper" should work
  // without the user pre-creating the class. Per-tag failures are isolated
  // so one bad tag doesn't abort the whole import.
  const tagRules = getConfiguredTagRules()
  for (const tag of matchTagRules(zotItem, tagRules)) {
    if (tag === zotTag) continue
    console.log(`[extended-tags] Applying matched tag: ${tag}`)
    try {
      const existing = await logseq.Editor.getTag(tag)
      if (!existing) {
        const created = await logseq.Editor.createTag(tag)
        if (created) await logseq.Editor.addTagExtends(tag, zotTag)
      }
      await logseq.Editor.addBlockTag(existingPage.uuid, tag)
    } catch (e) {
      console.warn(`[extended-tags] Failed to apply tag "${tag}":`, e)
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null
            ? JSON.stringify(e)
            : String(e)
      await logseq.UI.showMsg(`Couldn't apply tag "${tag}": ${msg}`, 'warning')
    }
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
    // Custom Page Properties are stored as user-facing labels
    // ("Title — The item's title") — map back to the camelCase keys this
    // function and the schema setup work with. `parsePagePropChoice` also
    // accepts the bare key for back-compat with pre-format values.
    const raw = (logseq.settings?.pageProps as string[] | undefined) ?? []
    userSelectedPageProps = raw
      .map(parsePagePropChoice)
      .filter((k): k is string => k !== null)
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
      // Blank or whitespace-only strings: Logseq's "hide empty value" only
      // hides nil (`(nil? value)`), NOT "" or "   " — so a blank value writes a
      // visible empty property row. Drop it here so it never lands on the page.
      (typeof value === 'string' && value.trim() === '') ||
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
      const asNodes = (logseq.settings?.creatorsAsNodes as boolean) ?? true
      const creators = value as CreatorItem[]

      if (asNodes) {
        const pageIds: number[] = []
        for (const c of creators) {
          const page = await logseq.Editor.createPage(
            resolveCreatorName(c),
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
      } else {
        const separator = (logseq.settings?.creatorSeparator as string) ?? ', '
        const text = creators.map(resolveCreatorName).join(separator)
        await logseq.Editor.upsertBlockProperty(
          existingPage.uuid,
          fixedProp,
          text,
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
      'Attachments and Annotations',
      { sibling: false },
    )

    if (headerBlock) {
      for (const attachment of zotItem.attachments) {
        // Pick the most "openable" target per link mode:
        // - linked_file: emit the bare absolute path with literal characters,
        //   no `file://` prefix, no percent-encoding. Logseq's mldoc parser
        //   strips `file://` on its own but never decodes %20/%2C before
        //   passing the path to Electron's `shell.openPath`, so an encoded
        //   form silently fails (see logseq/logseq#9017). The bare path takes
        //   the `Search` branch in mldoc — leading `/` short-circuits — and
        //   reaches `shell.openPath` verbatim, which macOS hands to Preview /
        //   the user's default PDF app. ZotMoov users live here.
        // - imported_file: Zotero's local HTTP enclosure URL — fetches the
        //   file through the running Zotero. No file:// because we don't
        //   know the user's Zotero data dir without an extra setting.
        // - linked_url: the web URL, as-is.
        let url: string
        if (attachment.linkMode === 'linked_file') {
          url = attachment.path
        } else if (attachment.linkMode === 'imported_file') {
          url = decodeURI(attachment.href)
        } else {
          url = decodeURI(attachment.url)
        }
        const link = `${logseq.settings?.openAttachmentInline ? '!' : ''}[${attachment.title}](${url})`

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

        // Experimental — alongside the Markdown link above, emit a "proper"
        // asset block. The Markdown link is a
        // content block: clicking opens the PDF, but the first highlight
        // pops Logseq's "Create asset" modal because no asset block is in
        // scope. Setting `:logseq.property.asset/external-url` (+ type,
        // checksum, size) makes the block an asset entity that Logseq's
        // annotation machinery checks against, so highlighting should work
        // first-try with no modal.
        //
        // Scoped to linked_file because that's the only mode where I currently have
        // a real on-disk path; imported_file points at Zotero's local HTTP
        // and linked_url is a web URL — neither matches the guide's premise
        // of a file PDF.js can load directly.
        if (attachment.linkMode === 'linked_file') {
          const fileUrl = pathToFileUrl(attachment.path)
          const ext = extensionFromPath(attachment.path)
          const checksum = await sha256Hex(fileUrl)

          const assetBlock = await logseq.Editor.insertBlock(
            headerBlock.uuid,
            attachment.title,
            {
              sibling: false,
              properties: {
                'logseq.property.asset/type': ext,
                'logseq.property.asset/external-url': fileUrl,
                'logseq.property.asset/checksum': checksum,
                'logseq.property.asset/size': 0,
              },
            },
          )
          if (assetBlock?.uuid) {
            // Parity with the drag-drop flow's class tag. Not required for
            // the `asset?` predicate (one property is enough) but the guide
            // recommends it for query parity.
            await logseq.Editor.addBlockTag(
              assetBlock.uuid,
              'logseq.class/Asset',
            )
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

  // The page is fully built — navigate to it now. Deferring the redirect to
  // here (createPage above uses redirect:false) means a single-item insert
  // lands on a populated page instead of watching it fill in block by block.
  // Batch passes navigate:false and stays put.
  if (navigate) logseq.App.pushState('page', { name: existingPage.name })

  return { status: 'created', pageName }
}
