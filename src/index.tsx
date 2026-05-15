import '@logseq/libs'

import { BlockCursorPosition, BlockEntity } from '@logseq/libs/dist/LSPlugin'
import { createRoot } from 'react-dom/client'

import { BatchContainer } from './BatchContainer'
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

  // Re-register with the live connection status. Defaults for new keys were
  // already populated by the pre-ready call below; this just refreshes the
  // schema (and the testConnection heading's description) without touching
  // user-set values.
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
    root.render(
      <ZotContainer uuid={e.uuid} rect={rect} openedAt={Date.now()} />,
    )
    logseq.showMainUI()
  })

  ///////////////////////////////////
  ///////////  BATCH IMPORT  ////////
  ///////////////////////////////////
  logseq.App.registerCommandPalette(
    {
      key: 'zoterolocal-plugin-batch-import',
      label: 'logseq-zoterolocal-plugin: Batch import',
    },
    () => {
      // A fresh `key` forces a clean remount, so every invocation starts at the
      // select phase with no carried-over selection or summary.
      root.render(<BatchContainer key={`batch-${Date.now()}`} />)
      logseq.showMainUI()
    },
  )
}

// Register the schema BEFORE `logseq.ready` runs. Logseq's libs only fold
// new defaults into `_baseInfo.settings` during the ready-init pass, and
// only if `_settingsSchema` is already set. Registering inside `main` (the
// ready callback) is too late: any setting added in a later release stays
// `undefined` in `_baseInfo.settings`, and the host's `settings:changed`
// handler crashes inside `Object.assign` on the first toggle of a new key.
// Empty msg here is fine — `main` re-registers with the real connection
// status once the test completes.
handleSettings({ msg: '' })

logseq.ready(main).catch(console.error)
