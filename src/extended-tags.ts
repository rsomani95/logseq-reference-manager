import { ZotData } from './interfaces'

// String-valued keys of ZotData. NonNullable strips `undefined` from optional
// fields so e.g. `url?: string` survives while `tags: TagItem[]` is filtered.
type StringKeys<T> = keyof {
  [K in keyof T as NonNullable<T[K]> extends string ? K : never]: 0
}

export type RuleField = StringKeys<ZotData>

export type RuleOp = 'contains' | 'equals' | 'regex'

export interface TagRuleCondition {
  field: RuleField
  op: RuleOp
  value: string
}

export interface TagRule {
  tag: string
  match: 'any' | 'all'
  when: TagRuleCondition[]
}

export const TAG_RULES: TagRule[] = [
  {
    tag: 'MLPaper',
    match: 'any',
    when: [
      { field: 'url', op: 'contains', value: 'arxiv.org' },
      { field: 'url', op: 'contains', value: 'openreview.net' },
    ],
  },
]

const evalCondition = (item: ZotData, cond: TagRuleCondition): boolean => {
  const raw = item[cond.field]
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

export const matchTagRules = (item: ZotData): string[] => {
  const matched = new Set<string>()
  for (const rule of TAG_RULES) {
    if (evalRule(item, rule)) {
      matched.add(rule.tag)
      // First-match-wins. Remove this `break` to apply every matching rule;
      // the Set already dedupes overlapping `tag` values.
      break
    }
  }
  return [...matched]
}
