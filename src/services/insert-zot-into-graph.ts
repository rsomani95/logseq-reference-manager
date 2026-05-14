import { ZotData } from '../interfaces'
import { handleZotInDb, resolvePageName } from './handle-zot-db'

export const insertZotIntoGraph = async (zotItem: ZotData) => {
  // No hideMainUI / "please wait" toast here: the inline search UI owns the
  // loading state (it morphs to a spinner on pick) and hides itself once the
  // page is built. handleZotInDb builds the page off-screen and navigates to
  // it when done.
  try {
    const { status, pageName } = await handleZotInDb(
      zotItem,
      resolvePageName(zotItem),
    )
    await logseq.UI.showMsg(
      status === 'exists'
        ? `Already in graph as "${pageName}" — linked here`
        : 'Inserted Zotero item successfully',
      'success',
    )
    return pageName
  } catch (e) {
    await logseq.UI.showMsg(e instanceof Error ? e.message : String(e), 'error')
  }
}
