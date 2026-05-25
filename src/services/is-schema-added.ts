import { ZOTERO_PROP } from '../constants'

export const isSchemaAdded = async () => {
  const allProps = await logseq.Editor.getAllProperties()

  if (!allProps || allProps.length === 0) {
    return false
  } else {
    const zoteroProps = allProps.filter((prop) =>
      prop.ident?.includes(ZOTERO_PROP),
    )
    if (!zoteroProps || zoteroProps.length === 0) {
      return false
    } else {
      return true
    }
  }
}
