import { ZotData } from '../interfaces'
import { handleZotInDb } from './handle-zot-db'
import { handleZotInMd } from './handle-zot-md'

export const insertZotIntoGraph = async (zotItem: ZotData) => {
  logseq.hideMainUI()
  const msgId = await logseq.UI.showMsg(
    'Inserting into graph. Please wait...',
    'warning',
    {},
  )
  const { supportDb } = await logseq.App.getInfo()

  const pageName = (logseq.settings!.pagenameTemplate as string)
    .replace('<% title %>', zotItem.title)
    .replace('<% citeKey %>', zotItem.citeKey)
    .trim()

  if (supportDb) {
    await handleZotInDb(zotItem, pageName)
  }

  if (!supportDb) {
    await handleZotInMd(zotItem, pageName)
  }

  logseq.UI.closeMsg(msgId)
  await logseq.UI.showMsg('Inserted zotero item successfully', 'success')
  return pageName
}
