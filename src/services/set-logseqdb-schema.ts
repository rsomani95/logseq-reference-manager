import { ZOT_DATA_KEY_MAP } from '../constants'

export const setLogseqDbSchema = async () => {
  const addingTagMsg = await logseq.UI.showMsg(
    'Setting up schema. Please wait...',
    'warning',
  )
  /**
   Approach:
   1) Define all properties
   2) Add user-defined properties to Zotero tag
   **/
  const allProps = await logseq.Editor.getAllProperties()
  if (allProps && allProps.length > 0) {
    const propsInserted = allProps.filter((prop) =>
      prop.ident?.includes('zoterolocal'),
    )
    if (propsInserted.length === 0) {
      // Needed to check if the schema has already been inserted as re-setting the schema can messs with cardinality and type. Looks like at this point, Logseq allows duplicate properties
      const propsArray = Object.keys(ZOT_DATA_KEY_MAP)
      const allLsProps = await logseq.Editor.getAllProperties()

      for (const prop of propsArray) {
        console.log('Adding property schema ', prop, ' to Logseq')
        let fixedProp = ''
        if (prop !== 'ISSN' && prop !== 'ISBN' && prop !== 'DOI') {
          fixedProp = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        } else {
          fixedProp = prop
        }

        for (const lsProp of allLsProps!) {
          if (fixedProp !== lsProp.name) {
            if (prop === 'attachments') {
              await logseq.Editor.upsertProperty(
                fixedProp,
                {
                  cardinality: 'many',
                  type: 'default',
                },
                { name: fixedProp },
              )
            } else if (prop === 'creators') {
              await logseq.Editor.upsertProperty(
                fixedProp,
                {
                  cardinality: 'many',
                  type: 'node',
                },
                { name: fixedProp },
              )
            } else if (
              prop === 'accessDate' ||
              prop === 'dateAdded' ||
              prop === 'dateModified'
            ) {
              await logseq.Editor.upsertProperty(
                fixedProp,
                {
                  type: 'date',
                  cardinality: 'one',
                },
                { name: fixedProp },
              )
            } else if (prop === 'tags') {
              await logseq.Editor.upsertProperty(
                fixedProp,
                {
                  type: 'node',
                  cardinality: 'many',
                },
                { name: fixedProp },
              )
            } else if (prop === 'url' || prop === 'libraryLink') {
              await logseq.Editor.upsertProperty(
                fixedProp,
                {
                  type: 'url',
                  cardinality: 'one',
                },
                { name: fixedProp },
              )
            } else {
              await logseq.Editor.upsertProperty(
                fixedProp,
                {
                  type: 'default',
                },
                { name: fixedProp },
              )
            }
          }
        }
      }
    }
  }

  // Create Zotero tag
  await logseq.Editor.createTag(logseq.settings?.zotTag as string)

  logseq.UI.closeMsg(addingTagMsg)

  await logseq.UI.showMsg(
    `Schema for tag: ${logseq.settings?.zotTag} setup completed.`,
    'success',
  )
}
