import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user'

import { ZOT_DATA_KEY_MAP } from './constants'
import { PropertyPreset } from './interfaces'

export const PRESET_CHOICES: PropertyPreset[] = ['Essentials', 'Full', 'Custom']

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
      key: 'propertyPreset',
      type: 'enum',
      title: 'Property Preset',
      description:
        'Choose a preset to control which properties are added to Zotero pages. "Essentials" covers the common citation fields for papers/articles. "Full" includes everything. "Custom" lets you pick individual properties below.',
      default: 'Essentials',
      enumPicker: 'select',
      enumChoices: PRESET_CHOICES,
    },
    {
      key: 'pageProps',
      type: 'enum',
      title: 'Custom Page Properties',
      description: `Only used when Property Preset is set to "Custom". Select the properties to include for each Zotero item. After changing, invoke the command palette and use 'Add Zotero schema to Logseq'.`,
      default: filteredPropsArray,
      enumPicker: 'checkbox',
      enumChoices: filteredPropsArray,
    },
    {
      key: 'openAttachmentInline',
      type: 'boolean',
      title: 'Open Attachment in Logseq',
      description:
        'If disabled, attachments will open in the default system app. If enabled, attachments will open in Logseq.',
      default: true,
    },
    {
      key: 'pagenameTemplate',
      type: 'string',
      title: 'Page Name Template',
      description: `Specify the page name for each Zotero import. Available placeholders: <% citeKey %>, <% title %>`,
      default: `@<% citeKey %>`,
    },
    {
      key: 'zotTag',
      type: 'string',
      title: 'Zotero Tag Name',
      description: `Specify the tag name used for Zotero imports`,
      default: 'Zotero',
    },
  ]

  logseq.useSettingsSchema(settings)
}
