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
