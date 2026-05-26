/**
 * Ensures the web-clip tag exists and inherits the shared schema by extending
 * the base reference tag.
 *
 * The companion web-clipper extension tags every clipped page with `webTag` and
 * discovers the schema by walking that tag's inherited properties — so the tag
 * must `extends` the base class the shared properties live on. We never add the
 * properties to the web tag directly: extension is the whole point, so the web
 * tag carries the same property idents as Zotero pages and stays in sync with a
 * single schema. (See `set-logseqdb-schema.ts`, which calls this after building
 * the base, and the Web references section, which calls it on its own.)
 *
 * `addTagExtends` is idempotent — re-adding the same parent is a no-op — so this
 * is safe to run on every Apply. The base tag must already exist (its class is
 * created by `setLogseqDbSchema`); callers gate on `isSchemaAdded`.
 */
export const ensureWebTagExtendsBase = async (
  webTag: string,
  baseTag: string,
): Promise<void> => {
  const name = webTag.trim()
  const base = baseTag.trim()
  if (!name || !base) return

  // A web tag equal to the base would make the base extend itself — skip. The
  // base already carries the schema, so a page tagged with it is fine as-is.
  if (name.toLowerCase() === base.toLowerCase()) return

  const existing = await logseq.Editor.getTag(name)
  if (!existing) await logseq.Editor.createTag(name)

  await logseq.Editor.addTagExtends(name, base)
}

/**
 * Reads the graph to confirm the web tag actually exists and `extends` the base
 * — the live counterpart to `ensureWebTagExtendsBase`.
 *
 * The setup hub's "is the web tag set up?" status used to be derived purely from
 * the persisted `appliedSchema` snapshot, which is a *global* setting and can't
 * see a tag the user deleted *in this graph* (a tag is a class page; deleting it
 * in a DB graph really removes the class). The result: a stale snapshot kept the
 * "Set up web tag" button disabled and the green "extends" message showing even
 * though the tag was gone. So the hub probes the graph instead.
 *
 * A web tag equal to the base needs no link — a page tagged with the base already
 * carries the schema — so that reads as "set up", matching the no-op in
 * `ensureWebTagExtendsBase`. `:logseq.property.class/extends` only exists on
 * classes, so the join restricts `?t` to a class (not a plain page sharing the
 * title); recycled (soft-deleted) classes are excluded via `:deleted-at`.
 */
export const isWebTagExtendingBase = async (
  webTag: string,
  baseTag: string,
): Promise<boolean> => {
  const name = webTag.trim()
  const base = baseTag.trim()
  if (!name || !base) return false
  if (name.toLowerCase() === base.toLowerCase()) return true

  const query = `
    [:find ?t
     :in $ ?web ?base
     :where
     [?t :block/title ?web]
     [?t :logseq.property.class/extends ?parent]
     [?parent :block/title ?base]
     (not [?t :logseq.property/deleted-at _])
     (not [?parent :logseq.property/deleted-at _])]
  `
  try {
    const result = await logseq.DB.datascriptQuery(
      query,
      JSON.stringify(name),
      JSON.stringify(base),
    )
    return Array.isArray(result) && result.length > 0
  } catch {
    return false
  }
}
