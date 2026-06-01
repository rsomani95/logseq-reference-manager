import { IBatchBlock } from '@logseq/libs/dist/LSPlugin'
import { format, parse, parseISO } from 'date-fns'

import {
  ATTACHMENT_EXTERNAL_PDF_LABEL_DEFAULT,
  ATTACHMENTS_BLOCK_NAME_DEFAULT,
  type AttachmentImportMode,
  PROP_PRESETS,
  ZOT_DATA_KEY_MAP,
} from '../constants'
import { getConfiguredTagRules, matchTagRules } from '../extended-tags'
import {
  AttachmentItem,
  CreatorItem,
  PropertyPreset,
  ZotData,
} from '../interfaces'
import { convertPropToKebabCase } from './convert-prop-to-kebab'
import {
  type AssetImportArgs,
  importAnnotationsForAsset,
} from './import-annotations'
import { isRecycledPage } from './is-recycled-page'
import { isSchemaAdded } from './is-schema-added'
import { hasLogseqApiToken } from './logseq-import-edn'
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
 * missing decode (see `dev-notes/logseq-file-links.md`). The asset-block
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

/**
 * Inverse of `pathToFileUrl`: a percent-encoded `file://` URL back to a bare,
 * literal absolute path. Zotero's local API hands imported attachments their
 * on-disk location as exactly such a URL (`file://<dataDir>/storage/<key>/<file>`
 * — see `dev-notes/zotero-attachment-paths.md`); decoding per segment mirrors
 * the per-segment encoding above.
 */
