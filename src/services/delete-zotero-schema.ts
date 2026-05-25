import type { PageEntity } from '@logseq/libs/dist/LSPlugin'

import { ZOTERO_PROP } from '../constants'

const matchZotProps = (props: PageEntity[] | null): PageEntity[] =>
  (props ?? []).filter((p) => p.ident?.includes(ZOTERO_PROP))

/**
 * Removes every property this plugin created (matched by the `ZOTERO_PROP`
 * ident namespace, so the user's own properties are never touched). The Zotero
 * tag/class page is left intact — deleting it would clear its backlinks, a
 * deliberate manual op.
 *
 * The blocker (the reason the old command "succeeded" but removed nothing): a
 * property whose block carries `:logseq.property/hide?` = true silently resists
 * deletion — `removeProperty`/`removeBlock` return without error but the entity
 * stays. Verified against a running DB graph: hide?=true → no-op; strip it →
 * deletes; `:logseq.property/hide-empty-value` does NOT block. `set-logseqdb-
 * schema` sets hide? on every property it creates, so every Zotero prop hit
 * this. So per property we **clear `hide?` first**, then `removeProperty(ident)`
 * (full `:db/ident`, never a bare name — see LOGSEQ_API_LEARNINGS), falling back
 * to `removeBlock(uuid)`, re-checking via the (fresh) `getAllProperties` after
 * each and logging the outcome — a destructive admin action is worth a console
 * trail. Returns the count removed.
 */
export const deleteZoteroSchema = async (): Promise<number> => {
  const { Editor } = logseq
  const before = matchZotProps(await Editor.getAllProperties())

  console.group('[zotero] delete schema')
  console.log(
    `matched ${before.length} propert${before.length === 1 ? 'y' : 'ies'} · methods:`,
    {
      removeProperty: typeof Editor.removeProperty,
      removeBlock: typeof Editor.removeBlock,
    },
  )
  if (before[0]) console.log('sample property entity:', before[0])

  const stillPresent = async (ident: string): Promise<boolean> => {
    const now = matchZotProps(await Editor.getAllProperties())
    return now.some((q) => q.ident === ident)
  }

  const removeOne = async (p: PageEntity) => {
    const ident = p.ident
    const uuid = p.uuid
    if (!ident) return

    // The actual fix: `:logseq.property/hide?` pins the property against
    // deletion (see the docstring). Clear it before attempting removal —
    // otherwise removeProperty/removeBlock both no-op. (`hide-empty-value`
    // doesn't block, so we leave it.)
    if (uuid) {
      try {
        await Editor.removeBlockProperty(uuid, 'logseq.property/hide?')
      } catch (e) {
        console.warn(`  couldn't clear hide? on ${ident}:`, e)
      }
    }

    const attempts: [string, () => Promise<unknown>][] = [
      [`removeProperty(${ident})`, () => Editor.removeProperty(ident)],
    ]
    if (uuid) {
      attempts.push([`removeBlock(${uuid})`, () => Editor.removeBlock(uuid)])
    }

    for (const [label, run] of attempts) {
      try {
        await run()
      } catch (e) {
        console.warn(`  ${label} threw:`, e)
        continue
      }
      if (!(await stillPresent(ident))) {
        console.log(`  removed via ${label}`)
        return
      }
      console.log(`  ${label} → still present`)
    }
    console.warn(`  could not remove ${ident}`)
  }

  for (const p of before) await removeOne(p)

  const after = matchZotProps(await Editor.getAllProperties())
  console.log(`remaining: ${after.length}`)
  console.groupEnd()
  return Math.max(0, before.length - after.length)
}
