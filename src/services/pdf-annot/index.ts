/**
 * pdf-annot-logseq (TypeScript port, stage 1) — public API.
 *
 * Extract native PDF annotations from PDF bytes and convert them into Logseq
 * DB-graph annotation records (the `hl-value` shape) + a build-DSL EDN payload.
 * Filesystem-free and environment-agnostic so it runs inside the Logseq plugin's
 * Electron renderer.
 *
 * Engine: mupdf (WASM) — the same MuPDF engine the Python source wraps via fitz.
 */

export {
  colorFromCss,
  DB_IDENT,
  DEFAULT_COLOR,
  hexOf,
  LOGSEQ_COLORS,
  LOGSEQ_PALETTE,
  mapColor,
  NAMED_COLORS,
  nearestLogseq,
  nearestName,
  to255,
} from './colors'
export {
  buildRecord,
  convert,
  DEFAULT_ASSET_UUID,
  MARKUP_SUBTYPES,
  NOTE_SUBTYPES,
  pageMetaFor,
  pickUuid,
} from './convert'
export {
  ednAnnotationBlock,
  ednFloat,
  ednHlValue,
  ednInt,
  ednLiveBlock,
  ednRect,
  ednStr,
  emitLiveEdn,
  emitSelfContainedEdn,
  emptyEdn,
} from './edn'
export { extract } from './extract'
export {
  bounding,
  decodeQuadpoints,
  flipRect,
  pyRound,
  quadRectToFitz,
  quadStoredRects,
  scaledToViewport,
  toStored,
} from './geometry'
export { pageGeometriesFromBytes } from './pdf-pages'
export type {
  AnnotationGeometry,
  AnnotationRecord,
  ColorInfo,
  ColorName,
  ConvertedRecord,
  ConvertResult,
  ConvertStatus,
  DistinctColor,
  ExtractResult,
  HlValue,
  LinkTarget,
  PageGeom,
  Quad,
  RGB,
  StoredRect,
  ValidateResult,
} from './types'
export {
  uuidForZoteroAnnotation,
  uuidv5,
  ZOTERO_ANNOTATION_NAMESPACE,
} from './uuid'
export { validate } from './validate'
// Zotero-native annotation path (case a): convert annotations stored in Zotero's
// database (not embedded in the PDF) into the same Logseq record/EDN shape.
export type {
  ZoteroAnnotationData,
  ZoteroAnnotationType,
  ZoteroConvertOptions,
  ZoteroPosition,
} from './zotero'
export { convertZoteroAnnotations, parseZoteroPosition } from './zotero'