const fileUrlToPath = (fileUrl: string): string =>
  fileUrl
    .replace(/^file:\/\//, '')
    .split('/')
    .map(decodeURIComponent)
    .join('/')

/** SHA-256 hex digest of a string. Needed upstram. */
const sha256Hex = async (s: string): Promise<string> => {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * True if the attachment is a PDF. Prefers Zotero's MIME (`contentType` for
 * `linked_file`, the enclosure `type` for `imported_file` / `imported_url`),
 * with a filename/URL-extension fallback for when Zotero left the MIME blank.
 * `imported_url` is a saved snapshot that's usually HTML but can be a downloaded
 * PDF, so it's checked too. `linked_url` (a web bookmark, no file) is never a
 * PDF.
 */
const isPdfAttachment = (att: AttachmentItem): boolean => {
  if (att.linkMode === 'linked_file') {
    if (att.contentType === 'application/pdf') return true
    return att.path.toLowerCase().endsWith('.pdf')
  }
  if (att.linkMode === 'imported_file' || att.linkMode === 'imported_url') {
    if (att.type === 'application/pdf') return true
    return att.href.toLowerCase().endsWith('.pdf')
  }
  return false
}

/**
 * Bare absolute on-disk path for an attachment whose bytes live on this machine,
 * else null. `linked_file` keeps its path verbatim; `imported_file` /
 * `imported_url` decode the enclosure's `file://` URL, gated on `length`
 * (Zotero only sets it when the stored file is actually present). `linked_url`
 * has no file. See `dev-notes/zotero-attachment-paths.md`.
 */
const attachmentOnDiskPath = (att: AttachmentItem): string | null => {
  if (att.linkMode === 'linked_file') return att.path
  if (att.linkMode === 'imported_file' || att.linkMode === 'imported_url') {
    return att.length == null ? null : fileUrlToPath(att.href)
  }
  return null
}

/**
 * For a PDF backed by a file on this machine, the inputs for a first-class
 * Logseq asset block: the percent-encoded `file://` URL PDF.js loads, the
 * extension, and the byte size (0 when Zotero doesn't expose it). Returns null
 * for anything that shouldn't become an asset — non-PDFs, web bookmarks, and
 * imported PDFs whose bytes aren't actually on disk (`enclosure.length` unset).
 *
 * `linked_file` builds the URL from its bare path; `imported_file` /
 * `imported_url` reuse Zotero's enclosure href, which already *is* such a URL.
 */
const pdfAssetSource = (
  att: AttachmentItem,
): { fileUrl: string; ext: string; size: number } | null => {
  if (!isPdfAttachment(att)) return null
  if (att.linkMode === 'linked_file') {
    return {
      fileUrl: pathToFileUrl(att.path),
      ext: extensionFromPath(att.path),
      size: 0, // not exposed by the API for linked files
    }
  }
  if (att.linkMode === 'imported_file' || att.linkMode === 'imported_url') {
    if (att.length == null) return null // bytes not on this machine
    return {
      fileUrl: att.href,
      ext: extensionFromPath(fileUrlToPath(att.href)),
      size: att.length,
    }
  }
  return null
}

/**
 * Markdown link for attachments that don't take the asset-block route — i.e.
 * everything except on-disk PDFs (those go through `emitAttachmentBlock`'s asset
 * path for the first-class viewer + annotation tooling). That leaves: non-PDF
 * `linked_file` attachments, `linked_url` bookmarks, and imported snapshots
 * (HTML, or a PDF whose bytes aren't on this machine). The `!` prefix (when
 * `openAttachmentInline` is on) makes Logseq try to embed.
 *
 * URL form per link mode (see `dev-notes/logseq-file-links.md`):
 * - `linked_file`: bare absolute path, literal characters (no `file://`, no
 *   percent-encoding) — survives mldoc and reaches `shell.openPath` verbatim.
 * - `imported_file` / `imported_url`: the enclosure is a `file://` URL to the
 *   on-disk copy in Zotero storage; decoded to that same bare-path form.
 * - `linked_url`: the web URL, decoded once for display.
 */
const formatAttachmentMarkdownLink = (att: AttachmentItem): string => {
  let url: string
  if (att.linkMode === 'linked_file') {
    url = att.path
  } else if (att.linkMode === 'linked_url') {
    url = decodeURI(att.url)
  } else {
    // imported_file | imported_url — Zotero's enclosure is a file:// URL to the
    // copy in its storage dir; emit the bare path, same robust form as
    // linked_file.
    url = fileUrlToPath(att.href)
  }
  const prefix = logseq.settings?.openAttachmentInline ? '!' : ''
  return `${prefix}[${att.title}](${url})`
}

/**
 * Inserts the per-attachment block under the wrapping "Attachments" heading.
 * Any PDF backed by a real on-disk file comes in as a first-class Logseq asset
 * block — `linked_file` PDFs (path on disk) and `imported_file` / `imported_url`
 * PDFs alike (Zotero's enclosure resolves to `<dataDir>/storage/<key>/<file>`;
 * see `dev-notes/zotero-attachment-paths.md`). The
 * `:logseq.property.asset/external-url` family + the `logseq.class/Asset` tag
 * make the block an asset entity, so the embedded PDF viewer's annotation
 * tooling activates without popping the "Create asset" modal on first highlight.
 * Everything else — non-PDFs, web bookmarks, and imported PDFs whose bytes
 * aren't on this machine — is a plain markdown link block.
 */
const emitAttachmentBlock = async (
  parentUuid: string,
  attachment: AttachmentItem,
) => {
  const asset = pdfAssetSource(attachment)
  if (asset) {
    const checksum = await sha256Hex(asset.fileUrl)

    const assetBlock = await logseq.Editor.insertBlock(
      parentUuid,
      attachment.title,
      {
        sibling: false,
        properties: {
          'logseq.property.asset/type': asset.ext,
          'logseq.property.asset/external-url': asset.fileUrl,
          'logseq.property.asset/checksum': checksum,
          'logseq.property.asset/size': asset.size,
        },
      },
    )
    if (assetBlock?.uuid) {
      // Parity with the drag-drop flow. Not strictly required by the `asset?`
      // predicate (the property family is enough) but the asset-block guide
      // recommends it for query parity.
      await logseq.Editor.addBlockTag(assetBlock.uuid, 'logseq.class/Asset')
    }
    return assetBlock
  }

  return logseq.Editor.insertBlock(
    parentUuid,
    formatAttachmentMarkdownLink(attachment),
    { sibling: false },
  )
}

/**
 * Builds the single-block "open externally" links string. Currently emits up to
 * two entries — "Open PDF Outside Logseq" (configurable label) targeting the
 * first on-disk PDF, and a fixed "Open in Zotero" pointing at the item's
 * library URI. The split isn't strictly 1:1 (an item may have multiple
 * attachments, the Zotero link goes to the whole item) but that's intentional:
 * for the practitioner-researcher case the "PDF of interest" is typically
 * singular, and the Zotero link is a quick handoff to the source. The PDF can
 * be `linked_file` or an imported file in Zotero storage. Returns `''` when
 * nothing useful can be linked.
 */
const buildExternalLinksContent = (
  attachments: AttachmentItem[],
  libraryLink: string | undefined,
  pdfLabel: string,
): string => {
  const parts: string[] = []
  const firstPdfPath = attachments
    .filter(isPdfAttachment)
    .map(attachmentOnDiskPath)
    .find((p): p is string => p != null)
  if (firstPdfPath) {
    parts.push(`[${pdfLabel}](${firstPdfPath})`)
  }
  if (libraryLink) {
    parts.push(`[Open in Zotero](${libraryLink})`)
  }
  return parts.join(' · ')
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

  /*******
    Insert blocks
    *******/

  let glossaryBatchBlk: IBatchBlock[] = []

  // ─── Attachments ──────────────────────────────────────────────────────
  // Filter by the user's Attachments → import-mode pick (PDFs only / All),
  // emit each filtered attachment as its own block under a configurable
  // heading, and (optionally) append a single "open externally" links block.
  // PDFs from `linked_file` come in as first-class asset blocks; everything
  // else is a markdown link. Annotations land as children of whichever block
  // represents the attachment, so `zotero-attachment-key` stays the sync hook.
  const attachmentsBlockName =
    (logseq.settings?.attachmentsBlockName as string | undefined)?.trim() ||
    ATTACHMENTS_BLOCK_NAME_DEFAULT
  const importMode =
    (logseq.settings?.attachmentImportMode as
      | AttachmentImportMode
      | undefined) ?? 'PDFs only'
  const showExternalLinks =
    (logseq.settings?.attachmentShowExternalLinks as boolean | undefined) ??
    false
  const externalPdfLabel =
    (
      logseq.settings?.attachmentExternalPdfLabel as string | undefined
    )?.trim() || ATTACHMENT_EXTERNAL_PDF_LABEL_DEFAULT

  const filteredAttachments =
    importMode === 'PDFs only'
      ? (zotItem.attachments ?? []).filter(isPdfAttachment)
      : (zotItem.attachments ?? [])

  const externalLinksContent = showExternalLinks
    ? buildExternalLinksContent(
        filteredAttachments,
        zotItem.libraryLink,
        externalPdfLabel,
      )
    : ''

  // PDF asset blocks we create, paired with the inputs the annotation importer
  // needs. Populated in the loop; processed after the page is built so the page
  // paints first and the (one-time, ~10MB) mupdf load happens off the hot path.
  const annotationTargets: AssetImportArgs[] = []

  if (filteredAttachments.length > 0 || externalLinksContent.length > 0) {
    const headerBlock = await logseq.Editor.insertBlock(
      existingPage.uuid,
      attachmentsBlockName,
      { sibling: false },
    )

    if (headerBlock) {
      for (const attachment of filteredAttachments) {
        const attachmentBlock = await emitAttachmentBlock(
          headerBlock.uuid,
          attachment,
        )
        if (!attachmentBlock) continue

        await logseq.Editor.upsertBlockProperty(
          attachmentBlock.uuid,
          'zotero-attachment-key',
          attachment.key,
        )

        // A PDF backed by a real on-disk file became a first-class asset block
        // (pdfAssetSource non-null). That's what annotations attach to — record
        // it as an import target.
        const onDisk = attachmentOnDiskPath(attachment)
        if (pdfAssetSource(attachment) && onDisk) {
          annotationTargets.push({
            assetUuid: attachmentBlock.uuid,
            pageTitle: pageName,
            absPath: onDisk,
            attachmentKey: attachment.key,
          })
        }
      }

      if (externalLinksContent.length > 0) {
        await logseq.Editor.insertBlock(
          headerBlock.uuid,
          externalLinksContent,
          { sibling: false },
        )
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

  // Bring in annotations for each PDF asset — PDF-native first, else Zotero
  // (see services/import-annotations.ts). Best-effort and isolated: a failure
  // never fails the item import. Needs the Logseq API token; when it's missing
  // we skip (hinting once on a single import, staying quiet during a batch).
  if (annotationTargets.length > 0) {
    if (!hasLogseqApiToken()) {
      if (navigate) {
        await logseq.UI.showMsg(
          'Imported the page. Annotation sync needs the Logseq API token — set it in Reference Manager settings (Connections).',
          'warning',
        )
      }
    } else {
      for (const target of annotationTargets) {
        try {
          await importAnnotationsForAsset(target)
        } catch (e) {
          console.warn(`[annotations] import failed for ${target.absPath}:`, e)
        }
      }
    }
  }

  return { status: 'created', pageName }
}
