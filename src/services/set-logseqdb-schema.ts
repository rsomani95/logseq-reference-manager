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

// TODO: Add docstring
// NOTE: This seems to be adding properties at the global level
// See https://github.com/logseq/logseq/blob/master/libs/guides/db_properties_references.md#addtagpropertytagid-propertyidorname
const createTagProperties = async (props: string[]) => {
  for (const originalProp of props) {
    const prop = convertPropToKebabCase(originalProp)

    // FIXME: Make this stricter. If PROP_DISPLAY_NAMES doesn't cover we should know instead
    // of silently defaulting to `prop`... YEESH
    const displayName = PROP_DISPLAY_NAMES[originalProp] ?? prop
    console.log('Adding property schema', prop, 'to Logseq')

    let schema: Partial<PropertySchema>

    // Depending on user pref, decide whether or not to create a page ('node) for each
    // author/creators or to just keep them as the default (string) type
    if (prop === 'authors' || prop === 'creators') {
      const asNodes = (logseq.settings?.creatorsAsNodes as boolean) ?? true
      schema = asNodes
        ? { type: 'node', cardinality: 'many' }
        : { type: 'default' }
    } else if (
      prop === 'access-date' ||
      prop === 'date-added' ||
      prop === 'date-modified'
    ) {
      schema = { type: 'date', cardinality: 'one' }
    } else if (prop === 'tags') {
      schema = { type: 'node', cardinality: 'many' }
    } else if (prop === 'url' || prop === 'library-link') {
      schema = { type: 'url', cardinality: 'one' }
    } else {
      schema = { type: 'default' }
    }

    await logseq.Editor.upsertProperty(prop, schema, { name: displayName })

    // const property = await logseq.Editor.getProperty(`${ZOTERO_PROP}/${prop}`)
    // Keep it simple stupid. Properties are global. No need to access via namespace
    const property = await logseq.Editor.getProperty(prop)
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
  }
}

export const setLogseqDbSchema = async () => {
  const addingTagMsg = await logseq.UI.showMsg(
    'Setting up schema. Please wait...',
    'warning',
    {
      timeout: 0,
    },
  )

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
  // `createTagProperties` and the tag association below kebab each entry.
  // upsertProperty is idempotent, and the qualified-hide step needs to run
  // every time anyway to fix properties created before this fix landed.
  const allZoteroPropsToBeSetup = [
    ...priorityProps,
    'zotero-code',
    'zotero-last-sync',
    'zotero-attachment-key',
    ...remainingProps,
  ]

  await logseq.UI.showMsg(
    `No. of Zotero props to be setup: ${allZoteroPropsToBeSetup.length}`,
    'warning',
  )

  if (allZoteroPropsToBeSetup.length > 0) {
    await createTagProperties(allZoteroPropsToBeSetup)
  }

  // Associate all Zotero properties with the tag
  const zotTag = logseq.settings?.zotTag as string
  for (const originalProp of allZoteroPropsToBeSetup) {
    await logseq.Editor.addTagProperty(
      zotTag,
      convertPropToKebabCase(originalProp),
    )
  }

  // Wire the web-clip tag to inherit the shared schema (extends the base tag).
  // The companion web-clipper extension tags clipped pages with this and
  // discovers properties through inheritance, so the base + web setup happen
  // together in one Apply. No-op when `webTag` is unset or equals the base.
  await ensureWebTagExtendsBase(
    (logseq.settings?.webTag as string) ?? '',
    zotTag,
  )

  logseq.UI.closeMsg(addingTagMsg)

  await logseq.UI.showMsg(
    `Schema for tag: ${logseq.settings?.zotTag} setup completed.`,
    'success',
  )
}
