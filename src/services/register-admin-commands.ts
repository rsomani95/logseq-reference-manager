import { PLUGIN_ID, ZOTERO_PROP } from '../constants'
import { setLogseqDbSchema } from './set-logseqdb-schema'

export const registerAdminCommands = () => {
  logseq.App.registerCommandPalette(
    {
      key: `${PLUGIN_ID}-remove-all-created-schema`,
      label: 'Zotero: Delete schema',
    },
    async () => {
      const msg = await logseq.UI.showMsg(
        'Removing all created schema. Please wait...',
        'warning',
        { timeout: 0 },
      )

      const allPropsInLs = await logseq.Editor.getAllProperties()
      if (!allPropsInLs) return
      const pagesToDelete = allPropsInLs
        .filter((prop) => prop.ident?.includes(ZOTERO_PROP))
        .map((prop) => prop.title!)

      const deletePromisesArr = pagesToDelete.map((title) =>
        logseq.Editor.deletePage(title),
      )
      await Promise.all(deletePromisesArr)

      logseq.UI.closeMsg(msg)
      await logseq.UI.showMsg(
        'Successfully removed all created schema',
        'success',
      )
    },
  )

  logseq.App.registerCommandPalette(
    {
      key: `${PLUGIN_ID}-reset-current-settings`,
      label: 'Zotero: Reset settings',
    },
    async () => {
      logseq.useSettingsSchema([
        {
          key: 'reloadPlugin',
          type: 'heading',
          title: 'Reload the Plugin',
          description: `By toggling the plugin on and off`,
          default: '',
        },
      ])
    },
  )

  logseq.App.registerCommandPalette(
    {
      key: `${PLUGIN_ID}-add-zotero-schema`,
      label: 'Zotero: Setup schema',
    },
    async () => {
      await setLogseqDbSchema()
    },
  )
}
