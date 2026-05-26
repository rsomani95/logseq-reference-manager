import { useEffect, useState } from 'react'

import { deleteZoteroSchema } from '../../services/delete-zotero-schema'
import { isSchemaAdded } from '../../services/is-schema-added'
import {
  baseSchemaDiffers,
  clearAppliedSnapshot,
  currentSchemaConfig,
  readAppliedSnapshot,
  type SchemaSnapshot,
  webTagDiffers,
  writeAppliedSnapshot,
} from '../../services/schema-snapshot'
import { setLogseqDbSchema } from '../../services/set-logseqdb-schema'
import {
  ensureWebTagExtendsBase,
  isWebTagExtendingBase,
} from '../../services/set-web-schema'

export interface SchemaState {
  // Live (raw, untrimmed) schema-relevant config — the controlled value for the
  // tag/preset/custom-list/creators/web-tag inputs across the hub's sections.
  config: SchemaSnapshot
  // Is the base schema applied to the graph? `null` until the open-time probe
  // resolves. Drives nav ticks, the landing section, and section gating.
  schemaReady: boolean | null
  // The Apply / Set-up buttons are enabled only when these are true — i.e. when
  // the live config actually differs from what was last applied.
  baseDirty: boolean
  webDirty: boolean
  // Does the graph actually have the web tag extending the base right now? `null`
  // until the open-time probe resolves. Unlike the snapshot-derived `webDirty`,
  // this catches a tag the user deleted in Logseq (the snapshot can't see that).
  webLinked: boolean | null
  // Has a web tag ever been wired (so "set up" copy can differ from "changed")?
  webApplied: boolean
  applying: boolean
  deleting: boolean
  linking: boolean
  updateConfig: (patch: Partial<SchemaSnapshot>) => void
  applySchema: () => Promise<void>
  deleteSchema: () => Promise<void>
  setUpWebTag: () => Promise<void>
}

/**
 * Single source of truth for everything schema in the setup hub. Lifted out of
 * the individual sections because the schema spans them: the base tag + preset +
 * custom list live in the Schema section, "store creators as page references"
 * lives in Import Formats, and the web tag lives in Web references — yet they
 * share one Apply and one notion of "dirty". Centralizing also collapses the
 * three separate `isSchemaAdded` probes the sections used to run into one.
 */
