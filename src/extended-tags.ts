import { ZotData } from './interfaces'

// String-valued keys of ZotData. NonNullable strips `undefined` from optional
// fields so e.g. `url?: string` survives while `tags: TagItem[]` is filtered.
// Exported as a typed helper for code that constructs rules programmatically;
// the runtime parser is more lenient (any string is accepted, unknown names
// simply never match).
type StringKeys<T> = keyof {
  [K in keyof T as NonNullable<T[K]> extends string ? K : never]: 0
}

export type RuleField = StringKeys<ZotData>

export type RuleOp = 'contains' | 'equals' | 'regex'

export interface TagRuleCondition {
  field: string
  op: RuleOp
  value: string
}

export interface TagRule {
  tag: string
  match: 'any' | 'all'
  when: TagRuleCondition[]
}

// Default content for the `tagRules` setting. Pre-fills the textarea on first
// install with a working example so the user sees the format. Behavior-
// preserving: this is the rule that previously lived in code.
export const DEFAULT_TAG_RULES_JSON = JSON.stringify(
  [
    {
      tag: 'MLPaper',
      match: 'any',
      when: [
        { field: 'url', op: 'contains', value: 'arxiv.org' },
        { field: 'url', op: 'contains', value: 'openreview.net' },
      ],
    },
  ],
  null,
  2,
)

const VALID_OPS = new Set<RuleOp>(['contains', 'equals', 'regex'])
const VALID_MATCH = new Set(['any', 'all'])

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Parses raw `tagRules` setting input into a validated rule list. Returns the
 * subset of well-formed rules along with human-readable errors for everything
 * that was rejected, so callers can decide whether to log, toast, or ignore.
 *
 * Field names are intentionally not validated against the ZotData schema — any
 * string is accepted, and unknown fields simply never match at eval time. This
 * means future Zotero fields work without parser changes, and a typo'd field
 * produces no false positives.
 */
export const parseTagRules = (
  input: unknown,
): { rules: TagRule[]; errors: string[] } => {
  const errors: string[] = []
  if (input === undefined || input === null || input === '') {
    return { rules: [], errors }
  }

  let raw: unknown = input
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed === '') return { rules: [], errors }
    try {
      raw = JSON.parse(trimmed)
    } catch (e) {
      errors.push(`Invalid JSON: ${(e as Error).message}`)
      return { rules: [], errors }
    }
  }

  if (!Array.isArray(raw)) {
    errors.push('Top-level value must be a JSON array of rules.')
    return { rules: [], errors }
  }

  const rules: TagRule[] = []
  raw.forEach((entry, i) => {
    const ref = `Rule #${i + 1}`
    if (!isObject(entry)) {
      errors.push(`${ref}: must be an object.`)
      return
    }
    const tag = entry.tag
    if (typeof tag !== 'string' || tag.trim() === '') {
      errors.push(`${ref}: \`tag\` must be a non-empty string.`)
      return
    }
    const match = entry.match ?? 'any'
    if (typeof match !== 'string' || !VALID_MATCH.has(match)) {
      errors.push(`${ref}: \`match\` must be "any" or "all".`)
      return
    }
    const when = entry.when
    if (!Array.isArray(when) || when.length === 0) {
      errors.push(`${ref}: \`when\` must be a non-empty array of conditions.`)
      return
    }
    const conditions: TagRuleCondition[] = []
    let condError = false
    when.forEach((c, ci) => {
      const cref = `${ref}, condition #${ci + 1}`
      if (!isObject(c)) {
        errors.push(`${cref}: must be an object.`)
        condError = true
        return
      }
      const { field, op, value } = c
      if (typeof field !== 'string' || field === '') {
        errors.push(`${cref}: \`field\` must be a non-empty string.`)
        condError = true
        return
      }
      if (typeof op !== 'string' || !VALID_OPS.has(op as RuleOp)) {
        errors.push(`${cref}: \`op\` must be "contains", "equals", or "regex".`)
        condError = true
        return
      }
      if (typeof value !== 'string') {
        errors.push(`${cref}: \`value\` must be a string.`)
        condError = true
        return
      }
      if (op === 'regex') {
        try {
          new RegExp(value)
        } catch (e) {
          errors.push(`${cref}: invalid regex (${(e as Error).message})`)
          condError = true
          return
        }
      }
      conditions.push({ field, op: op as RuleOp, value })
    })
    if (condError) return
    rules.push({
      tag: tag.trim(),
      match: match as 'any' | 'all',
      when: conditions,
    })
  })

  return { rules, errors }
}

/**
 * Reads the user's configured tag rules from settings, validates them, and
 * returns the well-formed subset. Logs any parse errors so failures aren't
 * silent at import time. The live "toast on edit" path lives in the settings
 * watcher (`registerTagRulesWatcher`); this is the read path used at import.
 */
export const getConfiguredTagRules = (): TagRule[] => {
  const raw = logseq.settings?.tagRules
  const { rules, errors } = parseTagRules(raw)
  if (errors.length > 0) {
    console.warn('[extended-tags] tagRules has issues:', errors)
  }
  return rules
}

