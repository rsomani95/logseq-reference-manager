import {
  type DraftRule,
  matchTagRules,
  parseTagRules,
  rulesToDrafts,
  serializeRules,
  type TagRule,
  validateDraftRules,
} from './extended-tags'
import { ZotData } from './interfaces'
import { describe, expect, test } from 'bun:test'

const item = (overrides: Partial<ZotData> = {}): ZotData =>
  ({
    title: 'sample',
    citeKey: 'sampleKey',
    dateAdded: '2026-01-01T00:00:00.000Z',
    dateModified: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as unknown as ZotData

describe('parseTagRules', () => {
  test('empty/null/undefined input returns no rules and no errors', () => {
    for (const v of ['', '   ', null, undefined]) {
      const out = parseTagRules(v)
      expect(out.rules).toEqual([])
      expect(out.errors).toEqual([])
    }
  })

  test('parses a valid single-rule JSON string', () => {
    const json = JSON.stringify([
      {
        tag: 'MLPaper',
        match: 'any',
        when: [{ field: 'url', op: 'contains', value: 'arxiv.org' }],
      },
    ])
    const { rules, errors } = parseTagRules(json)
    expect(errors).toEqual([])
    expect(rules).toEqual([
      {
        tag: 'MLPaper',
        match: 'any',
        when: [{ field: 'url', op: 'contains', value: 'arxiv.org' }],
      },
    ])
  })

  test('accepts a pre-parsed array (not just a JSON string)', () => {
    const arr = [
      {
        tag: 'X',
        match: 'all',
        when: [{ field: 'title', op: 'equals', value: 'foo' }],
      },
    ]
    const { rules, errors } = parseTagRules(arr)
    expect(errors).toEqual([])
    expect(rules).toHaveLength(1)
  })

  test('reports invalid JSON', () => {
    const { rules, errors } = parseTagRules('{ not json')
    expect(rules).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/Invalid JSON/)
  })

  test('rejects non-array top-level', () => {
    const { rules, errors } = parseTagRules('{"tag":"X"}')
    expect(rules).toEqual([])
    expect(errors[0]).toMatch(/must be a JSON array/)
  })

  test('skips bad rules but keeps the good ones', () => {
    const json = JSON.stringify([
      {
        tag: 'Good',
        match: 'any',
        when: [{ field: 'url', op: 'contains', value: 'arxiv.org' }],
      },
      { tag: '', match: 'any', when: [] },
      {
        tag: 'BadOp',
        match: 'any',
        when: [{ field: 'url', op: 'startsWith', value: 'http' }],
      },
      {
        tag: 'BadRegex',
        match: 'any',
        when: [{ field: 'title', op: 'regex', value: '[unterminated' }],
      },
    ])
    const { rules, errors } = parseTagRules(json)
    expect(rules.map((r) => r.tag)).toEqual(['Good'])
    expect(errors).toHaveLength(3)
  })

  test('defaults `match` to "any" when omitted', () => {
    const json = JSON.stringify([
      {
        tag: 'X',
        when: [{ field: 'url', op: 'contains', value: 'foo' }],
      },
    ])
    const { rules, errors } = parseTagRules(json)
    expect(errors).toEqual([])
    expect(rules[0]?.match).toBe('any')
  })
})

describe('matchTagRules', () => {
  const rules: TagRule[] = [
    {
      tag: 'MLPaper',
      match: 'any',
      when: [
        { field: 'url', op: 'contains', value: 'arxiv.org' },
        { field: 'url', op: 'contains', value: 'openreview.net' },
      ],
    },
    {
      tag: 'OAcc',
      match: 'all',
      when: [
        { field: 'url', op: 'contains', value: 'arxiv.org' },
        { field: 'itemType', op: 'equals', value: 'preprint' },
      ],
    },
  ]

  test('returns no tags when nothing matches', () => {
    expect(matchTagRules(item({ url: 'https://example.com' }), rules)).toEqual(
      [],
    )
  })

  test('matches "any" when a single condition matches', () => {
    expect(
      matchTagRules(item({ url: 'https://arxiv.org/abs/2401.00001' }), rules),
    ).toContain('MLPaper')
  })

  test('matches "all" only when every condition matches', () => {
    expect(
      matchTagRules(
        item({
          url: 'https://arxiv.org/abs/2401.00001',
          itemType: 'preprint',
        }),
        rules,
      ),
    ).toEqual(['MLPaper', 'OAcc'])

    expect(
      matchTagRules(
        item({
          url: 'https://arxiv.org/abs/2401.00001',
          itemType: 'journalArticle',
        }),
        rules,
      ),
    ).toEqual(['MLPaper'])
  })

  test('unknown fields silently fail (no exception)', () => {
    const ruleset: TagRule[] = [
      {
        tag: 'X',
        match: 'any',
        when: [{ field: 'totallyMadeUpField', op: 'contains', value: 'foo' }],
      },
    ]
    expect(matchTagRules(item({ title: 'foo' }), ruleset)).toEqual([])
  })

  test('regex op is case-insensitive', () => {
    const ruleset: TagRule[] = [
      {
        tag: 'X',
        match: 'any',
        when: [{ field: 'title', op: 'regex', value: '^Foo' }],
      },
    ]
    expect(matchTagRules(item({ title: 'foobar' }), ruleset)).toEqual(['X'])
  })

  test('empty rule list returns no tags', () => {
    expect(matchTagRules(item({ url: 'https://arxiv.org' }), [])).toEqual([])
  })
})

const draftCond = (
  over: Partial<DraftRule['when'][number]> = {},
): DraftRule['when'][number] => ({
  id: 'c1',
  field: 'url',
  op: 'contains',
  value: 'arxiv.org',
  ...over,
})

const draftRule = (over: Partial<DraftRule> = {}): DraftRule => ({
  id: 'r1',
  tag: 'MLPaper',
  match: 'any',
  when: [draftCond()],
  ...over,
})

describe('validateDraftRules', () => {
  test('a well-formed draft produces a rule and no errors', () => {
    const out = validateDraftRules([draftRule()])
    expect(out.hasErrors).toBe(false)
    expect(out.errors).toEqual({})
    expect(out.rules).toEqual([
      {
        tag: 'MLPaper',
        match: 'any',
        when: [{ field: 'url', op: 'contains', value: 'arxiv.org' }],
      },
    ])
  })

  test('trims the tag name', () => {
    const out = validateDraftRules([draftRule({ tag: '  MLPaper  ' })])
    expect(out.rules[0]?.tag).toBe('MLPaper')
  })

  test('flags an empty tag and omits the rule', () => {
    const out = validateDraftRules([draftRule({ id: 'r1', tag: '   ' })])
    expect(out.hasErrors).toBe(true)
    expect(out.errors.r1?.tag).toBeDefined()
    expect(out.rules).toEqual([])
  })

  test('flags an empty value (a blank "contains" matches everything)', () => {
    const out = validateDraftRules([
      draftRule({ id: 'r1', when: [draftCond({ id: 'c1', value: '' })] }),
    ])
    expect(out.errors.r1?.when.c1?.value).toBeDefined()
    expect(out.rules).toEqual([])
  })

  test('flags a field that has not been chosen', () => {
    const out = validateDraftRules([
      draftRule({ id: 'r1', when: [draftCond({ id: 'c1', field: '' })] }),
    ])
    expect(out.errors.r1?.when.c1?.field).toBeDefined()
  })

  test('flags an invalid regex value', () => {
    const out = validateDraftRules([
      draftRule({
        id: 'r1',
        when: [draftCond({ id: 'c1', op: 'regex', value: '(' })],
      }),
    ])
    expect(out.errors.r1?.when.c1?.value).toContain('regex')
    expect(out.rules).toEqual([])
  })

  test('accepts a valid regex value', () => {
    const out = validateDraftRules([
      draftRule({ when: [draftCond({ op: 'regex', value: '^arxiv' })] }),
    ])
    expect(out.hasErrors).toBe(false)
  })

  test('accepts a custom (unknown) field name', () => {
    const out = validateDraftRules([
      draftRule({
        when: [draftCond({ field: 'someFutureField', value: 'x' })],
      }),
    ])
    expect(out.hasErrors).toBe(false)
    expect(out.rules[0]?.when[0]?.field).toBe('someFutureField')
  })

  test('keeps valid rules and reports only the invalid ones', () => {
    const out = validateDraftRules([
      draftRule({ id: 'good', tag: 'Good' }),
      draftRule({ id: 'bad', tag: '' }),
    ])
    expect(out.rules).toHaveLength(1)
    expect(out.rules[0]?.tag).toBe('Good')
    expect(out.errors.bad).toBeDefined()
    expect(out.errors.good).toBeUndefined()
  })
})

describe('serializeRules', () => {
  test('round-trips through parseTagRules', () => {
    const rules: TagRule[] = [
      {
        tag: 'MLPaper',
        match: 'any',
        when: [
          { field: 'url', op: 'contains', value: 'arxiv.org' },
          { field: 'url', op: 'contains', value: 'openreview.net' },
        ],
      },
    ]
    expect(parseTagRules(serializeRules(rules)).rules).toEqual(rules)
  })

  test('serializes an empty list to "[]"', () => {
    expect(serializeRules([])).toBe('[]')
  })
})

describe('rulesToDrafts', () => {
  test('preserves rule data and validates back to the originals', () => {
    const rules: TagRule[] = [
      {
        tag: 'MLPaper',
        match: 'all',
        when: [{ field: 'DOI', op: 'equals', value: '10.x' }],
      },
    ]
    const drafts = rulesToDrafts(rules)
    expect(drafts[0]?.tag).toBe('MLPaper')
    expect(drafts[0]?.match).toBe('all')
    expect(typeof drafts[0]?.id).toBe('string')
    expect(typeof drafts[0]?.when[0]?.id).toBe('string')
    expect(validateDraftRules(drafts).rules).toEqual(rules)
  })

  test('assigns unique ids across rules and conditions', () => {
    const rules: TagRule[] = [
      {
        tag: 'A',
        match: 'any',
        when: [{ field: 'url', op: 'contains', value: 'a' }],
      },
      {
        tag: 'B',
        match: 'any',
        when: [{ field: 'url', op: 'contains', value: 'b' }],
      },
    ]
    const drafts = rulesToDrafts(rules)
    const ids = [
      ...drafts.map((d) => d.id),
      ...drafts.flatMap((d) => d.when.map((c) => c.id)),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})
