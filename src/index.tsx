import '@logseq/libs'

import { BlockCursorPosition, BlockEntity } from '@logseq/libs/dist/LSPlugin'
import { createRoot } from 'react-dom/client'

import { BatchContainer } from './BatchContainer'
import { PLUGIN_ID, ZOT_TAG_DEFAULT } from './constants'
import { handlePopup } from './handle-popup'
import { QUERY_ALL_ZOT_PAGES } from './queries'
import { SetupContainer } from './SetupContainer'
import { testZotConnection } from './services/get-zot-items'
import { syncAnnotationsForPage } from './services/import-annotations'
import { hasLogseqApiToken } from './services/logseq-import-edn'
import { registerThemeSync } from './services/sync-theme'
import { registerTagRulesWatcher } from './services/watch-tag-rules'
import {
  handleSettings,
  migratePagenamePrefixIfNeeded,
  migratePagePropsIfNeeded,
} from './settings'
import { ZotContainer } from './ZotContainer'

const main = async () => {
  await logseq.UI.showMsg(
    `Reference Manager loaded. Run "Reference Manager: Settings" from the command palette to set up.`,
    'warning',
  )

  handlePopup()
  registerThemeSync()
  registerTagRulesWatcher()
  migratePagePropsIfNeeded()
  migratePagenamePrefixIfNeeded()

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
        await syncAnnotationsForPage(page)
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
      if (!hasLogseqApiToken()) {
        await logseq.UI.showMsg(
          'Set the Logseq API token in Reference Manager → Settings → Connections before syncing.',
          'warning',
        )
        return
      }
      // Track the configured base tag, not a hardcoded name (see queries.ts).
      const zotTag = (logseq.settings?.zotTag as string) ?? ZOT_TAG_DEFAULT
      const allZoteroPages: BlockEntity[][] = await logseq.DB.datascriptQuery(
        QUERY_ALL_ZOT_PAGES,
        JSON.stringify(zotTag),
      )
      const flattenedPages = allZoteroPages.flat()

      // Isolate per page so one unreadable PDF / transient error can't abort the
      // whole library-wide run; aggregate into a single summary toast
      // (announce:false suppresses per-page toasts).
      let total = 0
      let pagesWithPdf = 0
      let failedPages = 0
      for (const page of flattenedPages) {
        try {
          const r = await syncAnnotationsForPage(page.title.toLowerCase(), {
            announce: false,
          })
          total += r.total
          if (r.hadPdf) pagesWithPdf += 1
          if (r.failed > 0) failedPages += 1
        } catch (e) {
          failedPages += 1
          console.warn(`[annotations] sync-all failed for ${page.title}:`, e)
        }
      }
      await logseq.UI.showMsg(
        `Synced ${total} annotation(s) across ${pagesWithPdf} page(s)` +
          (failedPages > 0
            ? ` · ${failedPages} page(s) had failures (see console)`
            : ''),
        failedPages > 0 ? 'warning' : 'success',
      )
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
  // The single hub for all configuration — the shared schema (apply / delete),
  // Zotero (connection, import formats, tag rules), and Web references. Keyed
  // remount per open re-reads settings fresh; the hub lands on the first
  // incomplete step.
  logseq.App.registerCommandPalette(
    { key: `${PLUGIN_ID}-settings`, label: 'Reference Manager: Settings' },
    async () => {
      root.render(<SetupContainer key={`setup-${Date.now()}`} />)
      await logseq.showMainUI()
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
