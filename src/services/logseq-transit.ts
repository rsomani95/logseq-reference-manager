/**
 * Transit-JSON encoder for Logseq's `logseq.db.sqlite.build` import payload.
 *
 * The desktop HTTP API method `logseq.cli.import_edn` expects its single arg to
 * be a **Transit-encoded** string of the build map — not raw EDN. (See
 * `@logseq/cli` `commands/import_edn.cljs`: it reads the EDN file, parses it, and
 * sends `(sqlite-util/transit-write import-map)`.) Verified against the live API:
 * a no-op map returns HTTP 200.
 *
 * We emit **uncached** Transit-JSON — the reader accepts the uncached form, so we
 * skip the `"^0"`/`"^1"` key-cache optimization for simplicity. Encoding rules
 * (cognitect transit-json):
 *   - map     -> ["^ ", k0, v0, k1, v1, ...]   (the "^ " map marker)
 *   - keyword -> "~:" + name                   (`:block/uuid` -> "~:block/uuid")
 *   - uuid    -> "~u" + uuid-string            (`#uuid "..."`)
 *   - string  -> as-is, unless it begins with `~`, `^`, or "`", which is escaped
 *               with a single leading `~` (so annotation text starting with one of
 *               those isn't mis-read as a tagged value)
 *   - number / boolean / array -> native JSON
 *
 * The build map mirrors `pdf-annot/edn.ts`'s `emitLiveEdn` exactly (the validated
 * attach-under-asset payload): each annotation block is parented under the PDF
 * asset block by uuid and declared under the host reference page by title.
 */
import type { ConvertedRecord, HlValue, StoredRect } from './pdf-annot/types'

interface Kw {
  readonly __t: 'kw'
  readonly name: string
}
interface Uuid {
  readonly __t: 'uuid'
  readonly v: string
}
interface TMap {
  readonly __t: 'map'
  readonly pairs: ReadonlyArray<readonly [TNode, TNode]>
}

/** A node in the transit value tree. */
export type TNode =
  | Kw
  | Uuid
  | TMap
  | string
  | number
  | boolean
  | null
  | readonly TNode[]

export const kw = (name: string): Kw => ({ __t: 'kw', name })
export const tuuid = (v: string): Uuid => ({ __t: 'uuid', v })
export const tmap = (pairs: ReadonlyArray<readonly [TNode, TNode]>): TMap => ({
  __t: 'map',
  pairs,
})

const escapeStr = (s: string): string => {
  const c = s[0]
  return c === '~' || c === '^' || c === '`' ? `~${s}` : s
}

const isTagged = (n: TNode): n is Kw | Uuid | TMap =>
  typeof n === 'object' && n !== null && !Array.isArray(n) && '__t' in n

function toJson(node: TNode): unknown {
  if (node === null) return null
  if (typeof node === 'string') return escapeStr(node)
  if (typeof node === 'number' || typeof node === 'boolean') return node
  if (Array.isArray(node)) return node.map(toJson)
  if (isTagged(node)) {
    if (node.__t === 'kw') return `~:${node.name}`
    if (node.__t === 'uuid') return `~u${node.v}`
    // map -> ["^ ", k, v, ...]
    const out: unknown[] = ['^ ']
    for (const [k, v] of node.pairs) {
      out.push(toJson(k), toJson(v))
    }
    return out
  }
  // unreachable for well-formed trees
  throw new Error('transit: cannot encode value')
}

/** Serialize a transit value tree to the JSON string the HTTP API arg expects. */
export function transitWrite(node: TNode): string {
  return JSON.stringify(toJson(node))
}

const rectNode = (r: StoredRect): TNode =>
  tmap([
    [kw('x1'), r.x1],
    [kw('y1'), r.y1],
    [kw('x2'), r.x2],
    [kw('y2'), r.y2],
    [kw('width'), r.width],
    [kw('height'), r.height],
  ])

const hlValueNode = (hv: HlValue): TNode =>
  tmap([
    [kw('id'), tuuid(hv.id)],
    [kw('page'), hv.page],
    [
      kw('position'),
      tmap([
        [kw('page'), hv.position.page],
        [kw('bounding'), rectNode(hv.position.bounding)],
        [kw('rects'), hv.position.rects.map(rectNode)],
      ]),
    ],
    [kw('content'), tmap([[kw('text'), hv.content.text]])],
    [kw('properties'), tmap([[kw('color'), hv.properties.color]])],
  ])

/** One annotation block, parented under the asset block by uuid (live form). */
const blockNode = (rec: ConvertedRecord, assetRef: TNode): TNode => {
  const props: Array<readonly [TNode, TNode]> = [
    [kw('logseq.property/ls-type'), kw('annotation')],
    [kw('logseq.property/asset'), assetRef],
    // hl_color_db_ident is the full ident WITH a leading colon
    // (":logseq.property/color.yellow"); a transit keyword drops it.
    [
      kw('logseq.property.pdf/hl-color'),
      kw(rec.hl_color_db_ident.replace(/^:/, '')),
    ],
    [kw('logseq.property.pdf/hl-page'), rec.hl_page],
    [kw('logseq.property.pdf/hl-value'), hlValueNode(rec.hl_value)],
  ]
  const pairs: Array<readonly [TNode, TNode]> = [
    [kw('block/uuid'), tuuid(rec.uuid)],
    [kw('block/title'), rec.block_title],
    [kw('block/parent'), tmap([[kw('db/id'), assetRef]])],
    [kw('build/keep-uuid?'), true],
    [kw('build/tags'), [kw('logseq.class/Pdf-annotation')]],
    [kw('build/properties'), tmap(props)],
  ]
  // A markup highlight's comment becomes a nested child block (Zotero path only;
  // the PDF path leaves these unset). Stable comment_uuid keeps re-sync
  // idempotent. The trim() check mirrors edn.ts so the two serializers stay
  // provably identical even if a future producer passes a blank comment.
  if (rec.comment && rec.comment.trim() !== '' && rec.comment_uuid) {
    pairs.push([
      kw('build/children'),
      [
        tmap([
          [kw('block/uuid'), tuuid(rec.comment_uuid)],
          [kw('block/title'), rec.comment],
          [kw('build/keep-uuid?'), true],
        ]),
      ],
    ])
  }
  return tmap(pairs)
}

/**
 * Build the live `sqlite.build` import map that attaches `records` as children of
 * the PDF asset block (by uuid), declared under the existing reference page (by
 * title). Mirrors `pdf-annot/edn.ts` `emitLiveEdn`. `:build/keep-uuid?` on every
 * block makes a re-import upsert by uuid rather than duplicate.
 */
export function buildLiveImportMap(
  records: ConvertedRecord[],
  assetUuid: string,
  pageTitle: string,
): TNode {
  // [:block/uuid #uuid "<asset>"] — reused for both :block/parent and :asset.
  const assetRef: TNode = [kw('block/uuid'), tuuid(assetUuid)]
  const blocks: TNode[] = records.map((rec) => blockNode(rec, assetRef))
  return tmap([
    [
      kw('pages-and-blocks'),
      [
        tmap([
          [kw('page'), tmap([[kw('block/title'), pageTitle]])],
          [kw('blocks'), blocks],
        ]),
      ],
    ],
    [kw('properties'), tmap([])],
    [kw('classes'), tmap([])],
  ])
}
