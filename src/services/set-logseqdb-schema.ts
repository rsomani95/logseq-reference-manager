import { PropertySchema } from '@logseq/libs/dist/LSPlugin'

import {
  PROP_DESCRIPTIONS,
  PROP_DISPLAY_NAMES,
  PROP_PRESETS,
  PROP_PRIORITY_ORDER,
  ZOT_DATA_KEY_MAP,
  ZOTERO_PROP,
} from '../constants'
import { PropertyPreset } from '../interfaces'
import { convertPropToKebabCase } from './convert-prop-to-kebab'

const createTagProperties = async (props: string[]) => {
  for (const originalProp of props) {
    const prop = convertPropToKebabCase(originalProp)
    const displayName = PROP_DISPLAY_NAMES[originalProp] ?? prop
    console.log('Adding property schema', prop, 'to Logseq')

    let schema: Partial<PropertySchema>
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

    const property = await logseq.Editor.getProperty(`${ZOTERO_PROP}/${prop}`)
    if (property?.uuid) {
      // `upsertProperty`'s `name` opt is a no-op in current Logseq-DB — the
      // property's display name falls back to its kebab ident. The display
      // name is the property block's title, so set it directly.
      if (property.title !== displayName) {
        await logseq.Editor.updateBlock(property.uuid, displayName)
      }

      // The plugin SDK rewrites `schema.hide` to the unqualified attribute
      // `:hide?` on the property, but the UI's "Hide by default" toggle reads
      // the qualified `:logseq.property/hide?` — so the schema flag is a no-op.
      // Qualified keywords pass through `upsertBlockProperty` unchanged, so
      // setting it directly on the property block is the working path.
      await logseq.Editor.upsertBlockProperty(
        property.uuid,
        'logseq.property/hide?',
        true,
      )

      // Same story for the description shown under each property in the tag
      // schema UI — it's the built-in `:logseq.property/description`, set
      // directly on the property block. An empty or missing entry clears it:
      // `upsertBlockProperty` ignores `''`, so removal is the only way to
      // actually unset a description that was set on a previous run.
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
  All added properties follow the same structure: ":plugin.property.logseq-zoterolocal-plugin/year"
  **/

  // Resolve which properties to set up based on the selected preset
  const preset =
    (logseq.settings?.propertyPreset as PropertyPreset) ?? 'Essentials'
  let selectedProps: string[]
  if (preset === 'Custom') {
    selectedProps = logseq.settings?.pageProps as string[]
  } else if (preset === 'Full') {
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

  logseq.UI.closeMsg(addingTagMsg)

  await logseq.UI.showMsg(
    `Schema for tag: ${logseq.settings?.zotTag} setup completed.`,
    'success',
  )
}
