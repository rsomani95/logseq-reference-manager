import { ZotItem } from '../interfaces'
import { filterAnnotationsSince } from './get-zot-items'
import { describe, expect, test } from 'bun:test'

const annotation = (
  overrides: Partial<{
    dateAdded: string
    annotationText: string | undefined
    annotationComment: string
    annotationSortIndex: string
  }> = {},
): ZotItem =>
  ({
    data: {
      dateAdded: '2026-01-01T00:00:00.000Z',
      dateModified: '2026-01-01T00:00:00.000Z',
      annotationText: 'sample',
      annotationComment: '',
      annotationSortIndex: '00000|000000|00000',
      ...overrides,
    },
  }) as unknown as ZotItem

describe('filterAnnotationsSince', () => {
  test('with a valid `since`, returns ONLY annotations strictly after it', () => {
    const since = '2026-01-15T00:00:00.000Z'
    const annotations = [
      annotation({
        dateAdded: '2026-01-01T00:00:00.000Z',
        annotationText: 'before',
      }),
      annotation({
        dateAdded: '2026-01-15T00:00:00.000Z',
        annotationText: 'at-cutoff',
      }),
      annotation({
        dateAdded: '2026-01-20T00:00:00.000Z',
        annotationText: 'after',
      }),
    ]
    const result = filterAnnotationsSince(annotations, since)
    expect(result.map((a) => a.annotationText)).toEqual(['after'])
  })

  test('without `since`, returns everything — this is the dangerous default the guard protects against', () => {
    const annotations = [
      annotation({ dateAdded: '2024-01-01T00:00:00.000Z' }),
      annotation({ dateAdded: '2025-01-01T00:00:00.000Z' }),
    ]
    expect(filterAnnotationsSince(annotations)).toHaveLength(2)
  })

  test('skips annotations with empty or missing text', () => {
    const annotations = [
      annotation({ annotationText: '' }),
      annotation({ annotationText: undefined }),
      annotation({ annotationText: 'kept' }),
    ]
    const result = filterAnnotationsSince(annotations)
    expect(result).toHaveLength(1)
    expect(result[0]?.annotationText).toBe('kept')
  })
})
