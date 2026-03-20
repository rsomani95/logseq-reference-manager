import { ZOTERO_LIBRARY_ITEM } from '../constants'
import {
  AnnotationItem,
  AttachmentItem,
  NoteItem,
  ZotData,
  ZotItem,
} from '../interfaces'

export const mapItems = async (
  zotParentItems: ZotItem[],
  noteAndAttachmentItems: ZotItem[],
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
    const { code, ...itemDataWithoutConflicts } = item.data

    return {
      ...itemDataWithoutConflicts,
      annotations: [] as AnnotationItem[],
      attachments: [] as AttachmentItem[],
      citeKey: '',
      inGraph: false,
      libraryLink: '',
      notes: [] as NoteItem[],
      'zotero-code': code,
    }
  })

  for (const item of parentZotData) {
    // Map citeKey
    const title = item.title
    const citeKey = item.citationKey
    item.citeKey = citeKey ?? 'N/A'

    // Map "if in graph"
    const pageToCheck = (logseq.settings!.pagenameTemplate as string)
      .replace('<% citeKey %>', citeKey ?? '$&')
      .replace('<% title %>', title)
    const page = await logseq.Editor.getPage(pageToCheck)
    item.inGraph = !!page

    // Map libraryLink
    item.libraryLink = `${ZOTERO_LIBRARY_ITEM}${item.key}`

    // Collect attachment keys to match grandchildren (e.g. annotations)
    const attachmentKeys = noteAndAttachmentItems
      .filter(
        (child) =>
          child.data.itemType === 'attachment' &&
          child.data.parentItem === item.key,
      )
      .map((child) => child.data.key)

    // Map attachment
    for (const noteAndAttachment of noteAndAttachmentItems) {
      // Only consider direct children or grandchildren (via attachments)
      if (
        noteAndAttachment.data.parentItem !== item.key &&
        !attachmentKeys.includes(noteAndAttachment.data.parentItem ?? '')
      ) {
        continue
      }

      if (noteAndAttachment.data.itemType === 'attachment') {
        /*
         ITEM TYPE == ATTACHMENT
         */
        if (
          noteAndAttachment.data.linkMode === 'imported_file' &&
          noteAndAttachment.links.enclosure
        ) {
          item.attachments.push({
            linkMode: 'imported_file',
            ...noteAndAttachment.links.enclosure,
          })
        } else if (
          noteAndAttachment.data.linkMode === 'linked_url' &&
          noteAndAttachment.data.url
        ) {
          item.attachments.push({
            linkMode: 'linked_url',
            title: noteAndAttachment.data.title,
            url: noteAndAttachment.data.url,
          })
        }
      } else if (
        noteAndAttachment.data.itemType === 'note' &&
        noteAndAttachment.data.note
      ) {
        /*
         ITEM TYPE == NOTE
         */
        item.notes.push({ note: noteAndAttachment.data.note })
      } else if (noteAndAttachment.data.itemType === 'annotation') {
        /*
         ITEM TYPE == ANNOTATION
         */
        item.annotations.push({
          annotationText: noteAndAttachment.data.annotationText ?? '',
          annotationComment: noteAndAttachment.data.annotationComment ?? '',
        })
      }
    }
  }

  return parentZotData
}
