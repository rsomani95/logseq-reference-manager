/**
 * convert.test.ts — broadest stage-1 parity test (no PDF library needed).
 *
 * For each golden dir under out/ that has annotations.json + pages.json +
 * logseq-annotations.json, we reconstruct an ExtractResult by merging
 * annotations.json (which already carries `annotations`, summaries, etc.) with
 * `pages` from pages.json, run convert() with the golden's own asset uuid/title,
 * and assert that the tallies and the full records array match the golden
 * byte-for-byte (deep-equal). Records carry no machine-specific fields (the
 * per-machine source_pdf / asset uuid+title are not inside records), and every
 * golden record reuses a well-formed /NM as its uuid, so no fresh random UUID is
 * minted — the deep-equal is fully deterministic.
 *
 * This single sweep exercises Underline / FreeText / Highlight / Text / Link /
 * Popup, the color buckets (incl. the peach #FFCCA1 / cream #FCF5A4 -> red edge
 * cases in the xu dir), empty content tallies, and the zero-annotation no-op.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { categoryForSubtype, convert } from './convert'
import type { ConvertResult, ExtractResult, PageGeom } from './types'
import { describe, expect, test } from 'bun:test'

const OUT_DIR = resolve(import.meta.dir, '__fixtures__/pdf-golden')

/** Golden dirs known to carry all three convert fixtures. */
// ported: dropped radzikowski_chen_2026_epicure, bai-et_al_2025_qwen2, zero_annot
// from GOLDEN_DIRS — fixtures not vendored (regenerate from source PDF to re-enable).
const GOLDEN_DIRS = [
  'xu-et_al_2025_qwen3-omni_technical_report__pdf-expert',
] as const

function readJson<T>(stem: string, name: string): T {
  const p = resolve(OUT_DIR, stem, name)
  return JSON.parse(readFileSync(p, 'utf8')) as T
}

/** annotations.json shape (an ExtractResult sans `pages`). */
type AnnotationsJson = Omit<ExtractResult, 'pages'>

/** Reconstruct the ExtractResult convert() consumes from the two input files. */
function loadExtractResult(stem: string): ExtractResult {
  const annotations = readJson<AnnotationsJson>(stem, 'annotations.json')
  const pagesJson = readJson<{ pages: Record<string, PageGeom> }>(
    stem,
    'pages.json',
  )
  return { ...annotations, pages: pagesJson.pages }
}

describe('convert() golden parity (no PDF library)', () => {
  // Wrap each dir as a single-element row so `test.each` sees a table of
  // argument tuples (flat string arrays trip strict `tsc` typing).
  test.each(
    GOLDEN_DIRS.map((d) => [d] as const),
  )('%s matches the golden ConvertResult', (stem) => {
    const golden = readJson<ConvertResult>(stem, 'logseq-annotations.json')
    const extractResult = loadExtractResult(stem)

    const result = convert(extractResult, {
      assetUuid: golden.asset_uuid,
      assetTitle: golden.asset_title,
      color: null,
    })

    // Tallies must match the golden exactly.
    expect(result.count).toBe(golden.count)
    expect(result.skipped_links).toBe(golden.skipped_links)
    expect(result.skipped_popups).toBe(golden.skipped_popups)
    expect(result.skipped_unsupported).toEqual(golden.skipped_unsupported)
    expect(result.empty_content).toBe(golden.empty_content)

    // count is the length of records; cross-check the invariant.
    expect(result.records.length).toBe(golden.count)

    // The crux: every converted record (geometry, color, uuid, hl-value, ...)
    // deep-equals the golden, in the golden's order.
    expect(result.records).toEqual(golden.records)
  })

  test('xu dir exercises the peach/cream -> red edge cases', () => {
    // Sanity: this fixture is the one carrying the off-palette colors that must
    // still bucket to `red`. Guards against the fixture set silently shrinking.
    const stem = 'xu-et_al_2025_qwen3-omni_technical_report__pdf-expert'
    const result = convert(loadExtractResult(stem), {
      assetUuid: '11111111-1111-4111-8111-111111111111',
      assetTitle: stem,
      color: null,
    })
    const reds = result.records.filter((r) => r.color_name === 'red')
    const redHexes = reds.map((r) => r.src_color_hex).sort()
    expect(redHexes).toEqual(['#FCF5A4', '#FFCCA1'])
  })
})

