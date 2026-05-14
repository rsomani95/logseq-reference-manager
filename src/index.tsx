import '@logseq/libs'

import { BlockCursorPosition, BlockEntity } from '@logseq/libs/dist/LSPlugin'
import { createRoot } from 'react-dom/client'

import { handlePopup } from './handle-popup'
import { QUERY_ALL_ZOT_PAGES } from './queries'
import { testZotConnection } from './services/get-zot-items'
import { registerAdminCommands } from './services/register-admin-commands'
import { syncAnnotations } from './services/sync-annotations'
import { registerThemeSync } from './services/sync-theme'
import { handleSettings } from './settings'
import { ZotContainer } from './ZotContainer'

const main = async () => {
  await logseq.UI.showMsg(
    `logseq-zoterolocal-plugin loaded. Please proceed to settings to continue setup.`,
    'warning',
  )

  registerAdminCommands()
  handlePopup()
  registerThemeSync()

  const response = await testZotConnection()
  handleSettings({ msg: response.msg })

  const el = document.getElementById('app')
  if (!el) return
  const root = createRoot(el)

  ///////////////////////////////////
  ///////// SYNC ANNOTATIONS ////////
  ///////////////////////////////////
  logseq.App.registerPageMenuItem(
    'Zotero: Sync annotations',
    async ({ page }) => {
      try {
        await syncAnnotations(page)
      } catch (error) {
        await logseq.UI.showMsg(
          `Failed to sync annotations: ${(error as Error).message}`,
          'error',
        )
      }
    },
  )

  logseq.App.registerCommandPalette(
    {
      key: 'zoterolocal-plugin-sync-all-annotations',
      label: 'logseq-zoterolocal-plugin: Sync all annotations',
    },
    async () => {
      const allZoteroPages: BlockEntity[][] =
        await logseq.DB.datascriptQuery(QUERY_ALL_ZOT_PAGES)
      const flattenedPages = allZoteroPages.flat()

      for (const page of flattenedPages) {
        logseq.UI.showMsg(`Syncing annotations for ${page.title}`)
        await syncAnnotations(page.title.toLowerCase())
      }
    },
  )

  ///////////////////////////////////
  // INSERT FULL DOCUMENT IN GRAPH //
  ///////////////////////////////////
  logseq.Editor.registerSlashCommand('Zotero: Insert full item', async (e) => {
    const { rect } =
      (await logseq.Editor.getEditingCursorPosition()) as BlockCursorPosition
    root.render(<ZotContainer uuid={e.uuid} rect={rect} />)
    logseq.showMainUI()

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        const searchField: HTMLInputElement =
          document.querySelector('#search-field')!
        searchField.focus()
      }
    })
  })
}

logseq.ready(main).catch(console.error)
