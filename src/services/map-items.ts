import {
  MAP_CHUNK_INITIAL,
  MAP_CHUNK_MAX,
  ZOTERO_LIBRARY_ITEM,
} from '../constants'
import { AttachmentItem, NoteItem, ZotData, ZotItem } from '../interfaces'
import { buildZoteroCodeIndex, isItemInGraph } from './zotero-code-index'

export interface MapItemsOptions {
  /**
   * Called after each chunk of in-graph lookups resolves, with every item
   * mapped so far. Lets the batch view paint its first items immediately
   * instead of waiting on the whole container.
   */
  onChunk?: (itemsSoFar: ZotData[]) => void
  /**
   * Checked between chunks; when it returns true the in-graph pass stops
   * early (the partial result is still returned).
   */
  isCancelled?: () => boolean
}

export const mapItems = async (
  zotParentItems: ZotItem[],
  noteAndAttachmentItems: ZotItem[],
  options: MapItemsOptions = {},
): Promise<ZotData[]> => {
  /*
   New props required:
   - attachments
   - citeKey
   - inGraph
   - libraryLink
   - notes

   Conflict with inbuilt props:
   - code
   - tags
   */
  const parentZotData = zotParentItems.map((item) => {
    const {
      code,
      creators: rawCreators,
      ...itemDataWithoutConflicts
    } = item.data

    // Zotero's API doesn't return `year`; derive it from the parsed date.
    const yearFromDate = item.data.date
      ? new Date(item.data.date).getFullYear()
      : NaN
    const year = Number.isNaN(yearFromDate)
      ? item.data.year
      : yearFromDate.toString()

    const authors = rawCreators?.filter((c) => c.creatorType === 'author')
    const creators = rawCreators?.filter((c) => c.creatorType !== 'author')

    return {
      ...itemDataWithoutConflicts,
      year,
      attachments: [] as AttachmentItem[],
      authors,
      creators,
      citeKey: '',
      inGraph: false,
      libraryLink: '',
      notes: [] as NoteItem[],
      'zotero-code': item.key,
    }
  })

  // Synchronous join pass: citeKey, libraryLink, and the direct note /
  // attachment children. (Annotations aren't joined here anymore — the
  // annotation importer reads them from the PDF file / Zotero on demand.) The
  // `inGraph` badge is resolved separately below — it's the only async (slow) part.
  for (const item of parentZotData) {
    item.citeKey = item.citationKey ?? 'N/A'
    item.libraryLink = `${ZOTERO_LIBRARY_ITEM}${item.key}`

    for (const child of noteAndAttachmentItems) {
      if (child.data.parentItem !== item.key) continue

      if (child.data.itemType === 'note' && child.data.note) {
        item.notes.push({ note: child.data.note })
      } else if (child.data.itemType === 'attachment') {
        if (child.data.linkMode === 'imported_file' && child.links.enclosure) {
          item.attachments.push({
            linkMode: 'imported_file',
            key: child.data.key,
            ...child.links.enclosure,
          })
        } else if (
          child.data.linkMode === 'imported_url' &&
          child.links.enclosure
        ) {
          // Saved web-page snapshot — stored like an imported_file and reached
          // through the same enclosure URL.
          item.attachments.push({
            linkMode: 'imported_url',
            key: child.data.key,
            ...child.links.enclosure,
          })
        } else if (child.data.linkMode === 'linked_url' && child.data.url) {
          item.attachments.push({
            linkMode: 'linked_url',
            key: child.data.key,
            title: child.data.title,
            url: child.data.url,
          })
        } else if (child.data.linkMode === 'linked_file' && child.data.path) {
          item.attachments.push({
            linkMode: 'linked_file',
            key: child.data.key,
            title: child.data.title,
            path: child.data.path,
            contentType: child.data.contentType ?? '',
          })
        }
      }
    }
  }

  // In-graph pass: an item is "in graph" when the graph already holds a page
  // carrying its Zotero item key (`zotero-code`). Matching the key — not a
  // page name rebuilt from `pagenameTemplate` — means renaming an imported
  // page in Logseq doesn't flip its badge back to "not in graph". One bulk
  // query builds the index; the per-item check is then an instant Map lookup.
  // Still walked in growing chunks, with a yield between them, so a big
  // container's list paints progressively rather than in one jump.
  const codeIndex = await buildZoteroCodeIndex()
  const { onChunk, isCancelled } = options
  let cursor = 0
  let chunkSize = MAP_CHUNK_INITIAL
  while (cursor < parentZotData.length) {
    if (isCancelled?.()) break
    const chunk = parentZotData.slice(cursor, cursor + chunkSize)
    for (const item of chunk) {
      item.inGraph = isItemInGraph(item, codeIndex)
    }
    cursor += chunk.length
    onChunk?.(parentZotData.slice(0, cursor))
    // Hand the frame back to the browser so React actually paints this chunk
    // before the next one starts.
    if (onChunk && cursor < parentZotData.length) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    chunkSize = Math.min(chunkSize * 2, MAP_CHUNK_MAX)
  }

  return parentZotData
}
