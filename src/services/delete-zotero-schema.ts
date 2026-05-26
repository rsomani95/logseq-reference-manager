import type { PageEntity } from '@logseq/libs/dist/LSPlugin'

import { ZOTERO_PROP } from '../constants'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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
 * this. So we **clear `hide?` first**, then `removeProperty(ident)` (full
 * `:db/ident`, never a bare name — see LOGSEQ_API_LEARNINGS), falling back to
 * `removeBlock(uuid)`, re-checking via the (fresh) `getAllProperties` after each.
 *
 * The settle race (why clearing hide? still wasn't enough): clearing hide? and
 * calling removeProperty back-to-back in the same tick RACES the uncommitted
 * write — removeProperty reads a hide? that's still `true` and no-ops, so the
 * property survives anyway. (Confirmed against a live graph: removeProperty with
 * hide? still set → no-op; after the clear settles → deletes. The original
 * verification only "passed" because manual HTTP calls had inter-call latency
 * that let the write commit; in-plugin the awaits resolve fast enough to lose
 * the race — the bug behind "deleted and re-applied, but properties stayed the
 * old type".) So we clear hide? on EVERY property first, settle, then remove —
 * and `removeOne` re-clears + retries as a backstop for a slow commit. A
 * destructive admin action is worth a console trail. Returns the count removed.
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

  // Clear `:logseq.property/hide?` — it pins the property against deletion
  // (`hide-empty-value` doesn't block, so we leave it). Done up front for the
  // whole batch so the writes commit before any removeProperty reads them (see
  // the settle race in the docstring).
  const clearHide = async (p: PageEntity) => {
    if (!p.uuid) return
    try {
      await Editor.removeBlockProperty(p.uuid, 'logseq.property/hide?')
    } catch (e) {
      console.warn(`  couldn't clear hide? on ${p.ident}:`, e)
    }
  }

  const removeOne = async (p: PageEntity) => {
    const ident = p.ident
    const uuid = p.uuid
    if (!ident) return

    const attempts: [string, () => Promise<unknown>][] = [
      [`removeProperty(${ident})`, () => Editor.removeProperty(ident)],
    ]
    if (uuid) {
      attempts.push([`removeBlock(${uuid})`, () => Editor.removeBlock(uuid)])
    }

    // Up to 3 passes: if the property survives, its hide? clear likely hadn't
    // committed yet — re-clear, let it settle, and try again.
    for (let pass = 1; pass <= 3; pass++) {
      for (const [label, run] of attempts) {
        try {
          await run()
        } catch (e) {
          console.warn(`  ${label} threw:`, e)
          continue
        }
        if (!(await stillPresent(ident))) {
          console.log(
            `  removed via ${label}${pass > 1 ? ` (pass ${pass})` : ''}`,
          )
          return
        }
        console.log(`  ${label} → still present (pass ${pass})`)
      }
      await clearHide(p)
      await sleep(120)
    }
    console.warn(`  could not remove ${ident}`)
  }

  // Phase 1: clear hide? on every matched property, then settle so the writes
  // are committed before phase 2 reads them. Phase 2: remove each.
  for (const p of before) await clearHide(p)
  await sleep(200)
  for (const p of before) await removeOne(p)

  const after = matchZotProps(await Editor.getAllProperties())
  console.log(`remaining: ${after.length}`)
  console.groupEnd()
  return Math.max(0, before.length - after.length)
}
