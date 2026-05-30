/**
 * Tests for the Zotero-native annotation path (src/zotero.ts, src/uuid.ts).
 *
 * Golden oracle: test/fixtures/zotero/LKXJEQ5S.* — captured from a real Zotero
 * item ("Qwen3-Omni Technical Report - Zotero Annotation Test", attachment
 * LKXJEQ5S, library 5021238) whose 10 annotations were made INSIDE Zotero's PDF
 * reader. `.annotations.json` is the raw ZoteroAnnotationData[]; `.pages.json` is
 * the per-page geometry read from the PDF; `.expected.{json,edn}` is the
 * converter's output. The fixtures make the test hermetic (no live API / PDF).
 *
 * Re-capture after an intentional change with:
 *   bun run src/zotero-cli.ts US99Y3II --capture
 *   cp out/zotero/LKXJEQ5S/{annotations,pages}.json test/fixtures/zotero/LKXJEQ5S.{annotations,pages}.json
 *   cp out/zotero/LKXJEQ5S/logseq-annotations.json test/fixtures/zotero/LKXJEQ5S.expected.json
 *   cp out/zotero/LKXJEQ5S/logseq-annotations.edn  test/fixtures/zotero/LKXJEQ5S.expected.edn
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { DEFAULT_ASSET_UUID } from './convert'
import { emitSelfContainedEdn } from './edn'
import type { ConvertResult, PageGeom } from './types'
import { uuidForZoteroAnnotation, uuidv5 } from './uuid'
import {
  convertZoteroAnnotations,
  parseZoteroPosition,
  type ZoteroAnnotationData,
} from './zotero'
import { describe, expect, test } from 'bun:test'

const FIX = resolve(import.meta.dir, '__fixtures__', 'zotero')
const OUT = resolve(import.meta.dir, '__fixtures__', 'pdf-golden')
// The library the fixtures were captured from; the uuids in the golden were
// derived from (this id, annotationKey), so the golden test pins it.
const LIBRARY_ID = 5021238

const readFix = (name: string) => readFileSync(resolve(FIX, name), 'utf-8')

// A minimal one-page geometry for synthetic unit tests (600×800, no crop offset).
const PM_1PAGE: Record<string, PageGeom> = {
  '0': {
    page_index_0based: 0,
    page_1based: 1,
    fitz_rect: [0, 0, 600, 800],
    width_pt: 600,
    height_pt: 800,
    rotation: 0,
    mediabox: [0, 0, 600, 800],
    cropbox: [0, 0, 600, 800],
    mediabox_origin: [0, 0],
    cropbox_offset_from_mediabox: null,
    n_annots_raw: 0,
  },
}

// ---------------------------------------------------------------------------
// uuid.ts
// ---------------------------------------------------------------------------

describe('uuid', () => {
  test('uuidv5 matches the published RFC-4122 DNS vector (exercises SHA-1)', () => {
    expect(
      uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    ).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
  })

  test('uuidForZoteroAnnotation is deterministic and a valid v5 uuid', () => {
    const a = uuidForZoteroAnnotation(LIBRARY_ID, 'IHJYKJEF')
    expect(uuidForZoteroAnnotation(LIBRARY_ID, 'IHJYKJEF')).toBe(a)
    // version nibble 5, RFC variant (8/9/a/b)
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  test('the comment-suffixed uuid is distinct and stable', () => {
    const base = uuidForZoteroAnnotation(LIBRARY_ID, 'IHJYKJEF')
    const cmt = uuidForZoteroAnnotation(LIBRARY_ID, 'IHJYKJEF', 'comment')
    expect(cmt).not.toBe(base)
    expect(uuidForZoteroAnnotation(LIBRARY_ID, 'IHJYKJEF', 'comment')).toBe(cmt)
  })

  test('different library / key changes the uuid', () => {
    const a = uuidForZoteroAnnotation(LIBRARY_ID, 'IHJYKJEF')
    expect(uuidForZoteroAnnotation(LIBRARY_ID + 1, 'IHJYKJEF')).not.toBe(a)
    expect(uuidForZoteroAnnotation(LIBRARY_ID, 'DIFFERENT')).not.toBe(a)
  })
})

// ---------------------------------------------------------------------------
// parseZoteroPosition
// ---------------------------------------------------------------------------

describe('parseZoteroPosition', () => {
  test('parses a markup position (PDF y-up rects)', () => {
    expect(
      parseZoteroPosition('{"pageIndex":4,"rects":[[1,2,3,4],[5,6,7,8]]}'),
    ).toEqual({
      pageIndex: 4,
      rects: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
    })
  })

  test('carries fontSize / rotation for a text annotation', () => {
    const p = parseZoteroPosition(
      '{"pageIndex":6,"fontSize":6,"rotation":0,"rects":[[10,20,30,40]]}',
    )
    expect(p?.fontSize).toBe(6)
    expect(p?.rotation).toBe(0)
  })

  test('returns null on garbage, missing pageIndex, non-array rects, nullish', () => {
    expect(parseZoteroPosition('not json')).toBeNull()
    expect(parseZoteroPosition('{"rects":[[1,2,3,4]]}')).toBeNull()
    expect(parseZoteroPosition('{"pageIndex":1,"rects":"x"}')).toBeNull()
    expect(parseZoteroPosition(undefined)).toBeNull()
    expect(parseZoteroPosition(null)).toBeNull()
  })

  test('drops malformed rects but keeps well-formed ones', () => {
    expect(
      parseZoteroPosition('{"pageIndex":0,"rects":[[1,2,3],[1,2,3,4],"junk"]}'),
    ).toEqual({ pageIndex: 0, rects: [[1, 2, 3, 4]] })
  })
})

// ---------------------------------------------------------------------------
// convertZoteroAnnotations — type mapping, geometry, skips, comments
// ---------------------------------------------------------------------------

describe('convertZoteroAnnotations (synthetic)', () => {
  test('markup flips PDF y-up rect into Logseq stored space', () => {
    const hl: ZoteroAnnotationData = {
      key: 'HL1',
      annotationType: 'highlight',
      annotationText: 'some highlighted text',
      annotationColor: '#f19837',
      annotationSortIndex: '00000|000000|00000',
      annotationPosition: '{"pageIndex":0,"rects":[[100,700,300,720]]}',
    }
    const r = convertZoteroAnnotations([hl], PM_1PAGE, { libraryID: 1 })
    expect(r.count).toBe(1)
    const rec = r.records[0]!
    // flip about H=800: top = 800-720 = 80, bottom = 800-700 = 100
    expect(rec.hl_value.position.rects[0]).toEqual({
      x1: 100,
      y1: 80,
      x2: 300,
      y2: 100,
      width: 600,
      height: 800,
    })
    expect(rec.block_title).toBe('some highlighted text')
    expect(rec.color_name).toBe('yellow') // #f19837 → nearest Logseq pastel
    expect(rec.uuid).toBe(uuidForZoteroAnnotation(1, 'HL1'))
  })

  test('a markup comment becomes a child block in the EDN', () => {
    const hl: ZoteroAnnotationData = {
      key: 'HL1',
      annotationType: 'underline',
      annotationText: 'underlined text',
      annotationComment: 'my note about it',
      annotationColor: '#f19837',
      annotationSortIndex: '00000|000000|00000',
      annotationPosition: '{"pageIndex":0,"rects":[[100,700,300,720]]}',
    }
    const r = convertZoteroAnnotations([hl], PM_1PAGE, { libraryID: 1 })
    const rec = r.records[0]!
    expect(rec.comment).toBe('my note about it')
    expect(rec.comment_uuid).toBe(uuidForZoteroAnnotation(1, 'HL1', 'comment'))

    const edn = emitSelfContainedEdn(r.records, r.asset_uuid, r.asset_title)
    expect(edn).toContain(':build/children')
    expect(edn).toContain('"my note about it"')
    expect(edn).toContain(uuidForZoteroAnnotation(1, 'HL1', 'comment'))
  })

  test('note/text use the comment as the title and emit no child', () => {
    const note: ZoteroAnnotationData = {
      key: 'N1',
      annotationType: 'note',
      annotationComment: 'sticky text',
      annotationColor: '#ffd400',
      annotationSortIndex: '00000|000001|00000',
      annotationPosition: '{"pageIndex":0,"rects":[[500,700,522,722]]}',
    }
    const r = convertZoteroAnnotations([note], PM_1PAGE, { libraryID: 1 })
    const rec = r.records[0]!
    expect(rec.block_title).toBe('sticky text')
    expect(rec.comment).toBeUndefined()
    expect(rec.comment_uuid).toBeUndefined()
    const edn = emitSelfContainedEdn(r.records, r.asset_uuid, r.asset_title)
    expect(edn).not.toContain(':build/children')
  })

  test('image and ink are skipped with a tally, never crashing', () => {
    const items: ZoteroAnnotationData[] = [
      {
        key: 'IMG1',
        annotationType: 'image',
        annotationSortIndex: '00000|000000|00000',
        annotationPosition: '{"pageIndex":0,"rects":[[1,2,3,4]]}',
      },
      {
        key: 'INK1',
        annotationType: 'ink',
        annotationSortIndex: '00000|000001|00000',
        annotationPosition: '{"pageIndex":0,"paths":[[1,2,3,4]]}',
      },
    ]
    const r = convertZoteroAnnotations(items, PM_1PAGE, { libraryID: 1 })
    expect(r.count).toBe(0)
    expect(r.skipped_unsupported.sort()).toEqual(['image', 'ink'])
  })

  test('--color forces one flat highlight color', () => {
    const hl: ZoteroAnnotationData = {
      key: 'HL1',
      annotationType: 'highlight',
      annotationText: 'x',
      annotationColor: '#f19837',
      annotationSortIndex: '00000|000000|00000',
      annotationPosition: '{"pageIndex":0,"rects":[[100,700,300,720]]}',
    }
    const r = convertZoteroAnnotations([hl], PM_1PAGE, {
      libraryID: 1,
      color: 'blue',
    })
    expect(r.records[0]!.color_name).toBe('blue')
  })

  test('an annotation on a page with no geometry is skipped (not thrown)', () => {
    const hl: ZoteroAnnotationData = {
      key: 'HL1',
      annotationType: 'highlight',
      annotationText: 'x',
      annotationSortIndex: '00000|000000|00000',
      annotationPosition: '{"pageIndex":99,"rects":[[1,2,3,4]]}',
    }
    const r = convertZoteroAnnotations([hl], PM_1PAGE, { libraryID: 1 })
    expect(r.count).toBe(0)
    expect(r.skipped_unsupported).toEqual(['highlight'])
  })
})

// ---------------------------------------------------------------------------
// Golden parity on the captured real item
// ---------------------------------------------------------------------------

describe('convertZoteroAnnotations (golden: LKXJEQ5S, 10 Zotero-native annots)', () => {
  const annots: ZoteroAnnotationData[] = JSON.parse(
    readFix('LKXJEQ5S.annotations.json'),
  )
  const pages: Record<string, PageGeom> = JSON.parse(
    readFix('LKXJEQ5S.pages.json'),
  )
  const expected: ConvertResult = JSON.parse(readFix('LKXJEQ5S.expected.json'))

  const result = convertZoteroAnnotations(annots, pages, {
    assetUuid: expected.asset_uuid,
    assetTitle: expected.asset_title,
    libraryID: LIBRARY_ID,
  })

  test('ConvertResult deep-equals the golden JSON', () => {
    expect(result).toEqual(expected)
  })

  test('EDN deep-equals the golden .edn byte-for-byte', () => {
    expect(
      emitSelfContainedEdn(
        result.records,
        result.asset_uuid,
        result.asset_title,
      ),
    ).toBe(readFix('LKXJEQ5S.expected.edn'))
  })

  test('all 10 convert, in Zotero sortIndex reading order, none skipped', () => {
    expect(result.count).toBe(10)
    expect(result.skipped_unsupported).toEqual([])
    const pages1 = result.records.map((r) => r.page)
    expect(pages1).toEqual([1, 1, 2, 4, 5, 5, 5, 5, 5, 7])
  })
})

// ---------------------------------------------------------------------------
// Cross-path: Zotero geometry agrees with the mupdf-derived PDF-path golden
// ---------------------------------------------------------------------------

describe('cross-path geometry parity', () => {
  test("the 'we fine-tuned…' underline matches the PDF-path golden within ~0.4pt", () => {
    // The same passage is underlined in the PDFExpert fixture (read by mupdf →
    // out/xu-…__pdf-expert) and in Zotero. x1/x2/y2 match to ~3dp; y1 differs by
    // a sub-pixel line-box amount. This ties the two independent pipelines.
    const STEM = 'xu-et_al_2025_qwen3-omni_technical_report__pdf-expert'
    const pdfGold: ConvertResult = JSON.parse(
      readFileSync(resolve(OUT, STEM, 'logseq-annotations.json'), 'utf-8'),
    )
    const zot: ConvertResult = JSON.parse(readFix('LKXJEQ5S.expected.json'))

    const find = (cr: ConvertResult) =>
      cr.records.find((r) => r.block_title.startsWith('we fine-tuned'))!
    const a = find(pdfGold).hl_value.position.bounding
    const b = find(zot).hl_value.position.bounding

    expect(Math.abs(a.x1 - b.x1)).toBeLessThan(0.5)
    expect(Math.abs(a.x2 - b.x2)).toBeLessThan(0.5)
    expect(Math.abs(a.y1 - b.y1)).toBeLessThan(0.5)
    expect(Math.abs(a.y2 - b.y2)).toBeLessThan(0.5)
    expect(a.width).toBe(b.width)
    expect(a.height).toBe(b.height)
  })
})
