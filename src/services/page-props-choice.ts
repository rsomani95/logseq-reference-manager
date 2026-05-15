import { PROP_DESCRIPTIONS, PROP_DISPLAY_NAMES } from '../constants'

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
