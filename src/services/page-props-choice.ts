import {
  PROP_DESCRIPTIONS,
  PROP_DISPLAY_NAMES,
  PROP_PRESET_ESSENTIALS,
  ZOT_DATA_KEY_MAP,
} from '../constants'

// Logseq's `enumChoices` are flat strings — both the displayed label and the
// stored value. To show a per-row description in the Custom Page Properties
// checkbox list, we embed `displayName — description` into the choice and
// reverse it on read. `parsePagePropChoice` also accepts the bare camelCase
// key for back-compat with values written before this format existed.
const SEP = ' — '

export const formatPagePropChoice = (key: string): string => {
  const displayName = PROP_DISPLAY_NAMES[key] ?? key
  const description = PROP_DESCRIPTIONS[key]
  return description ? `${displayName}${SEP}${description}` : displayName
}

const DISPLAY_NAME_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(PROP_DISPLAY_NAMES).map(([key, dn]) => [dn, key]),
)

export const parsePagePropChoice = (choice: string): string | null => {
  if (Object.hasOwn(PROP_DISPLAY_NAMES, choice)) return choice
  const displayName = choice.includes(SEP)
    ? (choice.split(SEP)[0] ?? '')
    : choice
  return DISPLAY_NAME_TO_KEY[displayName] ?? null
}

export interface PropertyOption {
  key: string
  displayName: string
  description: string
  isEssential: boolean
}

// Body content / computed fields that aren't real page properties — excluded
// from the picker (mirrors the SKIPPED_PROPS set in settings.ts).
const PICKER_SKIP = new Set(['abstractNote', 'attachments', 'notes', 'inGraph'])

/**
 * Ordered options for the Custom-preset property picker: the curated
 * Essentials first (in preset order), then every other field alphabetical by
 * display name. The Custom Page Properties setting stores `formatPagePropChoice`
 * strings; this drives the richer in-hub picker that replaces Logseq's flat
 * 90-item checkbox list.
 */
export const buildPropertyOptions = (): PropertyOption[] => {
  const essentials = PROP_PRESET_ESSENTIALS.filter((k) => !PICKER_SKIP.has(k))
  const essentialSet = new Set<string>(essentials)
  const extras = Object.keys(ZOT_DATA_KEY_MAP)
    .filter((k) => !PICKER_SKIP.has(k) && !essentialSet.has(k))
    .sort((a, b) =>
      (PROP_DISPLAY_NAMES[a] ?? a).localeCompare(PROP_DISPLAY_NAMES[b] ?? b),
    )
  return [...essentials, ...extras].map((key) => ({
    key,
    displayName: PROP_DISPLAY_NAMES[key] ?? key,
    description: PROP_DESCRIPTIONS[key] ?? '',
    isEssential: essentialSet.has(key),
  }))
}
