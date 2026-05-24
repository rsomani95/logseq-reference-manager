import { PROP_DISPLAY_NAMES, ZOT_DATA_KEY_MAP } from '../constants'

export interface TagRuleFieldOption {
  value: string
  label: string
}

// Curated fields promoted to the top of the picker — the ones a rule almost
// always keys off. Mirrors the set previously named in the `tagRules` setting
// description so existing docs stay accurate.
export const COMMON_TAG_RULE_FIELDS = [
  'title',
  'url',
  'DOI',
  'publicationTitle',
  'citationKey',
  'libraryCatalog',
  'itemType',
] as const

// Fields that exist on `ZotData` but never carry a matchable string on a parent
// item: arrays / objects (creators, tags, collections), annotation-only fields
// (annotations are grandchildren, not parents), child-only attachment fields,
// and internal identifiers. Hidden from the picker to keep it honest — the
// "Custom field" entry still lets a power user type any of them if needed, and
// the parser accepts any string.
const NON_MATCHABLE = new Set<string>([
  'authors',
  'creators',
  'tags',
  'collections',
  'relations',
  'annotationAuthorName',
  'annotationColor',
  'annotationComment',
  'annotationPageLabel',
  'annotationPosition',
  'annotationSortIndex',
  'annotationText',
  'annotationType',
  'charset',
  'contentType',
  'filename',
  'key',
  'linkMode',
  'md5',
  'mtime',
  'note',
  'parentItem',
  'version',
])

const labelFor = (key: string): string => PROP_DISPLAY_NAMES[key] ?? key

export const COMMON_FIELD_OPTIONS: TagRuleFieldOption[] =
  COMMON_TAG_RULE_FIELDS.map((key) => ({ value: key, label: labelFor(key) }))

const commonSet = new Set<string>(COMMON_TAG_RULE_FIELDS)

// Every other matchable field, alphabetical by display name (same ordering the
// settings page-property picker uses for its long tail).
export const OTHER_FIELD_OPTIONS: TagRuleFieldOption[] = Object.keys(
  ZOT_DATA_KEY_MAP,
)
  .filter((key) => !commonSet.has(key) && !NON_MATCHABLE.has(key))
  .map((key) => ({ value: key, label: labelFor(key) }))
  .sort((a, b) => a.label.localeCompare(b.label))

const KNOWN_FIELD_VALUES = new Set<string>([
  ...COMMON_TAG_RULE_FIELDS,
  ...OTHER_FIELD_OPTIONS.map((o) => o.value),
])

/** Whether a field value is one the dropdown lists (vs. a custom entry). */
export const isKnownField = (value: string): boolean =>
  KNOWN_FIELD_VALUES.has(value)
