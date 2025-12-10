import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user'

import { ZOT_DATA_KEY_MAP } from './constants'

const propsArray = Object.keys(ZOT_DATA_KEY_MAP)

export const handleSettings = async ({
  code,
  msg,
}: {
  code: 'error' | 'success'
  msg: string
}) => {
  let settings: SettingSchemaDesc[] = [
    {
      key: 'testConnection',
      type: 'heading',
      title: 'Connection Test',
      description: msg,
      default: '',
    },
    {
      key: 'pageProps',
      type: 'enum',
      title: 'Page Properties (DB version)',
      description: 'Indicate the properties to include for each Zotero item',
      default: propsArray,
      enumPicker: 'checkbox',
      enumChoices: propsArray.filter((prop) => prop !== 'abstractNote'),
    },
    {
      key: 'agreementClause',
      type: 'boolean',
      title: 'Setup Zotero Schema in Logseq',
      description:
        '[This action cannot be undone] By toggling this setting, the schema for the above selected properties will be added to Logseq. This may take a while as there are ~120 items. If you changed your options above, please uncheck and check the box again',
      default: false,
    },
  ]

  if (code === 'success') {
    const pluginSettings: SettingSchemaDesc[] = [
      {
        key: 'pagenameTemplate',
        type: 'string',
        title: 'Page Name Template',
        description: `Specify the page name for each Zotero import. Available placeholders: <% citeKey %>, <% title %>`,
        default: `R: <% citeKey %>`,
      },
      {
        key: 'citekeyTemplate',
        type: 'string',
        title: 'Template for Cite Key',
        description: `Specify the template when using the command /Zotero: Insert citation. Ensure that <% citeKey %> placeholder is indicated in your template`,
        default: '[@<% citeKey %>]',
      },
      {
        key: 'zotTag',
        type: 'string',
        title: 'Zotero Tag Name',
        description: `Specify the tag name used for Zotero imports`,
        default: 'Zotero',
      },
      {
        key: 'zotTemplate',
        type: 'string',
        title: 'Template Name (MD version)',
        description:
          'The template name that holds your template for a Zotero page. Ensure that include parent is set to false. ',
        default: 'Zotero Template',
      },
      {
        key: 'authorTemplate',
        type: 'string',
        title: 'Author Template (MD version)',
        description:
          'Specify how authors should be shown in the properties. Available placeholders: <% firstName %>, <% lastName %>, <% creatorType %>',
        default: '<% firstName %> <% lastName %> (<% creatorType %>)',
      },
    ]

    settings = [...settings, ...pluginSettings]
  }

  logseq.useSettingsSchema(settings)
}