export const useSchemaState = (): SchemaState => {
  const [config, setConfig] = useState<SchemaSnapshot>(() =>
    currentSchemaConfig(),
  )
  // `undefined` = the open-time probe hasn't resolved; `null` = resolved, nothing
  // applied; an object = the last-applied config. The undefined state keeps the
  // buttons from flashing enabled before we know whether a schema exists.
  const [applied, setApplied] = useState<SchemaSnapshot | null | undefined>(
    undefined,
  )
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null)
  const [webLinked, setWebLinked] = useState<boolean | null>(null)
  const [applying, setApplying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [linking, setLinking] = useState(false)

  // One probe on open. `isSchemaAdded()` is the authoritative, *per-graph* check;
  // the snapshot (`appliedSchema`) is a GLOBAL setting — one file shared by every
  // graph (see settings.md) — so a schema applied in one graph leaves a snapshot
  // that leaks into graphs where nothing was ever applied, falsely matching the
  // live config and disabling the first-ever Apply. So trust the snapshot only
  // when the schema actually exists *in this graph*:
  //   • not applied here → applied = null (ignore any stale global snapshot), so
  //     baseDirty is true and the first Apply is enabled even at the defaults.
  //   • applied but no snapshot (pre-snapshot install) → migrate: seed the BASE
  //     fields from current settings — assume "what's set now is applied", so
  //     Apply starts disabled rather than falsely lit — but seed `webTag` empty
  //     so the idempotent "Set up web tag" is offered once (the base probe can't
  //     confirm the web tag was actually wired). Both self-heal on the next Apply.
  useEffect(() => {
    let alive = true
    void (async () => {
      const ready = await isSchemaAdded().catch(() => false)
      if (!alive) return
      let snap = ready ? readAppliedSnapshot() : null
      if (ready && !snap) {
        snap = { ...currentSchemaConfig(), webTag: '' }
        writeAppliedSnapshot(snap)
      }
      setSchemaReady(ready)
      setApplied(snap) // null when nothing applied IN THIS GRAPH

      // Probe the actual web→base link. The snapshot says nothing about whether
      // the tag still exists in the graph (the user can delete it in Logseq),
      // so this is what tells a wired tag apart from a stale snapshot. Only
      // meaningful once the base exists; otherwise the section is gated anyway.
      const cfg = currentSchemaConfig()
      const linked = ready
        ? await isWebTagExtendingBase(cfg.webTag, cfg.zotTag).catch(() => false)
        : false
      if (!alive) return
      setWebLinked(linked)
    })()
    return () => {
      alive = false
    }
  }, [])

  // Sections call this on every schema-relevant edit: update the live config and
  // persist the same keys. The keys of SchemaSnapshot are exactly their settings
  // keys, so the patch doubles as the settings update.
  const updateConfig = (patch: Partial<SchemaSnapshot>) => {
    setConfig((prev) => ({ ...prev, ...patch }))
    void logseq.updateSettings(patch as Record<string, unknown>)
  }

  const applySchema = async () => {
    if (!config.zotTag.trim()) {
      await logseq.UI.showMsg('Enter a tag name first.', 'warning')
      return
    }
    setApplying(true)
    try {
      // Flush the live config before setLogseqDbSchema reads it back, so a quick
      // change-then-apply can't race the (fire-and-forget) persists in updateConfig.
      await logseq.updateSettings({
        zotTag: config.zotTag,
        propertyPreset: config.propertyPreset,
        pageProps: config.pageProps,
        creatorsAsNodes: config.creatorsAsNodes,
        webTag: config.webTag,
      })
      await setLogseqDbSchema()
      const ready = await isSchemaAdded()
      setSchemaReady(ready)
      if (ready) {
        // setLogseqDbSchema also wires the web tag (with config.webTag), so the
        // whole live config is now the applied truth — snapshot it verbatim.
        const snap = { ...config }
        writeAppliedSnapshot(snap)
        setApplied(snap)
        // Apply also wires the web tag; re-derive the link from the graph.
        setWebLinked(
          await isWebTagExtendingBase(config.webTag, config.zotTag).catch(
            () => false,
          ),
        )
      }
    } catch (e) {
      await logseq.UI.showMsg(
        `Schema setup failed: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    } finally {
      setApplying(false)
    }
  }

  const deleteSchema = async () => {
    setDeleting(true)
    try {
      const removed = await deleteZoteroSchema()
      // Re-derive applied state from the graph rather than assuming success.
      const stillThere = await isSchemaAdded()
      setSchemaReady(stillThere)
      if (!stillThere) {
        clearAppliedSnapshot()
        setApplied(null)
      }
      if (stillThere) {
        await logseq.UI.showMsg(
          removed > 0
            ? `Removed ${removed}, but some reference properties remain — see the console.`
            : 'Couldn’t remove the reference properties — see the console.',
          'warning',
        )
      } else {
        await logseq.UI.showMsg(
          removed > 0
            ? `Removed ${removed} reference ${removed === 1 ? 'property' : 'properties'}.`
            : 'No reference properties to remove.',
          'success',
        )
      }
    } catch (e) {
      await logseq.UI.showMsg(
        `Couldn't delete schema: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    } finally {
      setDeleting(false)
    }
  }

  const setUpWebTag = async () => {
    const webTag = config.webTag
    if (!webTag.trim()) {
      await logseq.UI.showMsg('Enter a web tag name first.', 'warning')
      return
    }
    if (!schemaReady) {
      await logseq.UI.showMsg(
        'Apply the shared schema first (Schema section).',
        'warning',
      )
      return
    }
    setLinking(true)
    try {
      // Flush before wiring, then make the tag extend the base so it inherits
      // the schema. Record only the webTag against the existing snapshot — the
      // base fields weren't touched.
      await logseq.updateSettings({ webTag })
      await ensureWebTagExtendsBase(webTag, config.zotTag)
      setApplied((prev) => {
        const base = prev ?? currentSchemaConfig()
        const next = { ...base, webTag }
        writeAppliedSnapshot(next)
        return next
      })
      // Re-derive the link from the graph rather than assuming it took.
      setWebLinked(
        await isWebTagExtendingBase(webTag, config.zotTag).catch(() => false),
      )
      await logseq.UI.showMsg(
        `“#${webTag.trim()}” now extends “${config.zotTag.trim()}” — web clips inherit the schema.`,
        'success',
      )
    } catch (e) {
      await logseq.UI.showMsg(
        `Couldn’t set up the web tag: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    } finally {
      setLinking(false)
    }
  }

  // While the probe is in flight (`undefined`) nothing is dirty; once resolved, a
  // missing snapshot (`null`, never applied) reads as dirty so the first Apply is
  // enabled. The web button is additionally gated on `schemaReady` by the section.
  const baseDirty =
    applied === undefined
      ? false
      : applied === null
        ? true
        : baseSchemaDiffers(applied, config)
  const webDirty =
    applied === undefined
      ? false
      : applied === null
        ? true
        : webTagDiffers(applied, config)
  const webApplied = applied != null && applied.webTag.trim() !== ''

  return {
    config,
    schemaReady,
    baseDirty,
    webDirty,
    webLinked,
    webApplied,
    applying,
    deleting,
    linking,
    updateConfig,
    applySchema,
    deleteSchema,
    setUpWebTag,
  }
}
