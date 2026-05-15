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

  // Settings are clustered into two groups by an asymmetry the user can't
  // otherwise see: settings under `Schema` mutate the Logseq tag / property
  // graph (and only take effect after re-running the schema command), while
  // settings under `Import behavior` only affect what gets written at import
  // time. One heading per group says the rerun requirement *once*, where it
  // applies, instead of repeating it in every description. A debounced toast
  // in index.tsx catches the user at the moment of change for the acute case.
  const settings: SettingSchemaDesc[] = [
    {
      key: 'testConnection',
      type: 'heading',
      title: 'Connection Test',
      description: msg,
      default: '',
    },
    {
      key: 'schemaSectionHeading',
      type: 'heading',
      title: 'Schema',
      description: `Changes to settings below require running "Zotero: Add Zotero schema to Logseq" from the command palette to take effect.`,
      default: '',
    },
    {
      key: 'zotTag',
      type: 'string',
      title: 'Zotero Tag Name',
      description: `Specify the tag name used for Zotero imports`,
      default: 'Zotero',
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
      description: `Only used when Property Preset is set to "Custom". Select the properties to include for each Zotero item.`,
      default: filteredPropsArray,
      enumPicker: 'checkbox',
      enumChoices: filteredPropsArray,
    },
    {
      key: 'creatorsAsNodes',
      type: 'boolean',
      title: 'Store Creators as Page References',
      description:
        'If enabled, each author/creator becomes its own Logseq page and the property holds a page reference (lets you navigate from a creator page to all their works). If disabled, creators are stored as plain text.',
      default: true,
    },
    {
      key: 'importBehaviorSectionHeading',
      type: 'heading',
      title: 'Import behavior',
      description: '',
      default: '',
    },
    {
      key: 'creatorNameTemplate',
      type: 'string',
      title: 'Creator Name Format',
      description: `Specify how each author/creator name is rendered (used for the creator page title when stored as a reference, or for each entry when stored as text). Available placeholders: <% firstName %>, <% lastName %>. Multiple creators are always comma-separated when stored as text.`,
      default: `<% firstName %> <% lastName %>`,
    },
    {
      key: 'pagenameTemplate',
      type: 'string',
      title: 'Page Name Template',
      description: `Specify the page name for each Zotero import. Available placeholders: <% citeKey %>, <% title %>`,
      default: `@<% citeKey %>`,
    },
    {
      key: 'openAttachmentInline',
      type: 'boolean',
      title: 'Open Attachment in Logseq',
      description:
        'If disabled, attachments will open in the default system app. If enabled, attachments will open in Logseq.',
      default: true,
    },
  ]

  logseq.useSettingsSchema(settings)
}
