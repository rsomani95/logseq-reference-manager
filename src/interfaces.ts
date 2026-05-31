/**
 * The interfaces below mirror the JSON the Zotero local/web API returns for an
 * item. The string-literal unions are a *pinned snapshot* of Zotero's
 * contract, not a live binding — refresh them when bumping Zotero support:
 *
 *   • `ZoteroItemType` and `ZoteroCreatorType` come from Zotero's published
 *     `schema.json` (https://github.com/zotero/zotero-schema), snapshotted at
 *     schema `version` 42. That file also maps which creator types are valid
 *     per item type; we deliberately flatten to the full union (a creator type
 *     that's invalid for a given item type simply never appears on it).
 *   • `ZoteroLinkMode`, `ZoteroAnnotationType`, and `ZoteroLibraryType` are not
 *     in schema.json — they're constants in the Zotero client source
 *     (github.com/zotero/zotero: `Zotero.Attachments.LINK_MODE_*` in
 *     `xpcom/attachments.js`, `Zotero.Annotations.ANNOTATION_TYPE_*` in
 *     `xpcom/annotations.js`) and have been stable across Zotero 7–9.
 */

// Regular item types (Zotero's `/itemTypes` endpoint) plus the special
// `attachment` / `annotation` types — present in schema.json but hidden from
// that endpoint, and both reach us as `data.itemType` on child items.
export type ZoteroItemType =
  | 'artwork'
  | 'audioRecording'
  | 'bill'
  | 'blogPost'
  | 'book'
  | 'bookSection'
  | 'case'
  | 'conferencePaper'
  | 'dataset'
  | 'dictionaryEntry'
  | 'document'
  | 'email'
  | 'encyclopediaArticle'
  | 'film'
  | 'forumPost'
  | 'hearing'
  | 'instantMessage'
  | 'interview'
  | 'journalArticle'
  | 'letter'
  | 'magazineArticle'
  | 'manuscript'
  | 'map'
  | 'newspaperArticle'
  | 'note'
  | 'patent'
  | 'podcast'
  | 'preprint'
  | 'presentation'
  | 'radioBroadcast'
  | 'report'
  | 'computerProgram'
  | 'standard'
  | 'statute'
  | 'tvBroadcast'
  | 'thesis'
  | 'videoRecording'
  | 'webpage'
  | 'attachment'
  | 'annotation'

// Zotero.Attachments.LINK_MODE_* — the four ways an attachment is stored.
export type ZoteroLinkMode =
  | 'imported_file' // file copied into Zotero storage
  | 'imported_url' // saved web-page snapshot (HTML in Zotero storage)
  | 'linked_file' // link to a file left in place on disk
  | 'linked_url' // link to a web URL

// `ANNOTATION_TYPE_*` constants (values 1–6) under `Zotero.Annotations`, near
// the top of the client source file:
// https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/annotations.js
// Stable from Zotero 7 through 9 — verified 2026-05-29 by diffing the `7.0`
// branch against `main` (underline + text were Zotero 7's additions over 6's
// four; 8 and 9 added none). To re-check on a newer release, swap the ref in
// that URL for a release branch (`8.0`, `9.0`) or a patch tag (`9.0.4`).
// highlight/underline/text carry `annotationText`; image/ink do not.
export type ZoteroAnnotationType =
  | 'highlight'
  | 'note'
  | 'image'
  | 'ink'
  | 'underline'
  | 'text'

