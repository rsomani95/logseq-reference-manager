import { ZotData } from '../interfaces'
import { getChildrenForItem } from './get-zot-items'
import { handleZotInDb, resolvePageName } from './handle-zot-db'

export const insertZotIntoGraph = async (
  zotItem: ZotData,
  opts: { navigate?: boolean } = {},
) => {
  // No hideMainUI / "please wait" toast here — the inline search UI owns
  // loading and hides itself once the page is built.
  try {
    // List paths return parents-only ZotData; pull notes / attachments from
    // Zotero now so handleZotInDb can write them into the page. (Annotations are
    // no longer fetched here — the annotation importer reads them from the PDF
    // file, or Zotero on fallback, on demand.) One round-trip on localhost.
    const { attachments, notes } = await getChildrenForItem(zotItem.key)
    const fullItem: ZotData = { ...zotItem, attachments, notes }

    const { status, pageName } = await handleZotInDb(
      fullItem,
      resolvePageName(fullItem),
      { navigate: opts.navigate },
    )
    await logseq.UI.showMsg(
      status === 'exists'
        ? `Already in graph as "${pageName}", linked here`
        : 'Inserted Zotero item successfully',
      'success',
    )
    return pageName
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === 'object' && e !== null
          ? JSON.stringify(e)
          : String(e)
    await logseq.UI.showMsg(msg, 'error')
  }
}
