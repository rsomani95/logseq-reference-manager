import { PropertySchema } from '@logseq/libs/dist/LSPlugin'

import { PROP_PRESETS, ZOT_DATA_KEY_MAP, ZOTERO_PROP } from '../constants'
import { PropertyPreset } from '../interfaces'
import { convertPropToKebabCase } from './convert-prop-to-kebab'

const createTagProperties = async (props: string[]) => {
  for (const prop of props) {
    console.log('Adding property schema', prop, 'to Logseq')

    let schema: Partial<PropertySchema>
    if (prop === 'creators') {
      schema = { type: 'node', cardinality: 'many' }
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

    await logseq.Editor.upsertProperty(prop, schema, { name: prop })

    // The plugin SDK rewrites `schema.hide` to the unqualified attribute
    // `:hide?` on the property, but the UI's "Hide by default" toggle reads
    // the qualified `:logseq.property/hide?` — so the schema flag is a no-op.
    // Qualified keywords pass through `upsertBlockProperty` unchanged, so
    // setting it directly on the property block is the working path.
    const property = await logseq.Editor.getProperty(`${ZOTERO_PROP}/${prop}`)
    if (property?.uuid) {
      await logseq.Editor.upsertBlockProperty(
        property.uuid,
        'logseq.property/hide?',
        true,
      )
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
  const preset = (logseq.settings?.propertyPreset as PropertyPreset) ?? 'Core'
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

  const allZoteroPropsToBeSetup = [
    ...['zotero-code', 'zotero-last-sync', 'zotero-attachment-key'],
    ...selectedProps
      .filter((prop) => prop !== 'code')
      .filter((prop) => prop !== 'abstractNote')
      .filter((prop) => prop !== 'note'),
  ]
  // upsertProperty is idempotent, and the qualified-hide step needs to run
  // every time anyway to fix properties created before this fix landed.
  const zoteroPropsToBeSetup = allZoteroPropsToBeSetup.map((prop) =>
    convertPropToKebabCase(prop),
  )

  await logseq.UI.showMsg(
    `No. of Zotero props to be setup: ${zoteroPropsToBeSetup.length}`,
    'warning',
  )

  if (zoteroPropsToBeSetup.length > 0) {
    await createTagProperties(zoteroPropsToBeSetup)
  }

  // Associate all Zotero properties with the tag
  const zotTag = logseq.settings?.zotTag as string
  for (const prop of allZoteroPropsToBeSetup.map((p) =>
    convertPropToKebabCase(p),
  )) {
    await logseq.Editor.addTagProperty(zotTag, prop)
  }

  logseq.UI.closeMsg(addingTagMsg)

  await logseq.UI.showMsg(
    `Schema for tag: ${logseq.settings?.zotTag} setup completed.`,
    'success',
  )
}
