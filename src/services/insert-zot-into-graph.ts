import { ZotData } from '../interfaces'
import { handleZotInDb, resolvePageName } from './handle-zot-db'

export const insertZotIntoGraph = async (zotItem: ZotData) => {
  logseq.hideMainUI()
  const msgId = await logseq.UI.showMsg(
    'Inserting into graph. Please wait...',
    'warning',
    {},
  )

  const pageName = resolvePageName(zotItem)

  try {
    await handleZotInDb(zotItem, pageName)
    logseq.UI.closeMsg(msgId)
    await logseq.UI.showMsg('Inserted Zotero item successfully', 'success')
    return pageName
  } catch (e) {
    logseq.UI.closeMsg(msgId)
    await logseq.UI.showMsg(e instanceof Error ? e.message : String(e), 'error')
  }
}
