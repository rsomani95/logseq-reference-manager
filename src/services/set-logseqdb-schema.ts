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

    // Hide by default: property is not shown on a block unless zoomed in.
    schema.hide = true

    await logseq.Editor.upsertProperty(prop, schema, { name: prop })
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
  const allPropsInLs = await logseq.Editor.getAllProperties()
  const existingLsIdentifiers = new Set(
    allPropsInLs?.map((LsProp) => LsProp.ident),
  )
  const zoteroPropsToBeSetup = allZoteroPropsToBeSetup
    .map((prop) => convertPropToKebabCase(prop))
    .filter((ZProp) => {
      const fullIdentifierToExclude = `${ZOTERO_PROP}/${ZProp}`
      return !existingLsIdentifiers.has(fullIdentifierToExclude)
    })

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
