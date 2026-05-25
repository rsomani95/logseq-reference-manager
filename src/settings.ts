import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user'

import {
  PLUGIN_ID,
  PROP_DISPLAY_NAMES,
  PROP_PRESET_ESSENTIALS,
  ZOT_DATA_KEY_MAP,
} from './constants'
import { PropertyPreset } from './interfaces'
import { formatPagePropChoice } from './services/page-props-choice'

export const PRESET_CHOICES: PropertyPreset[] = ['Essentials', 'Full', 'Custom']

const SKIPPED_PROPS = new Set([
  'abstractNote',
  'attachments',
  'notes',
  'inGraph',
])

// Essentials first (in the curated `PROP_PRESET_ESSENTIALS` order), then every
// other property alphabetical by display name. Drives the `pageProps` enum's
// defaults / choices — the in-hub PropertyPicker is the real editing surface,
// but the schema entry still needs valid choices so Logseq populates the
// default selection on a fresh install.
const buildPagePropsChoices = (): {
  choices: string[]
  defaults: string[]
} => {
  const essentials = PROP_PRESET_ESSENTIALS.filter((k) => !SKIPPED_PROPS.has(k))
  const essentialSet = new Set<string>(essentials)
  const extras = Object.keys(ZOT_DATA_KEY_MAP)
    .filter((k) => !SKIPPED_PROPS.has(k) && !essentialSet.has(k))
    .sort((a, b) =>
      (PROP_DISPLAY_NAMES[a] ?? a).localeCompare(PROP_DISPLAY_NAMES[b] ?? b),
    )

  return {
    choices: [...essentials, ...extras].map(formatPagePropChoice),
    defaults: essentials.map(formatPagePropChoice),
  }
}

// Caches the latest connection-test result so re-registering the schema doesn't
// blank the heading description that `main` sets after the first connection probe.
let lastConnectionMsg = ''

const STYLE_KEY = 'zotero-settings-styles'
const PLUGIN_PANEL = `.panel-wrap[data-id="${PLUGIN_ID}"]`

// Every real setting now lives in the in-app setup window (the `Zotero:
// Settings` command); the native panel is just a launcher + live connection
// status. These keys stay in the schema only so Logseq still populates their
// defaults on a fresh install — and so the host's `settings:changed` handler
// stays stable (see the pre-ready note in index.tsx). We hide their rows rather
// than drop the keys. The plugin iframe can't reach the settings-panel DOM
// directly; injected CSS scoped to this plugin's panel wrapper is the only way
// across that boundary (same trick the old preset/tag-rules gating used).
const HIDDEN_KEYS = [
  'zotTag',
  'propertyPreset',
  'pageProps',
  'creatorsAsNodes',
  'creatorNameTemplate',
  'pagenameTemplate',
  'openAttachmentInline',
]

const applySettingsStyles = () => {
  const style = HIDDEN_KEYS.map(
    (key) =>
      `${PLUGIN_PANEL} [data-key="${key}"] { display: none !important; }`,
  ).join('\n')
  logseq.provideStyle({ key: STYLE_KEY, style })
}

export const handleSettings = (opts: { msg?: string } = {}) => {
  if (opts.msg !== undefined) lastConnectionMsg = opts.msg

  const { choices, defaults } = buildPagePropsChoices()

  const settings: SettingSchemaDesc[] = [
    {
      key: 'openSetup',
      type: 'heading',
      title: 'Zotero (Local)',
      description:
        'All settings live in the setup window. Open the command palette and run “Zotero: Settings” to configure the connection, library, import formats, and tag rules.',
      default: '',
    },
    {
      key: 'testConnection',
      type: 'heading',
      title: 'Connection',
      description: lastConnectionMsg,
      default: '',
    },
    // ─── Hidden below ──────────────────────────────────────────────────────
    // Edited in the setup window; kept here only so Logseq populates their
    // defaults. `applySettingsStyles` hides every one of these rows.
    {
      key: 'zotTag',
      type: 'string',
      title: 'Zotero Tag Name',
      description: 'The tag name used for Zotero imports.',
      default: 'Reference',
    },
    {
      key: 'propertyPreset',
      type: 'enum',
      title: 'Property Preset',
      description: '',
      default: 'Essentials',
      enumPicker: 'select',
      enumChoices: PRESET_CHOICES,
    },
    {
      key: 'pageProps',
      type: 'enum',
      title: 'Custom Page Properties',
      description: '',
      default: defaults,
      enumPicker: 'checkbox',
      enumChoices: choices,
    },
    {
      key: 'creatorsAsNodes',
      type: 'boolean',
      title: 'Store Creators as Page References',
      description: '',
      default: true,
    },
    {
      key: 'creatorNameTemplate',
      type: 'string',
      title: 'Creator Name Format',
      description: '',
      default: '<% firstName %> <% lastName %>',
    },
    {
      key: 'pagenameTemplate',
      type: 'string',
      title: 'Page Name Template',
      description: '',
      default: '@<% citeKey %>',
    },
    {
      key: 'openAttachmentInline',
      type: 'boolean',
      title: 'Open Attachment in Logseq',
      description: '',
      default: true,
    },
  ]

  logseq.useSettingsSchema(settings)
  applySettingsStyles()
}

// Translate any stored `pageProps` entries written in the old bare-camelCase
// format ("DOI", "abstractNote", …) into the new "Display Name — description"
// label so the picker shows the user's prior selection as actually checked.
// The set of selected items is preserved exactly — only the encoding changes.
// Idempotent: values already in the new format pass through.
export const migratePagePropsIfNeeded = () => {
  const stored = logseq.settings?.pageProps as string[] | undefined
  if (!stored?.length) return
  const migrated = stored.map((v) =>
    Object.hasOwn(PROP_DISPLAY_NAMES, v) ? formatPagePropChoice(v) : v,
  )
  if (migrated.some((v, i) => v !== stored[i])) {
    logseq.updateSettings({ pageProps: migrated })
  }
}