// schema.json creatorTypes, flattened across every item type.
export type ZoteroCreatorType =
  | 'artist'
  | 'attorneyAgent'
  | 'author'
  | 'bookAuthor'
  | 'cartographer'
  | 'castMember'
  | 'chair'
  | 'commenter'
  | 'composer'
  | 'contributor'
  | 'cosponsor'
  | 'counsel'
  | 'creator'
  | 'director'
  | 'editor'
  | 'executiveProducer'
  | 'guest'
  | 'host'
  | 'interviewee'
  | 'interviewer'
  | 'inventor'
  | 'narrator'
  | 'organizer'
  | 'originalCreator'
  | 'performer'
  | 'podcaster'
  | 'presenter'
  | 'producer'
  | 'programmer'
  | 'recipient'
  | 'reviewedAuthor'
  | 'scriptwriter'
  | 'seriesCreator'
  | 'seriesEditor'
  | 'sponsor'
  | 'translator'
  | 'wordsBy'

export type ZoteroLibraryType = 'user' | 'group'

export interface ZotItem {
  key: string
  version: number
  library: {
    type: ZoteroLibraryType
    id: number
    name: string
    links: {
      self: {
        href: string
        type: string
      }
      alternate: {
        href: string
        type: string
      }
    }
  }
  links: {
    self: {
      href: string
      type: string
    }
    alternate: {
      href: string
      type: string
    }
    up?: {
      href: string
      type: string
    }
    attachment?: {
      href: string
      type: string
      attachmentType: string
      attachmentSize: number
    }
    enclosure?: {
      href: string
      type: string
      title: string
      // Absent when Zotero holds the attachment record but the file's bytes
      // aren't on this machine; set (and equal to the byte size) when present.
      // See `dev-notes/zotero-attachment-paths.md`.
      length?: number
    }
  }
  meta: {
    numChildren: number
    creatorSummary?: string
    parsedDate?: string
  }
  data: {
    abstractNote?: string
    accessDate?: string
    annotationAuthorName?: string
    annotationColor?: string
    annotationComment?: string
    annotationPageLabel?: string
    annotationPosition?: string
    annotationSortIndex?: string
    annotationText?: string
    annotationType?: ZoteroAnnotationType
    applicationNumber?: string
    archive?: string
    archiveID?: string
    archiveLocation?: string
    artworkMedium?: string
    artworkSize?: string
    assignee?: string
    audioFileType?: string
    audioRecordingFormat?: string
    billNumber?: string
    blogTitle?: string
    bookTitle?: string
    callNumber?: string
    caseName?: string
    charset?: string
    citationKey?: string
    code?: string
    codeNumber?: string
    codePages?: string
    codeVolume?: string
    collections?: string[]
    committee?: string
    company?: string
    contentType?: string
    country?: string
    court?: string
    creators?: CreatorItem[]
    date?: string
    dateAdded: string
    dateModified: string
    day?: string
    distributor?: string
    docketNumber?: string
    DOI?: string
    edition?: string
    email?: string
    encyclopediaTitle?: string
    extra?: string
    filingDate?: string
    filename?: string
    firstPage?: string
    forumTitle?: string
    genre?: string
    history?: string
    institution?: string
    ISBN?: string
    ISSN?: string
    issue?: string
    issueDate?: string
    issuingAuthority?: string
    itemType: ZoteroItemType
    journalAbbreviation?: string
    key: string
    label?: string
    language?: string
    legalStatus?: string
    legislativeBody?: string
    libraryCatalog?: string
    libraryLink?: string
    license?: string
    linkMode?: ZoteroLinkMode
    manuscriptType?: string
    mapType?: string
    md5?: string
    medium?: string
    meetingName?: string
    meetingPlace?: string
    month?: string
    mtime?: number
    network?: string
    note?: string
    numberOfVolumes?: string
    number?: string
    numPages?: string
    pages?: string
    parentItem?: string
    // linked_file attachments: absolute filesystem path to the file. Set by
    // Zotero (or plugins like ZotMoov, which move files out of Zotero storage
    // and convert imported_file → linked_file with this populated).
    path?: string
    patentNumber?: string
    place?: string
    postType?: string
    presentationType?: string
    publicationTitle?: string
    publisher?: string
    radioProgramTitle?: string
    references?: string
    relations: Record<string, never>
    reportNumber?: string
    reportType?: string
    repository?: string
    rights?: string
    runningTime?: string
    scale?: string
    section?: string
    series?: string
    seriesNumber?: string
    seriesText?: string
    seriesTitle?: string
    shortTitle?: string
    studio?: string
    subject?: string
    system?: string
    tags: TagItem[]
    thesisType?: string
    title: string
    tvProgramTitle?: string
    university?: string
    url?: string
    version: number
    versionNumber?: string
    videoRecordingFormat?: string
    volume?: string
    websiteTitle?: string
    websiteType?: string
    year?: string
  }
}

