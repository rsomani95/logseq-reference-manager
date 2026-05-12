import { PageEntity } from '@logseq/libs/dist/LSPlugin'

/**
 * Logseq DB graphs don't hard-delete pages — they move them to a Recycle
 * bin for 30 days. `logseq.Editor.getPage` still returns these pages, which
 * breaks the plugin's "is this in the graph?" check and causes the insert
 * flow to short-circuit on a stale entity.
 *
 * A recycled page is marked with the internal `:logseq.property/deleted-at`
 * datetime attribute. The attribute is `:public? false` in Logseq's schema,
 * so this is best-effort: if the attribute is renamed/removed in a future
 * Logseq version, we fall back to "not recycled" rather than blocking the
 * user.
 */
export const isRecycledPage = async (page: PageEntity): Promise<boolean> => {
  try {
    const query = `
      [:find ?deleted-at
       :where
       [?p :block/uuid #uuid "${page.uuid}"]
       [?p :logseq.property/deleted-at ?deleted-at]]
    `
    const result = await logseq.DB.datascriptQuery(query)
    return Array.isArray(result) && result.length > 0
  } catch {
    return false
  }
}
