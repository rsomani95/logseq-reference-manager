import { ZotData } from '../interfaces'
import { handleZotInDb, resolvePageName } from './handle-zot-db'

export const insertZotIntoGraph = async (zotItem: ZotData) => {
  logseq.hideMainUI()
  const msgId = await logseq.UI.showMsg(
    'Inserting into graph. Please wait...',
    'warning',
    {},
  )

  try {
    const { status, pageName } = await handleZotInDb(
      zotItem,
      resolvePageName(zotItem),
    )
    logseq.UI.closeMsg(msgId)
    await logseq.UI.showMsg(
      status === 'exists'
        ? `Already in graph as "${pageName}" — linked here`
        : 'Inserted Zotero item successfully',
      'success',
    )
    return pageName
  } catch (e) {
    logseq.UI.closeMsg(msgId)
    await logseq.UI.showMsg(e instanceof Error ? e.message : String(e), 'error')
  }
}
