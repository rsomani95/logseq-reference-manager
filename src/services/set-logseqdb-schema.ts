import { ZOT_DATA_KEY_MAP } from '../constants'
import { convertPropToKebabCase } from './convert-prop-to-kebab'

const createTagProperties = async (props: string[]) => {
  for (const prop of props) {
    console.log('Adding property schema', prop, 'to Logseq')

    if (prop === 'attachments') {
      await logseq.Editor.upsertProperty(
        prop,
        {
          cardinality: 'many',
          type: 'default',
        },
        { name: prop },
      )
    } else if (prop === 'creators') {
      await logseq.Editor.upsertProperty(
        prop,
        {
          cardinality: 'many',
          type: 'node',
        },
        { name: prop },
      )
    } else if (
      prop === 'access-date' ||
      prop === 'date-added' ||
      prop === 'date-modified'
    ) {
      await logseq.Editor.upsertProperty(
        prop,
        {
          type: 'date',
          cardinality: 'one',
        },
        { name: prop },
      )
    } else if (prop === 'tags') {
      await logseq.Editor.upsertProperty(
        prop,
        {
          type: 'node',
          cardinality: 'many',
        },
        { name: prop },
      )
    } else if (prop === 'url' || prop === 'libraryLink') {
      await logseq.Editor.upsertProperty(
        prop,
        {
          type: 'url',
          cardinality: 'one',
        },
        { name: prop },
      )
    } else {
      await logseq.Editor.upsertProperty(
        prop,
        {
          type: 'default',
        },
        { name: prop },
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

  const allZoteroPropsToBeSetup = [
    ...['zotero-code'],
    ...Object.keys(ZOT_DATA_KEY_MAP)
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
      const fullIdentifierToExclude = `:plugin.property.logseq-zoterolocal-plugin/${ZProp}`
      return !existingLsIdentifiers.has(fullIdentifierToExclude)
    })

  await logseq.UI.showMsg(
    `No. of Zotero props to be setup: ${zoteroPropsToBeSetup.length}`,
    'warning',
  )

  if (zoteroPropsToBeSetup.length > 0) {
    await createTagProperties(zoteroPropsToBeSetup)
  }

  logseq.UI.closeMsg(addingTagMsg)

  await logseq.UI.showMsg(
    `Schema for tag: ${logseq.settings?.zotTag} setup completed.`,
    'success',
  )
}
