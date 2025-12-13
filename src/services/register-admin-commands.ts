import { setLogseqDbSchema } from './set-logseqdb-schema'

export const registerAdminCommands = () => {
  logseq.App.registerCommandPalette(
    {
      key: 'zoterolocal-plugin-remove-all-created-schema',
      label: 'logseq-zoterolocal-plugin: Remove all created schema',
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
        .filter((prop) =>
          prop.ident?.includes(':plugin.property.logseq-zoterolocal-plugin'),
        )
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
      key: 'logseq-zoterolocal-plugin-reset-current-settings',
      label: 'logseq-zoterolocal-plugin: Reset current settings',
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
      key: 'logseq-zoterolocal-plugin-add-zotero-schema',
      label: 'logseq-zoterolocal-plugin: Add Zotero schema to Logseq',
    },
    async () => {
      await setLogseqDbSchema()
    },
  )
}
