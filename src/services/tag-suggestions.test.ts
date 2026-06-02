import { computeTagOptions, normalizeTagSuggestions } from './tag-suggestions'
import { describe, expect, test } from 'bun:test'

describe('normalizeTagSuggestions', () => {
  test('prefers title over name, trims, drops blanks', () => {
    expect(
      normalizeTagSuggestions([
        { title: '  Paper ', name: 'paper' },
        { title: '', name: 'fallback' },
        { title: undefined, name: '  ' },
        { title: undefined, name: undefined },
      ]),
    ).toEqual(['fallback', 'Paper'])
  })

  test('dedupes case-insensitively, first spelling wins', () => {
    expect(
      normalizeTagSuggestions([
        { title: 'ML', name: 'ml' },
        { title: 'ml', name: 'ml' },
        { title: 'Inbox', name: 'inbox' },
      ]),
    ).toEqual(['Inbox', 'ML'])
  })

  test('sorts with localeCompare', () => {
    expect(
      normalizeTagSuggestions([
        { title: 'zebra', name: 'zebra' },
        { title: 'apple', name: 'apple' },
        { title: 'Mango', name: 'mango' },
      ]),
    ).toEqual(['apple', 'Mango', 'zebra'])
  })

  test('empty input', () => {
    expect(normalizeTagSuggestions([])).toEqual([])
  })
})

describe('computeTagOptions', () => {
  const suggestions = ['inbox', 'ml', 'to-read']

  test('blank query lists all unchosen suggestions, no create row', () => {
    expect(computeTagOptions(suggestions, [], '')).toEqual([
      { kind: 'existing', value: 'inbox' },
      { kind: 'existing', value: 'ml' },
      { kind: 'existing', value: 'to-read' },
    ])
  })

  test('case-insensitive substring filter (create row coexists with a partial match)', () => {
    // 'IN' is a substring of 'inbox' but not an exact match for any tag, so the
    // create row appears alongside it — same exact-match rule as the
    // partial-match case below.
    expect(computeTagOptions(suggestions, [], 'IN')).toEqual([
      { kind: 'existing', value: 'inbox' },
      { kind: 'create', value: 'IN' },
    ])
  })

  test('excludes already-chosen tags (case-insensitively)', () => {
    expect(computeTagOptions(suggestions, ['ML'], '')).toEqual([
      { kind: 'existing', value: 'inbox' },
      { kind: 'existing', value: 'to-read' },
    ])
  })

  test('adds create row when no exact existing match', () => {
    expect(computeTagOptions(suggestions, [], 'new')).toEqual([
      { kind: 'create', value: 'new' },
    ])
  })

  test('no create row when query exactly matches an existing tag (case-insensitive)', () => {
    expect(computeTagOptions(suggestions, [], 'ML')).toEqual([
      { kind: 'existing', value: 'ml' },
    ])
  })

  test('no create row when query exactly matches an already-chosen tag', () => {
    expect(computeTagOptions(suggestions, ['Done'], 'done')).toEqual([])
  })

  test('trims the query for the create value and the exact-match check', () => {
    expect(computeTagOptions(suggestions, [], '  brand new  ')).toEqual([
      { kind: 'create', value: 'brand new' },
    ])
  })

  test('partial match plus create row coexist', () => {
    expect(computeTagOptions(['to-read', 'to-do'], [], 'to')).toEqual([
      { kind: 'existing', value: 'to-read' },
      { kind: 'existing', value: 'to-do' },
      { kind: 'create', value: 'to' },
    ])
  })

  test('whitespace-only query lists all suggestions but no create row', () => {
    expect(computeTagOptions(suggestions, [], '   ')).toEqual([
      { kind: 'existing', value: 'inbox' },
      { kind: 'existing', value: 'ml' },
      { kind: 'existing', value: 'to-read' },
    ])
  })
})
