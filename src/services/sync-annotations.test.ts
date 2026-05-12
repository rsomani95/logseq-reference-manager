import { parseLastSync } from './sync-annotations'
import { describe, expect, test } from 'bun:test'

describe('parseLastSync', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace-only string', '   '],
    ['unparseable garbage', 'not a real date'],
    ['non-string value (number)', 1747037000000],
    ['non-string value (object)', { iso: '2026-05-12T10:00:00.000Z' }],
  ])('returns null for %s — guard refuses to sync', (_label, value) => {
    expect(parseLastSync(value)).toBeNull()
  })

  test('accepts the ISO timestamp written on import', () => {
    // handle-zot-db.ts sets zotero-last-sync via `new Date().toISOString()`.
    // If parseLastSync rejects that exact format, no page can ever sync.
    const iso = new Date().toISOString()
    const parsed = parseLastSync(iso)
    expect(parsed).not.toBeNull()
    expect(parsed?.toISOString()).toBe(iso)
  })

  // All three values represent the same instant — 2026-05-12T10:00:00Z —
  // expressed differently. The function must normalize them identically.
  const sameInstantMs = new Date('2026-05-12T10:00:00Z').getTime()
  test.each([
    ['ISO without milliseconds', '2026-05-12T10:00:00Z'],
    ['ISO with non-UTC offset (+05:30)', '2026-05-12T15:30:00+05:30'],
    ['ISO with surrounding whitespace', '  2026-05-12T10:00:00Z  '],
  ])('accepts %s and parses to the right instant', (_label, value) => {
    const parsed = parseLastSync(value)
    expect(parsed).not.toBeNull()
    expect(parsed?.getTime()).toBe(sameInstantMs)
  })
})
