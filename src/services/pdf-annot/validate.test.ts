/**
 * validate.test.ts — golden round-trip test for src/validate.ts.
 *
 * Loads the xu __pdf-expert fixtures (the EMITTED ConvertResult records + the page
 * geometry map) and proves the native -> stored-scaled -> pixel transform is
 * an exact inverse: scaledToViewport(stored) must reproduce fitz_native*scale
 * to < 1e-6 (verdict PASS), and the result must be scale-independent.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ConvertedRecord, ConvertResult, PageGeom } from './types'
import { validate } from './validate'
import { describe, expect, test } from 'bun:test'

const OUT = resolve(
  import.meta.dir,
  '__fixtures__/pdf-golden',
  'xu-et_al_2025_qwen3-omni_technical_report__pdf-expert',
)

function loadRecords(): ConvertedRecord[] {
  const data = JSON.parse(
    readFileSync(`${OUT}/logseq-annotations.json`, 'utf8'),
  ) as ConvertResult
  return data.records
}

function loadPages(): Record<string, PageGeom> {
  // pages.json wraps the page-index-keyed map under a "pages" key.
  const data = JSON.parse(readFileSync(`${OUT}/pages.json`, 'utf8')) as {
    pages: Record<string, PageGeom>
  }
  return data.pages
}

const EPS = 1e-6

describe('validate (xu __pdf-expert golden round-trip)', () => {
  const records = loadRecords()
  const pages = loadPages()

  test('fixtures are non-trivial (sanity)', () => {
    expect(records.length).toBeGreaterThan(0)
    // distinct pages present in the xu records: 1, 2, 4, 5, 7
    const distinctPages = new Set(records.map((r) => r.page))
    expect(distinctPages.size).toBeGreaterThan(0)
  })

  test('scale 2.0: PASS, max_err < 1e-6, n_pages > 0, overlays empty', () => {
    const res = validate(records, pages, { scale: 2.0 })
    expect(res.verdict).toBe('PASS')
    expect(res.max_err).toBeLessThan(EPS)
    expect(res.n_pages).toBeGreaterThan(0)
    // n_pages is the count of DISTINCT pages in the records.
    expect(res.n_pages).toBe(new Set(records.map((r) => r.page)).size)
    // The fs-free core never renders PNG overlays.
    expect(res.overlays).toEqual([])
  })

  test('default scale (2.0 when omitted) also PASSes', () => {
    const res = validate(records, pages)
    expect(res.verdict).toBe('PASS')
    expect(res.max_err).toBeLessThan(EPS)
    expect(res.n_pages).toBeGreaterThan(0)
  })
})

describe('validate (empty case)', () => {
  test('no records -> N/A, max_err 0, n_pages 0, overlays []', () => {
    const res = validate([], {})
    expect(res.verdict).toBe('N/A')
    expect(res.max_err).toBe(0)
    expect(res.n_pages).toBe(0)
    expect(res.overlays).toEqual([])
  })
})

describe('validate (scale independence)', () => {
  const records = loadRecords()
  const pages = loadPages()

  // Storing the fitz rect verbatim with width/height = page dims makes the
  // proportional read-back exactly fitz_coord*scale at any scale, so the
  // round-trip error stays ~0 regardless of scale.
  for (const scale of [1.0, 3.0]) {
    test(`scale ${scale}: PASS, max_err < 1e-6`, () => {
      const res = validate(records, pages, { scale })
      expect(res.verdict).toBe('PASS')
      expect(res.max_err).toBeLessThan(EPS)
      expect(res.n_pages).toBeGreaterThan(0)
    })
  }

  test('max_err is identical across scales 1.0 / 2.0 / 3.0 (true scale-independence)', () => {
    const e1 = validate(records, pages, { scale: 1.0 }).max_err
    const e2 = validate(records, pages, { scale: 2.0 }).max_err
    const e3 = validate(records, pages, { scale: 3.0 }).max_err
    // All effectively zero; assert each is < EPS and within EPS of the others.
    expect(e1).toBeLessThan(EPS)
    expect(e2).toBeLessThan(EPS)
    expect(e3).toBeLessThan(EPS)
    expect(Math.abs(e1 - e2)).toBeLessThan(EPS)
    expect(Math.abs(e2 - e3)).toBeLessThan(EPS)
  })
})
