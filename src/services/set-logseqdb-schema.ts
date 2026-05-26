import { PropertySchema } from '@logseq/libs/dist/LSPlugin'

import {
  PROP_DESCRIPTIONS,
  PROP_DISPLAY_NAMES,
  PROP_PRESETS,
  PROP_PRIORITY_ORDER,
  VISIBLE_BY_DEFAULT_PROPS,
  ZOT_DATA_KEY_MAP,
  ZOTERO_PROP,
} from '../constants'
import { PropertyPreset } from '../interfaces'
import { convertPropToKebabCase } from './convert-prop-to-kebab'
import { parsePagePropChoice } from './page-props-choice'
import { ensureWebTagExtendsBase } from './set-web-schema'

// A property whose desired type (per current settings) differs from the type it
// already has in the graph. Logseq won't change a property's type once it holds
// values, so on re-apply we DON'T attempt the change (that call hangs — see
// createTagProperties); we record it and tell the user plainly instead.
interface TypeLock {
  prop: string
  from: string
  to: string
}
// A property whose setup threw outright — isolated so it can't abort the rest.
interface SchemaFailure {
  prop: string
  reason: string
}
interface SchemaResult {
  typeLocked: TypeLock[]
  failed: SchemaFailure[]
}

// The property schema types we assign. Used to gate the "type changed" note so
// an unrecognized stored value can never produce a spurious warning.
const KNOWN_TYPES = new Set([
  'default',
  'node',
  'date',
  'url',
  'number',
  'checkbox',
])

// The schema (type + cardinality) the current settings want for a property.
// `creatorsAsNodes` is the one type-affecting setting: it flips creators/authors
// between linked pages (`node`/many) and plain text (`default`).
const desiredSchemaFor = (prop: string): Partial<PropertySchema> => {
  if (prop === 'authors' || prop === 'creators') {
    const asNodes = (logseq.settings?.creatorsAsNodes as boolean) ?? true
    return asNodes ? { type: 'node', cardinality: 'many' } : { type: 'default' }
  }
  if (
    prop === 'access-date' ||
    prop === 'date-added' ||
    prop === 'date-modified'
  ) {
    return { type: 'date', cardinality: 'one' }
  }
  if (prop === 'tags') return { type: 'node', cardinality: 'many' }
  if (prop === 'url' || prop === 'library-link') {
    return { type: 'url', cardinality: 'one' }
  }
  return { type: 'default' }
}

// Read a property entity's current schema type ('url' | 'node' | 'date' | …).
// The field is `:logseq.property/type` (see LOGSEQ_SDK_NOTES → "Tags are
// classes"); check both colon- and bare-keyed forms and strip a leading colon
// off the value. Returns null when the field isn't present — callers then fall
// back to a plain skip (no note), so a missed read is harmless.
const readPropType = (entity: unknown): string | null => {
  const e = entity as Record<string, unknown> | null
  if (!e) return null
  const raw = e[':logseq.property/type'] ?? e['logseq.property/type']
  return typeof raw === 'string' ? raw.replace(/^:/, '').toLowerCase() : null
}

/**
 * Define each property's global schema and its per-property display attributes
 * (display name, hide-by-default, hide-empty-value, description).
 *
 * Re-apply safety: a property's TYPE is only set when the property is first
 * created. If it already exists we deliberately skip `upsertProperty` — Logseq
 * refuses to change a property's type once it holds values, and on that refusal
 * it shows a toast but never replies to the plugin, so the `upsertProperty` RPC
 * hangs until the SDK's deferred timeout. That was the "re-apply after import:
 * button lags, then 'Schema setup failed: [deferred timeout] async call #N'"
 * bug — and the timeout aborted the whole loop, leaving the schema
 * half-migrated. The cosmetic attributes below are safe to re-run every time
 * (and re-apply is *meant* to, to migrate properties from older schema versions
 * — e.g. clearing a stale `hide?`). When the desired type differs from the
 * stored one we record a `TypeLock` so the caller can tell the user rather than
 * hang. Each property is isolated in try/catch so one failure can't abort the
 * rest.
 */