const evalCondition = (item: ZotData, cond: TagRuleCondition): boolean => {
  const raw = (item as Record<string, unknown>)[cond.field]
  if (typeof raw !== 'string' || raw.length === 0) return false
  switch (cond.op) {
    case 'contains':
      return raw.toLowerCase().includes(cond.value.toLowerCase())
    case 'equals':
      return raw.toLowerCase() === cond.value.toLowerCase()
    case 'regex':
      return new RegExp(cond.value, 'i').test(raw)
  }
}

const evalRule = (item: ZotData, rule: TagRule): boolean => {
  if (rule.when.length === 0) return false
  return rule.match === 'any'
    ? rule.when.some((c) => evalCondition(item, c))
    : rule.when.every((c) => evalCondition(item, c))
}

/**
 * Applies every matching rule to an item and returns the resulting tag list.
 * Order in the returned array is rule-declaration order; the underlying Set
 * dedupes overlapping `tag` values.
 */
export const matchTagRules = (item: ZotData, rules: TagRule[]): string[] => {
  const matched = new Set<string>()
  for (const rule of rules) {
    if (evalRule(item, rule)) matched.add(rule.tag)
  }
  return [...matched]
}

// ─── Draft model (for the visual rule-builder modal) ────────────────────────
//
// The stored format is the validated `TagRule[]` above. The editor works on a
// looser *draft* shape: values can be empty / mid-edit, and every rule and
// condition carries a stable client `id` so React can key rows without losing
// focus when the list reorders or a sibling is removed. `validateDraftRules`
// is the bridge back to the strict format — it returns the well-formed subset
// plus structured per-field errors the UI renders inline.

export interface DraftCondition {
  id: string
  field: string
  op: RuleOp
  value: string
}

export interface DraftRule {
  id: string
  tag: string
  match: 'any' | 'all'
  when: DraftCondition[]
}

/** Per-condition error messages, keyed to the slot that failed. */
export interface ConditionErrors {
  field?: string
  value?: string
}

/** Per-rule errors. `when` is keyed by condition id; only failing slots appear. */
export interface RuleErrors {
  tag?: string
  general?: string
  when: Record<string, ConditionErrors>
}

export interface DraftValidation {
  /** The well-formed rules, ready to serialize (client ids stripped). */
  rules: TagRule[]
  /** Keyed by rule id; only rules that have at least one error appear. */
  errors: Record<string, RuleErrors>
  hasErrors: boolean
}

// Counter-backed id generator. Uniqueness within a session is all React keys
// need; the suffix guards against collisions if `Date.now()` is coarse.
let draftIdCounter = 0
export const newDraftId = (): string => {
  draftIdCounter += 1
  return `tr-${draftIdCounter}-${Math.random().toString(36).slice(2, 7)}`
}

export const emptyDraftCondition = (): DraftCondition => ({
  id: newDraftId(),
  field: '',
  op: 'contains',
  value: '',
})

export const emptyDraftRule = (): DraftRule => ({
  id: newDraftId(),
  tag: '',
  match: 'any',
  when: [emptyDraftCondition()],
})

/** Seed the editor from stored rules, assigning fresh client ids. */
export const rulesToDrafts = (rules: TagRule[]): DraftRule[] =>
  rules.map((rule) => ({
    id: newDraftId(),
    tag: rule.tag,
    match: rule.match,
    when: rule.when.map((c) => ({ id: newDraftId(), ...c })),
  }))

/**
 * Validates editor drafts into the strict `TagRule[]` format, collecting
 * inline errors for anything incomplete. Stricter than `parseTagRules` on one
 * point by design: an empty `value` is rejected, because a blank `contains`
 * would silently match every item — almost never the intent when authoring in
 * the GUI. A rule is included in `rules` only when it is wholly well-formed.
 */
export const validateDraftRules = (drafts: DraftRule[]): DraftValidation => {
  const errors: Record<string, RuleErrors> = {}
  const rules: TagRule[] = []

  for (const draft of drafts) {
    const ruleErrors: RuleErrors = { when: {} }
    const tag = draft.tag.trim()
    if (tag === '') ruleErrors.tag = 'Enter a tag name.'
    if (draft.when.length === 0)
      ruleErrors.general = 'Add at least one condition.'

    const conditions: TagRuleCondition[] = []
    for (const cond of draft.when) {
      const condErrors: ConditionErrors = {}
      const field = cond.field.trim()
      if (field === '') condErrors.field = 'Pick a field.'
      if (cond.value.trim() === '') {
        condErrors.value = 'Enter a value.'
      } else if (cond.op === 'regex') {
        try {
          new RegExp(cond.value)
        } catch (e) {
          condErrors.value = `Invalid regex: ${(e as Error).message}`
        }
      }
      if (condErrors.field || condErrors.value) {
        ruleErrors.when[cond.id] = condErrors
      } else {
        conditions.push({ field, op: cond.op, value: cond.value })
      }
    }

    const hasError =
      ruleErrors.tag !== undefined ||
      ruleErrors.general !== undefined ||
      Object.keys(ruleErrors.when).length > 0
    if (hasError) {
      errors[draft.id] = ruleErrors
    } else {
      rules.push({ tag, match: draft.match, when: conditions })
    }
  }

  return { rules, errors, hasErrors: Object.keys(errors).length > 0 }
}

/** Pretty-print rules for storage in the `tagRules` setting. */
export const serializeRules = (rules: TagRule[]): string =>
  JSON.stringify(rules, null, 2)