/**
ZotData maps Zotero schema to Logseq schema
Handles additional schema that Logseq requires
Or conflicts with Logseq's inbuilt properties
**/
export type ZotData = Omit<ZotItem['data'], 'code' | 'note' | 'creators'> & {
  attachments: AttachmentItem[] | undefined
  authors: CreatorItem[] | undefined
  creators: CreatorItem[] | undefined
  citeKey: string
  inGraph: boolean
  libraryLink: string | undefined
  notes: NoteItem[] | undefined
  'zotero-code': string | undefined
}

export interface URLItem {
  title: string
  url: string
}

export interface FileItem {
  href: string
  // Byte size of the stored file. Absent when the bytes aren't on disk (Zotero
  // returns the enclosure record but omits `length`), so it doubles as a
  // "file is actually present locally" signal — see
  // `dev-notes/zotero-attachment-paths.md`.
  length?: number
  title: string
  type: string
}

export interface FileLinkItem {
  title: string
  // Absolute filesystem path. We don't try to resolve Zotero's
  // `attachments:`-prefixed relative paths here — those need the user's
  // "Linked Attachment Base Directory" setting, which the API doesn't expose.
  path: string
  contentType: string
}

interface AttachmentBase {
  key: string
}

export type AttachmentItem =
  | ({
      linkMode: 'linked_url'
    } & URLItem &
      AttachmentBase)
  | ({
      linkMode: 'imported_file'
    } & FileItem &
      AttachmentBase)
  | ({
      // Saved web-page snapshot. Stored in Zotero like an imported_file and
      // reachable through the same enclosure URL, so it shares FileItem.
      linkMode: 'imported_url'
    } & FileItem &
      AttachmentBase)
  | ({
      linkMode: 'linked_file'
    } & FileLinkItem &
      AttachmentBase)

export interface CreatorItem {
  // Personal-author shape — Zotero sends `firstName` + `lastName` for items
  // where each part was filled.
  firstName?: string
  lastName?: string
  // Single-field shape — used by Zotero for institutional / corporate authors
  // ("OpenAI", "Various", working groups), and occasionally for imports where
  // only one name field landed. Consumers that format a creator's name must
  // fall back to this when `firstName` / `lastName` aren't present.
  name?: string
  creatorType: ZoteroCreatorType
}

export interface NoteItem {
  note: string
}

export interface TagItem {
  tag: string
}

export type PropertyPreset = 'Essentials' | 'Full' | 'Custom'

export interface PluginSettings {
  testConnection: string
  propertyPreset: string
  pageProps: ZotItem['data']
  agreementClause: boolean
  openAttachmentInline: boolean
  creatorsAsNodes: boolean
  creatorNameTemplate: string
  pagenameTemplate: string
  zotTag: string
}

// ─── Batch import ───────────────────────────────────────────────────────────

/** A Zotero collection, flattened from the local API's `/collections` response. */
export interface ZotCollection {
  key: string
  name: string
  numItems: number
  // `false` for a top-level collection, otherwise the parent collection's key.
  parentCollection: string | false
}

/** A Zotero saved search, from the local API's `/searches` response. */
export interface ZotSavedSearch {
  key: string
  name: string
}

/** Which source populates the batch-import list. */
export type BatchSource = 'search' | 'collection' | 'savedSearch'
