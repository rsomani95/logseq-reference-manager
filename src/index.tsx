import '@logseq/libs'

import { BlockCursorPosition, BlockEntity } from '@logseq/libs/dist/LSPlugin'
import { createRoot } from 'react-dom/client'

import { BatchContainer } from './BatchContainer'
import { PLUGIN_ID } from './constants'
import type { SetupSection } from './features/setup'
import { handlePopup } from './handle-popup'
import { QUERY_ALL_ZOT_PAGES } from './queries'
import { SetupContainer } from './SetupContainer'
import { testZotConnection } from './services/get-zot-items'
import { registerAdminCommands } from './services/register-admin-commands'
import { syncAnnotations } from './services/sync-annotations'
import { registerThemeSync } from './services/sync-theme'
import { registerTagRulesWatcher } from './services/watch-tag-rules'
import { handleSettings, migratePagePropsIfNeeded } from './settings'
import { ZotContainer } from './ZotContainer'

const main = async () => {
  await logseq.UI.showMsg(
    `Zotero (Local) loaded. Run "Zotero: Settings" from the command palette to set up.`,
    'warning',
  )

  registerAdminCommands()
  handlePopup()
  registerThemeSync()
  registerTagRulesWatcher()
  migratePagePropsIfNeeded()

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
      key: `${PLUGIN_ID}-sync-all-annotations`,
      label: 'Zotero: Sync all annotations',
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
  ////////  IMPORT SINGLE ITEM //////
  ///////////////////////////////////
  // Slash-only: the popup anchors to the editing cursor and links the new
  // page into the current block, so it needs an active block to run in.
  logseq.Editor.registerSlashCommand(
    'Zotero: Import single item',
    async (e) => {
      const { rect } =
        (await logseq.Editor.getEditingCursorPosition()) as BlockCursorPosition
      root.render(
        <ZotContainer uuid={e.uuid} rect={rect} openedAt={Date.now()} />,
      )
      logseq.showMainUI()
    },
  )

  ///////////////////////////////////
  /////////////  DEBUG  /////////////
  ///////////////////////////////////
  // Disabled (debug-only). Inspects real production properties' descriptions.
  // Run AFTER the real schema-setup command + a Logseq reload to check whether
  // the production path's descriptions survive to SQLite. Uncomment to enable.
  /*
  logseq.Editor.registerSlashCommand(
    'Zotero: Inspect schema descriptions',
    async () => {
      // Mix of properties that should have descriptions in PROP_DESCRIPTIONS
      // and ones that shouldn't (empty string → removeBlockProperty in prod).
      const probes = [
        { name: 'date', expectedSubstring: 'Publication date' },
        { name: 'date-added', expectedSubstring: 'Date the item was added' },
        { name: 'item-type', expectedSubstring: 'Zotero item type' },
        { name: 'zotero-code', expectedSubstring: 'Zotero item key' },
        { name: 'tags', expectedSubstring: 'Zotero tags applied' },
        { name: 'authors', expectedSubstring: null }, // empty in prod
        { name: 'title', expectedSubstring: null }, // empty in prod
      ]
      console.group('[debug-prod] Inspecting production-property descriptions')
      for (const { name, expectedSubstring } of probes) {
        const prop = await logseq.Editor.getProperty(name)
        if (!prop?.uuid) {
          console.warn(`[debug-prod] ${name}: not found`)
          continue
        }
        const readable = await logseq.Editor.getBlockProperties(prop.uuid)
        const descValue = (readable as Record<string, unknown> | null)?.[
          ':logseq.property/description'
        ]
        let verdict = 'unknown'
        if (expectedSubstring === null) {
          verdict = descValue == null ? 'OK (empty as expected)' : 'UNEXPECTED'
        } else if (
          typeof descValue === 'string' &&
          descValue.includes(expectedSubstring)
        ) {
          verdict = 'OK'
        } else {
          verdict = 'LOST'
        }
        console.log(
          `[debug-prod] ${name}: ${verdict}  expected~="${expectedSubstring ?? '(empty)'}"  got=${JSON.stringify(descValue)}`,
        )
      }
      console.groupEnd()
      await logseq.UI.showMsg(
        'Production inspection complete — check the console.',
        'success',
      )
    },
  )
  */

  ///////////////////////////////////
  ///////////  BATCH IMPORT  ////////
  ///////////////////////////////////
  // Cursor-independent (centered modal, writes no back-link), so it's offered
  // on both the slash menu and the command palette off the same handler. A
  // fresh `key` forces a clean remount, so every invocation starts at the
  // select phase with no carried-over selection or summary.
  const openBatchImport = async () => {
    root.render(<BatchContainer key={`batch-${Date.now()}`} />)
    await logseq.showMainUI()
  }

  logseq.Editor.registerSlashCommand('Zotero: Batch import', openBatchImport)

  logseq.App.registerCommandPalette(
    {
      key: `${PLUGIN_ID}-batch-import`,
      label: 'Zotero: Batch import',
    },
    openBatchImport,
  )

  ///////////////////////////////////
  //////////////  SETUP  ////////////
  ///////////////////////////////////
  // The single hub for all configuration — connection test, library mapping
  // (+ schema apply), import formats, and tag rules. Keyed remount per open
  // re-reads settings fresh. `Zotero: Settings` lands on the first incomplete
  // step; `Zotero: Edit tag rules` deep-links straight to the Tag rules section.
  const openSetup = async (initialSection?: SetupSection) => {
    root.render(
      <SetupContainer
        key={`setup-${Date.now()}`}
        initialSection={initialSection}
      />,
    )
    await logseq.showMainUI()
  }

  logseq.App.registerCommandPalette(
    { key: `${PLUGIN_ID}-settings`, label: 'Zotero: Settings' },
    () => openSetup(),
  )

  logseq.App.registerCommandPalette(
    { key: `${PLUGIN_ID}-edit-tag-rules`, label: 'Zotero: Edit tag rules' },
    () => openSetup('tagRules'),
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
