import {
  parseSectionOrder,
  serializeSectionOrder,
  WEB_SECTION_DEFAULT_ORDER,
  type WebSectionId,
} from './web-sections'
import { describe, expect, test } from 'bun:test'

describe('parseSectionOrder', () => {
  test('falls back to canonical order for missing / non-string input', () => {
    expect(parseSectionOrder(undefined)).toEqual(WEB_SECTION_DEFAULT_ORDER)
    expect(parseSectionOrder('')).toEqual(WEB_SECTION_DEFAULT_ORDER)
    expect(parseSectionOrder(42)).toEqual(WEB_SECTION_DEFAULT_ORDER)
    expect(parseSectionOrder(['abstract'])).toEqual(WEB_SECTION_DEFAULT_ORDER)
  })

  test('preserves a full, valid order', () => {
    const order: WebSectionId[] = ['highlights', 'pageContent', 'abstract']
    expect(parseSectionOrder('highlights,pageContent,abstract')).toEqual(order)
  })

  test('trims whitespace around ids', () => {
    expect(parseSectionOrder(' abstract , highlights , pageContent ')).toEqual([
      'abstract',
      'highlights',
      'pageContent',
    ])
  })

  test('appends sections the stored value omits, in canonical order', () => {
    expect(parseSectionOrder('pageContent')).toEqual([
      'pageContent',
      'abstract',
      'highlights',
    ])
  })

  test('drops unknown ids and dedupes', () => {
    expect(parseSectionOrder('foo,abstract,abstract,bar,highlights')).toEqual([
      'abstract',
      'highlights',
      'pageContent',
    ])
  })

  test('always returns all three ids exactly once', () => {
    for (const raw of ['', 'pageContent', 'foo', 'abstract,abstract']) {
      const result = parseSectionOrder(raw)
      expect([...result].sort()).toEqual([...WEB_SECTION_DEFAULT_ORDER].sort())
    }
  })
})

describe('serializeSectionOrder', () => {
  test('round-trips through parse', () => {
    const order: WebSectionId[] = ['pageContent', 'highlights', 'abstract']
    expect(parseSectionOrder(serializeSectionOrder(order))).toEqual(order)
  })

  test('joins with commas', () => {
    expect(serializeSectionOrder(WEB_SECTION_DEFAULT_ORDER)).toBe(
      'abstract,highlights,pageContent',
    )
  })
})
