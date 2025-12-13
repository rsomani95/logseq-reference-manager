import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user'

import { ZOT_DATA_KEY_MAP } from './constants'

export const handleSettings = ({ msg }: { msg: string }) => {
  const propsArray = Object.keys(ZOT_DATA_KEY_MAP)
  const filteredPropsArray = propsArray.filter(
    (prop) =>
      // To be included in the page itself
      prop !== 'abstractNote' &&
      prop !== 'attachments' &&
      prop !== 'notes' &&
      // Not necessary
      prop !== 'inGraph',
  )

  const settings: SettingSchemaDesc[] = [
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
      description: `Indicate the properties to include for each Zotero item. After setting this up, invoke the command palette and use the command 'Add Zotero schema to Logseq'`,
      default: filteredPropsArray,
      enumPicker: 'checkbox',
      enumChoices: filteredPropsArray,
    },
    {
      key: 'openAttachmentInline',
      type: 'boolean',
      title: 'Open Attachment in Logseq (DB version)',
      description:
        'If disabled, attachments will open in the default system app. If enabled, attachments will open in Logseq.',
      default: true,
    },
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

  logseq.useSettingsSchema(settings)
}
