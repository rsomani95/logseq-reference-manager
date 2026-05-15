import { ZotData } from '../interfaces'
import { handleZotInDb, resolvePageName } from './handle-zot-db'

export const insertZotIntoGraph = async (
  zotItem: ZotData,
  opts: { navigate?: boolean } = {},
) => {
  // No hideMainUI / "please wait" toast here — the inline search UI owns
  // loading and hides itself once the page is built.
  try {
    const { status, pageName } = await handleZotInDb(
      zotItem,
      resolvePageName(zotItem),
      { navigate: opts.navigate },
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