describe('convert() forced flat color', () => {
  test("color:'green' forces every record's color to green", () => {
    // Pick a dir with several records of differing source colors.
    const stem = 'xu-et_al_2025_qwen3-omni_technical_report__pdf-expert'
    const extractResult = loadExtractResult(stem)

    const result = convert(extractResult, {
      assetUuid: '11111111-1111-4111-8111-111111111111',
      assetTitle: stem,
      color: 'green',
    })

    expect(result.records.length).toBeGreaterThan(0)
    for (const rec of result.records) {
      expect(rec.color_name).toBe('green')
      expect(rec.color_db_ident).toBe(':logseq.property/color.green')
      expect(rec.hl_color_db_ident).toBe(':logseq.property/color.green')
      expect(rec.hl_value.properties.color).toBe('green')
      // The diagnostic SOURCE color fields are untouched by the override.
    }
    // Forcing color must not change which annots convert nor the tallies.
    const golden = readJson<ConvertResult>(stem, 'logseq-annotations.json')
    expect(result.count).toBe(golden.count)
    expect(result.skipped_links).toBe(golden.skipped_links)
  })

  test('an invalid color throws', () => {
    const extractResult = loadExtractResult(
      'xu-et_al_2025_qwen3-omni_technical_report__pdf-expert',
    )
    expect(() =>
      // @ts-expect-error — "orange" is not a valid ColorName / DB_IDENT key.
      convert(extractResult, { color: 'orange' }),
    ).toThrow()
  })
})

describe('convert() per-category color (colorByType)', () => {
  // This fixture carries all three categories: Underline + Highlight (markup),
  // FreeText (text), and a Text note (note).
  const STEM = 'xu-et_al_2025_qwen3-omni_technical_report__pdf-expert'
  const ASSET = '11111111-1111-4111-8111-111111111111'

  test('forces a color per category; an "auto" (null) category stays inferred', () => {
    const extractResult = loadExtractResult(STEM)
    const baseline = convert(extractResult, {
      assetUuid: ASSET,
      assetTitle: STEM,
    })
    const result = convert(extractResult, {
      assetUuid: ASSET,
      assetTitle: STEM,
      colorByType: { markup: 'green', text: 'blue', note: null },
    })

    const byCat = (cr: ConvertResult, c: string) =>
      cr.records.filter((r) => categoryForSubtype(r.pdf_subtype) === c)

    // All three categories are present, so each assertion below is meaningful.
    expect(byCat(result, 'markup').length).toBeGreaterThan(0)
    expect(byCat(result, 'text').length).toBeGreaterThan(0)
    expect(byCat(result, 'note').length).toBeGreaterThan(0)

    for (const r of byCat(result, 'markup')) expect(r.color_name).toBe('green')
    for (const r of byCat(result, 'text')) expect(r.color_name).toBe('blue')
    // note: null = infer from the source mark, exactly as with no override.
    expect(byCat(result, 'note').map((r) => r.color_name)).toEqual(
      byCat(baseline, 'note').map((r) => r.color_name),
    )
  })

  test('a per-category override wins over the flat color; unset categories fall back', () => {
    const result = convert(loadExtractResult(STEM), {
      assetUuid: ASSET,
      assetTitle: STEM,
      color: 'purple',
      colorByType: { markup: 'green' },
    })
    for (const r of result.records) {
      if (categoryForSubtype(r.pdf_subtype) === 'markup') {
        expect(r.color_name).toBe('green')
      } else {
        expect(r.color_name).toBe('purple')
      }
    }
  })

  test('an invalid colorByType color throws', () => {
    expect(() =>
      convert(loadExtractResult(STEM), {
        // @ts-expect-error — "orange" is not a valid ColorName.
        colorByType: { markup: 'orange' },
      }),
    ).toThrow()
  })
})
