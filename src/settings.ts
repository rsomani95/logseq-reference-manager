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
  'creatorSeparator',
  'pagenameTemplate',
  'pagenamePrefix',
  'openAttachmentInline',
  'webTag',
  'webCapturePageContent',
  'webPageContentBlockName',
  'webHighlightsBlockName',
  'webUseHeadingMarkers',
  'webPopulatePageTags',
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
      title: 'Reference Manager',
      description:
        'All settings live in the setup window. Open the command palette and run “Reference Manager: Settings” to configure the shared schema, Zotero (connection, import formats, tag rules), and Web references.',
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
      title: 'Base reference tag',
      description:
        'The shared base tag every reference page carries. Web clips extend it, so it owns the schema.',
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
      // Joins author names when creators are stored as plain text. Default
      // matches the previously-hardcoded join, so existing graphs are unchanged.
      key: 'creatorSeparator',
      type: 'string',
      title: 'Creator Separator',
      description: '',
      default: ', ',
    },
    {
      key: 'pagenameTemplate',
      type: 'string',
      title: 'Page Name Template',
      description: '',
      default: '@<% citeKey %>',
    },
    {
      // Literal lead-in prepended to the page name (e.g. the academic `@`).
      // Seeds empty; `migratePagenamePrefixIfNeeded` peels the leading literal
      // out of the (default or stored) template into this key on first load, so
      // new installs get `@` and existing templates keep their exact output.
      key: 'pagenamePrefix',
      type: 'string',
      title: 'Page Name Prefix',
      description: '',
      default: '',
    },
    {
      key: 'openAttachmentInline',
      type: 'boolean',
      title: 'Open Attachment in Logseq',
      description: '',
      default: true,
    },
    // ─── Web references ────────────────────────────────────────────────────
    // Read over the HTTP API by the companion web-clipper extension (it reads
    // the live store; it cannot write these). Edited in the hub's Web
    // references section. The keys/types/defaults are a contract with the
    // extension — see WEB references in settings.md before renaming any.
    {
      key: 'webTag',
      type: 'string',
      title: 'Web Tag',
      description: '',
      default: 'Web',
    },
    {
      key: 'webCapturePageContent',
      type: 'boolean',
      title: 'Capture Page Content',
      description: '',
      default: true,
    },
    {
      key: 'webPageContentBlockName',
      type: 'string',
      title: 'Page Content Block Name',
      description: '',
      default: 'Page Content',
    },
    {
      key: 'webHighlightsBlockName',
      type: 'string',
      title: 'Highlights Block Name',
      description: '',
      default: 'Highlights',
    },
    {
      key: 'webUseHeadingMarkers',
      type: 'boolean',
      title: 'Use Heading Markers',
      description: '',
      default: false,
    },
    {
      key: 'webPopulatePageTags',
      type: 'boolean',
      title: 'Populate Page Tags',
      description: '',
      default: false,
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

// Splits the page-name template into a literal `pagenamePrefix` + a token-led
// body, so the prefix (e.g. the academic `@`) is editable on its own. Peels any
// literal text before the first `<% … %>` into the prefix and strips it from the
// template. Idempotent: once the template starts with a token there's nothing to
// peel. Runs for everyone on load —
//   • new install: the default `@<% citeKey %>` → prefix `@`, body `<% citeKey %>`
//   • old `@`-prefixed template → same split, output unchanged
//   • a bare `<% citeKey %>` / `<% title %>` / `<% citeKey %> — <% title %>` →
//     no leading literal, so prefix stays empty and output is preserved exactly
// `pagenamePrefix` seeds empty (not `@`) precisely so a user who removed the `@`
// isn't given one back here.
export const migratePagenamePrefixIfNeeded = () => {
  const tpl = logseq.settings?.pagenameTemplate as string | undefined
  if (tpl == null) return
  const tokenStart = tpl.indexOf('<%')
  // tokenStart <= 0 → no leading literal to peel (already split, or no token).
  if (tokenStart <= 0) return
  logseq.updateSettings({
    pagenamePrefix: tpl.slice(0, tokenStart),
    pagenameTemplate: tpl.slice(tokenStart),
  })
}