const createTagProperties = async (props: string[]): Promise<SchemaResult> => {
  const typeLocked: TypeLock[] = []
  const failed: SchemaFailure[] = []

  for (const originalProp of props) {
    const prop = convertPropToKebabCase(originalProp)

    // FIXME: Make this stricter. If PROP_DISPLAY_NAMES doesn't cover we should know instead
    // of silently defaulting to `prop`... YEESH
    const displayName = PROP_DISPLAY_NAMES[originalProp] ?? prop

    try {
      // getProperty is a safe existence check — returns the entity or null,
      // never creates (LOGSEQ_SDK_NOTES). A bare name resolves under this
      // plugin's namespace — the same ident upsertProperty would create — so the
      // check and the create target the same property.
      let property = await logseq.Editor.getProperty(prop)

      if (!property) {
        console.log('Adding property schema', prop, 'to Logseq')
        await logseq.Editor.upsertProperty(prop, desiredSchemaFor(prop), {
          name: displayName,
        })
        property = await logseq.Editor.getProperty(prop)
      } else {
        // Already exists: never re-issue the type (see the docstring — that's
        // the call that hangs). If the current settings want a different type,
        // note it so the user learns why their change didn't take.
        const current = readPropType(property)
        const want = desiredSchemaFor(prop).type ?? 'default'
        if (current && KNOWN_TYPES.has(current) && current !== want) {
          typeLocked.push({ prop: displayName, from: current, to: want })
        }
      }

      if (property?.uuid) {
        // `upsertProperty`'s `name` opt is a no-op in current Logseq-DB — the
        // property's display name falls back to its kebab ident. The display
        // name is the property block's title, so set it directly.
        if (property.title !== displayName) {
          await logseq.Editor.updateBlock(property.uuid, displayName)
        }

        // Visibility default: only the allowlisted fields (VISIBLE_BY_DEFAULT_PROPS)
        // show inline on an imported page; every other property is hide-by-default,
        // tucked into Logseq's collapsed "Hidden properties" group so the page reads
        // as notes, not a metadata dump. We set `hide?` explicitly either way (not
        // relying on prior state) so a re-apply migrates existing properties. NB:
        // expanding "Hidden properties" reveals *all* hidden props, empties included
        // — Logseq's expand path skips the empty-value check — so hide-by-default is
        // for the default view, not a guarantee. `hide?`=true also blocks deletion
        // (delete-zotero-schema strips it first).
        // TODO: make the visible-by-default set user-configurable (see settings.md).
        if (VISIBLE_BY_DEFAULT_PROPS.has(prop)) {
          await logseq.Editor.removeBlockProperty(
            property.uuid,
            'logseq.property/hide?',
          )
        } else {
          await logseq.Editor.upsertBlockProperty(
            property.uuid,
            'logseq.property/hide?',
            true,
          )
        }

        // `hide-empty-value` hides a property when its value is nil — so the
        // visible-by-default fields collapse when empty too. (Logseq does NOT treat
        // "" as empty, so blank values are dropped at import — see handle-zot-db.)
        await logseq.Editor.upsertBlockProperty(
          property.uuid,
          'logseq.property/hide-empty-value',
          true,
        )

        // Same story for the description shown under each property in the tag
        // schema UI — it's the built-in `:logseq.property/description`, set
        // directly on the property block. An empty or missing entry clears it:
        // `upsertBlockProperty` ignores `''`, so removal is the only way to
        // actually unset a description that was set on a previous run.

        // FIXME: Instead of making dual API calls here, just filter PROP_DESCRIPTIONS
        // for non-empty descriptions, and only set those... dumb shit™
        const description = PROP_DESCRIPTIONS[originalProp]
        if (description) {
          await logseq.Editor.upsertBlockProperty(
            property.uuid,
            'logseq.property/description',
            description,
          )
        } else {
          await logseq.Editor.removeBlockProperty(
            property.uuid,
            'logseq.property/description',
          )
        }
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      console.error(`[zotero] schema: property "${prop}" failed to set up`, e)
      failed.push({ prop: displayName, reason })
    }
  }

  return { typeLocked, failed }
}

export const setLogseqDbSchema = async () => {
  const addingTagMsg = await logseq.UI.showMsg(
    'Setting up schema. Please wait...',
    'warning',
    {
      timeout: 0,
    },
  )

  try {
    // Create Zotero tag first
    await logseq.Editor.createTag(logseq.settings?.zotTag as string)

    /**
    All added properties follow the same structure: ":plugin.property.<plugin-id>/year"
    (the runtime namespaces them by `logseq.id`; cf. ZOTERO_PROP in constants.ts)
    **/

    // Resolve which properties to set up based on the selected preset
    const preset =
      (logseq.settings?.propertyPreset as PropertyPreset) ?? 'Essentials'
    let selectedProps: string[]
    if (preset === 'Custom') {
      // pageProps is stored as user-facing labels — see handle-zot-db.ts for
      // the same mapping.
      const raw = (logseq.settings?.pageProps as string[] | undefined) ?? []
      selectedProps = raw
        .map(parsePagePropChoice)
        .filter((k): k is string => k !== null)
    } else if (preset === 'Full') {
      // FIXME: Use as Array<keyof typeof ZOT_DATA_KEY_MAP ?
      selectedProps = Object.keys(ZOT_DATA_KEY_MAP).filter(
        (prop) =>
          prop !== 'abstractNote' &&
          prop !== 'attachments' &&
          prop !== 'notes' &&
          prop !== 'inGraph',
      )
    } else {
      selectedProps = [...PROP_PRESETS[preset]]
    }

    const filteredSelectedProps = selectedProps
      .filter((prop) => prop !== 'code')
      .filter((prop) => prop !== 'abstractNote')
      .filter((prop) => prop !== 'note')

    // Priority props are added first so they appear at the top of the tag's
    // property list. Only include the ones the active preset actually selects.
    const priorityProps = PROP_PRIORITY_ORDER.filter((prop) =>
      filteredSelectedProps.includes(prop),
    )
    const remainingProps = filteredSelectedProps.filter(
      (prop) =>
        !priorityProps.includes(prop as (typeof PROP_PRIORITY_ORDER)[number]),
    )

    // Mix of camelCase Zotero API names and kebab-case plugin-internal names —
    // `createTagProperties` and the tag association below kebab each entry. The
    // per-property display attributes (hide?, description, …) are re-applied
    // every time to migrate properties from older schema versions; the schema
    // *type* is only set on first create (see createTagProperties for why).
    const allZoteroPropsToBeSetup = [
      ...priorityProps,
      'zotero-code',
      'zotero-last-sync',
      'zotero-attachment-key',
      ...remainingProps,
    ]

    console.log(
      `[zotero] schema: setting up ${allZoteroPropsToBeSetup.length} properties`,
    )

    const { typeLocked, failed } = await createTagProperties(
      allZoteroPropsToBeSetup,
    )

    // Associate all Zotero properties with the tag. Each is isolated so a single
    // association hiccup can't sink the rest or the summary below.
    const zotTag = logseq.settings?.zotTag as string
    for (const originalProp of allZoteroPropsToBeSetup) {
      try {
        await logseq.Editor.addTagProperty(
          zotTag,
          convertPropToKebabCase(originalProp),
        )
      } catch (e) {
        console.warn(
          `[zotero] schema: couldn't associate "${originalProp}" with ${zotTag}`,
          e,
        )
      }
    }

    // Wire the web-clip tag to inherit the shared schema (extends the base tag).
    // The companion web-clipper extension tags clipped pages with this and
    // discovers properties through inheritance, so the base + web setup happen
    // together in one Apply. No-op when `webTag` is unset or equals the base.
    // Guarded so a web-tag hiccup can't sink the summary.
    try {
      await ensureWebTagExtendsBase(
        (logseq.settings?.webTag as string) ?? '',
        zotTag,
      )
    } catch (e) {
      console.warn('[zotero] schema: ensureWebTagExtendsBase failed', e)
    }

    // Summarize. A type-locked property or two is the common re-apply case
    // (Logseq won't change a property's type once it has data) — surface it
    // plainly and actionably rather than as a silent skip or a cryptic timeout.
    if (typeLocked.length || failed.length) {
      const bits: string[] = []
      if (typeLocked.length) {
        const names = typeLocked
          .map((t) => `${t.prop} (${t.from}→${t.to})`)
          .join(', ')
        bits.push(
          `Kept the existing type of ${names} — Logseq can’t change a property’s type once it has data. To change it, delete the schema (Danger zone) and re-apply.`,
        )
      }
      if (failed.length) {
        bits.push(
          `Couldn’t set up ${failed.map((f) => f.prop).join(', ')} — see the console.`,
        )
      }
      await logseq.UI.showMsg(
        `Schema for “${zotTag}” applied. ${bits.join(' ')}`,
        'warning',
        { timeout: 12000 },
      )
    } else {
      await logseq.UI.showMsg(`Schema for “${zotTag}” is set up.`, 'success')
    }
  } finally {
    // Always clear the sticky "Please wait" toast — even if something above
    // threw — so it can't linger on screen after a failure.
    logseq.UI.closeMsg(addingTagMsg)
  }
}
