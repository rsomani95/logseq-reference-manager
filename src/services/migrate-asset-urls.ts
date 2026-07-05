/**
 * Batch-normalize every asset block's `:logseq.property.asset/external-url` to the
 * bare on-disk path form (see `asset-url.ts` + `../../dev-notes/debugging/reading-local-files.md`).
 *
 * Powers the `Reference Manager: Update External File URLs` command. Pages
 * imported before the bare-path fix hold `file://` URLs, which Logseq's PDF viewer
 * can't open on builds ≥ nightly `20260612` ("Missing PDF"); re-import returns
 * `'exists'` without rewriting and re-sync only reads, so a one-shot rewrite is the
 * only fix. Idempotent: a value that's already a bare path is left untouched, so
 * the command is a safe no-op on an already-migrated (or freshly-imported) graph.
 */
import { externalUrlToPath, sha256Hex } from './asset-url'

// No leading colon: the write/ident form (matches the keys `handle-zot-db`
// writes via insertBlock and what `upsertBlockProperty` expects). The Datascript
// query below re-adds the `:` for the attribute position.
const ASSET_EXTERNAL_URL_PROP = 'logseq.property.asset/external-url'
const ASSET_CHECKSUM_PROP = 'logseq.property.asset/checksum'

export interface AssetUrlUpdateResult {
  /** asset blocks carrying an external-url. */
  total: number
  /** rewritten (held a `file://` / `assets://` URL). */
  updated: number
  /** already a bare path — left as-is. */
  unchanged: number
  /** blocks whose update threw (see console). */
  failed: number
}

/**
 * Rewrite every asset `external-url` to its bare-path form. One Datascript query
 * reads all asset blocks; only the ones that actually change are upserted, with
 * the `checksum` recomputed so migrated blocks match freshly-imported ones. Safe
 * to re-run.
 */
export const updateExternalFileUrls =
  async (): Promise<AssetUrlUpdateResult> => {
    const rows = (await logseq.DB.datascriptQuery(
      `[:find ?u ?url
        :where [?b :block/uuid ?u] [?b :${ASSET_EXTERNAL_URL_PROP} ?url]]`,
    )) as [string, string][] | null

    const result: AssetUrlUpdateResult = {
      total: rows?.length ?? 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
    }

    for (const [uuid, url] of rows ?? []) {
      const path = externalUrlToPath(url)
      if (path === url) {
        result.unchanged += 1
        continue
      }
      try {
        await logseq.Editor.upsertBlockProperty(
          uuid,
          ASSET_EXTERNAL_URL_PROP,
          path,
        )
        await logseq.Editor.upsertBlockProperty(
          uuid,
          ASSET_CHECKSUM_PROP,
          await sha256Hex(path),
        )
        result.updated += 1
      } catch (e) {
        result.failed += 1
        console.warn(`[asset-urls] failed to update ${uuid} (${url}):`, e)
      }
    }
    return result
  }
