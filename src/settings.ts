import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user'

import {
  PROP_DISPLAY_NAMES,
  PROP_PRESET_ESSENTIALS,
  ZOT_DATA_KEY_MAP,
} from './constants'
import { DEFAULT_TAG_RULES_JSON } from './extended-tags'
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
// other property alphabetical by display name. The pre-checked items cluster
// at the top so the user can see at a glance what they're starting from when
// switching to Custom.
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

// Caches the latest connection-test result so re-registering the schema
// doesn't blank the heading description that `main` sets after the first
// connection probe.
let lastConnectionMsg = ''

// Logseq's plugin settings panel reads the schema once when it renders and
// doesn't re-render on `useSettingsSchema` updates — so dynamically *adding*
// `pageProps` when the user switches to Custom would only appear after a
// settings reopen. Instead, register `pageProps` once (always) and hide its
// row via CSS injected through `provideStyle`. The injected styles are
// scoped to this plugin's settings panel via the `.panel-wrap[data-id=…]`
// wrapper Logseq renders around it.
const STYLE_KEY = 'zotero-settings-styles'
const PLUGIN_PANEL = '.panel-wrap[data-id="logseq-zotero"]'

const applySettingsStyles = () => {
  const preset =
    (logseq.settings?.propertyPreset as PropertyPreset | undefined) ??
    'Essentials'
  const hidePageProps = preset !== 'Custom'

  // The focus ring on Logseq's select trigger uses a 2px box-shadow with a
  // 2px offset — visually a bright cyan band wrapped in a pale halo. Drop
  // the shadow and signal focus with a single coloured border instead, which
  // sits flush with the input (no halo) and still meets AA visible-focus.
  //
  // The Custom Page Properties checkbox list inherits Logseq's default
  // `.ui__checkbox-list` styles, which lay items out row-wise with
  // `flex-wrap: wrap` and `white-space: nowrap`. With ~90 items and long
  // "Display Name — description" labels that becomes an unreadable jumble.
  // Override to a column with comfortable spacing and let long labels wrap.
  const baseCss = `
${PLUGIN_PANEL} .ui__select-trigger:focus,
${PLUGIN_PANEL} .ui__select-trigger:focus-visible {
  box-shadow: none;
  border-color: var(--ls-active-primary-color);
}

${PLUGIN_PANEL} [data-key="pageProps"] .ui__checkbox-list {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

${PLUGIN_PANEL} [data-key="pageProps"] .ui__checkbox-list label {
  white-space: normal;
  margin-top: 0;
  padding-right: 0;
}

${PLUGIN_PANEL} [data-key="tagRules"] textarea {
  min-height: 12rem;
  font-family: var(--ls-font-family-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.85rem;
  line-height: 1.45;
}
`

  const hideCss = hidePageProps
    ? `
${PLUGIN_PANEL} [data-key="pageProps"] {
  display: none !important;
}
`
    : ''

  logseq.provideStyle({ key: STYLE_KEY, style: baseCss + hideCss })
}

export const handleSettings = (opts: { msg?: string } = {}) => {
  if (opts.msg !== undefined) lastConnectionMsg = opts.msg

  const { choices, defaults } = buildPagePropsChoices()

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
      description: lastConnectionMsg,
      default: '',
    },
    {
      key: 'schemaSectionHeading',
      type: 'heading',
      title: 'Schema',
      description: `Changes to settings below require running "Zotero: Setup schema" from the command palette to take effect.`,
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
      description:
        'Pick the Zotero fields to import as page properties. Essentials are pre-checked — add more below.',
      default: defaults,
      enumPicker: 'checkbox',
      enumChoices: choices,
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
    {
      key: 'extendedTagsSectionHeading',
      type: 'heading',
      title: 'Extended tags',
      description:
        'Apply additional Logseq tags to imported pages when items match your rules. All matching rules apply (the base Zotero tag is always added on top).',
      default: '',
    },
    {
      key: 'tagRules',
      type: 'string',
      inputAs: 'textarea',
      title: 'Tag rules',
      description: `Operators: contains, equals, regex. Match modes: any, all. Common fields: title, url, DOI, publicationTitle, citationKey, libraryCatalog, itemType. Unknown fields never match.`,
      default: DEFAULT_TAG_RULES_JSON,
    },
  ]

  logseq.useSettingsSchema(settings)
  applySettingsStyles()
}

// Refresh the injected CSS when `propertyPreset` changes — Logseq doesn't
// re-render the open settings panel on schema changes, so toggling
// `pageProps` visibility has to happen at the CSS layer (the row is always
// in the DOM; we just `display: none` it). The stored `pageProps` value
// persists across hide/show.
export const registerPresetVisibilityWatcher = () => {
  logseq.onSettingsChanged((next, prev) => {
    if (!prev) return
    if (next.propertyPreset === prev.propertyPreset) return
    applySettingsStyles()
  })
}

// Translate any stored `pageProps` entries written in the old bare-camelCase
// format ("DOI", "abstractNote", …) into the new "Display Name — description"
// label so the checkbox UI shows the user's prior selection as actually
// checked. The set of selected items is preserved exactly — only the encoding
// changes. Idempotent: values already in the new format pass through.
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
