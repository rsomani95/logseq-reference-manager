/**
 * Unit tests for src/geometry.ts — the validated coordinate transform.
 *
 * Expected numbers are derived BY HAND from the formulas in
 * pdf_annot_logseq/geometry.py (the behavioral spec) and the CONTRACT.md.
 * The crucial property tested is the stored-rect <-> viewport round-trip:
 *   scaledToViewport(toStored(...), S, W, H) === [x1*S, y1*S, x2*S, y2*S]
 * exactly (to < 1e-9) at several scales, because width/height carry the page
 * dims so the proportional read-back collapses to fitz_coord * S.
 */

import {
  bounding,
  decodeQuadpoints,
  flipRect,
  pyRound,
  quadRectToFitz,
  quadStoredRects,
  scaledToViewport,
  toStored,
} from './geometry'
import type { StoredRect } from './types'
import { describe, expect, test } from 'bun:test'

describe('pyRound (round-half-to-even)', () => {
  test("explicit half cases round to even (banker's rounding)", () => {
    expect(pyRound(0.5)).toBe(0) // 0 is even, round down
    expect(pyRound(1.5)).toBe(2) // 2 is even, round up
    expect(pyRound(2.5)).toBe(2) // 2 is even, round down
    expect(pyRound(3.5)).toBe(4)
    expect(pyRound(4.5)).toBe(4)
  })

  test('38.6929999 to 3dp -> 38.693 (matches Python round)', () => {
    expect(pyRound(38.6929999, 3)).toBe(38.693)
  })

  test('default ndigits is 0', () => {
    expect(pyRound(2.4)).toBe(2)
    expect(pyRound(2.6)).toBe(3)
    expect(pyRound(2.0)).toBe(2)
  })

  test('non-half values round to nearest (3dp)', () => {
    // 1.23449 -> 1.234 (diff < 0.5 of the 4th place)
    expect(pyRound(1.23449, 3)).toBe(1.234)
    // 1.23451 -> 1.235
    expect(pyRound(1.23451, 3)).toBe(1.235)
  })

  test('negative half-to-even', () => {
    // round(-0.5) = 0 (even), round(-1.5) = -2 (even), round(-2.5) = -2 (even)
    expect(pyRound(-0.5)).toBe(0)
    expect(pyRound(-1.5)).toBe(-2)
    expect(pyRound(-2.5)).toBe(-2)
  })

  test('clean two-digit half-to-even (no binary-rep artifact)', () => {
    // 12.5 -> 12 (even), 37.5 -> 38 (even); these products are exact in binary
    expect(pyRound(0.125, 2)).toBe(0.12)
    expect(pyRound(0.375, 2)).toBe(0.38)
  })

  test('integer inputs pass through', () => {
    expect(pyRound(5, 3)).toBe(5)
    expect(pyRound(0, 0)).toBe(0)
  })
})

describe('decodeQuadpoints', () => {
  test('empty / null / undefined -> []', () => {
    expect(decodeQuadpoints([])).toEqual([])
    expect(decodeQuadpoints(null)).toEqual([])
    expect(decodeQuadpoints(undefined)).toEqual([])
  })

  test('single 8-number quad -> corners + axis-aligned rect_pdf (min/max)', () => {
    // ul=(100,700) ur=(200,700) ll=(100,690) lr=(200,690)
    const qp = [100, 700, 200, 700, 100, 690, 200, 690]
    const quads = decodeQuadpoints(qp)
    expect(quads.length).toBe(1)
    const q = quads[0]!
    expect(q.corners).toEqual({
      ul: [100, 700],
      ur: [200, 700],
      ll: [100, 690],
      lr: [200, 690],
    })
    // xs = [100,200,100,200] -> min 100, max 200
    // ys = [700,700,690,690] -> min 690, max 700  (PDF y-up: y0<y1)
    expect(q.rect_pdf).toEqual([100, 690, 200, 700])
  })

  test('min/max picks extremes across all four corners (skewed quad)', () => {
    // deliberately mix corner coords so simple ul/lr would be wrong
    const qp = [10, 50, 40, 55, 5, 20, 45, 25]
    const q = decodeQuadpoints(qp)[0]!
    // xs = [10,40,5,45] -> 5..45 ; ys = [50,55,20,25] -> 20..55
    expect(q.rect_pdf).toEqual([5, 20, 45, 55])
  })

  test('two quads decode independently', () => {
    const qp = [
      100,
      700,
      200,
      700,
      100,
      690,
      200,
      690, // quad A
      300,
      650,
      400,
      650,
      300,
      640,
      400,
      640, // quad B
    ]
    const quads = decodeQuadpoints(qp)
    expect(quads.length).toBe(2)
    expect(quads[0]!.rect_pdf).toEqual([100, 690, 200, 700])
    expect(quads[1]!.rect_pdf).toEqual([300, 640, 400, 650])
  })

  test('trailing partial quad (< 8 numbers left) is dropped', () => {
    // 8 full + 7 trailing -> only the first quad is produced
    const qp = [100, 700, 200, 700, 100, 690, 200, 690, 1, 2, 3, 4, 5, 6, 7]
    expect(decodeQuadpoints(qp).length).toBe(1)
  })

  test('fewer than 8 numbers -> [] (no full quad)', () => {
    expect(decodeQuadpoints([1, 2, 3, 4, 5, 6, 7])).toEqual([])
  })
})

describe('quadRectToFitz (y-flip about page height)', () => {
  test('[x0, top, x1, bottom] with top=H-y1, bottom=H-y0', () => {
    // rect_pdf = [100, 690, 200, 700] (PDF y-up), pageH = 792
    // top = 792 - 700 = 92 ; bottom = 792 - 690 = 102
    expect(quadRectToFitz([100, 690, 200, 700], 792)).toEqual([
      100, 92, 200, 102,
    ])
  })

  test('x coords are untouched; y mirrored', () => {
    // rect_pdf = [0, 0, 10, 20], pageH = 100 -> top=80, bottom=100
    expect(quadRectToFitz([0, 0, 10, 20], 100)).toEqual([0, 80, 10, 100])
  })
})

describe('flipRect (PDF y-up -> fitz top-left, with cropbox offset)', () => {
  test('no cropbox offset: top=H-y1, bottom=H-y0, x untouched', () => {
    // rect_pdf=[50,100,150,300], pageH=400
    // left=50, right=150, top=400-300=100, bottom=400-100=300
    expect(flipRect([50, 100, 150, 300], 400)).toEqual([50, 100, 150, 300])
  })

  test('with cropbox x-offset cx0 subtracted from left/right (cy0 unused)', () => {
    // cx0=10 subtracted from x; cy0 is a documented no-op in this transform
    // left=50-10=40, right=150-10=140, top=400-300=100, bottom=400-100=300
    expect(flipRect([50, 100, 150, 300], 400, 10, 5)).toEqual([
      40, 100, 140, 300,
    ])
  })

  test('cy0 does NOT affect the y flip (only pageH matters)', () => {
    const withCy = flipRect([50, 100, 150, 300], 400, 0, 999)
    const without = flipRect([50, 100, 150, 300], 400, 0, 0)
    expect(withCy).toEqual(without)
  })
})

describe('toStored (carry width/height; round coords to 3dp)', () => {
  test('rounds x1..y2 to 3dp via pyRound; width/height carried verbatim', () => {
    // fitz rect with >3dp components (chosen to avoid binary-rep half artifacts)
    const stored = toStored(
      [38.6929999, 12.34561, 100.49949, 200.12351],
      612,
      792,
    )
    expect(stored).toEqual({
      x1: 38.693, // round(38.6929999,3)
      y1: 12.346, // round(12.34561,3) -> 4th place 6 -> up
      x2: 100.499, // round(100.49949,3) -> 4th place 4 -> down
      y2: 200.124, // round(200.12351,3) -> 4th place 5 then 1 -> up
      width: 612,
      height: 792,
    })
  })

  test('width/height are NOT rounded (passed through)', () => {
    const stored = toStored([0, 0, 1, 1], 612.123456, 792.987654)
    expect(stored.width).toBe(612.123456)
    expect(stored.height).toBe(792.987654)
  })
})

describe('bounding (union of stored rects; carry width/height from rects[0])', () => {
  test('min x1/y1, max x2/y2; rounded 3dp; dims from first rect', () => {
    const rects: StoredRect[] = [
      { x1: 10, y1: 20, x2: 30, y2: 40, width: 612, height: 792 },
      { x1: 5, y1: 25, x2: 35, y2: 38, width: 612, height: 792 },
      { x1: 8, y1: 18, x2: 28, y2: 50, width: 612, height: 792 },
    ]
    expect(bounding(rects)).toEqual({
      x1: 5, // min(10,5,8)
      y1: 18, // min(20,25,18)
      x2: 35, // max(30,35,28)
      y2: 50, // max(40,38,50)
      width: 612,
      height: 792,
    })
  })

  test('single rect -> itself (rounded)', () => {
    const rects: StoredRect[] = [
      { x1: 1.23449, y1: 2.5, x2: 3.0, y2: 4.0, width: 100, height: 200 },
    ]
    expect(bounding(rects)).toEqual({
      x1: 1.234,
      y1: 2.5,
      x2: 3.0,
      y2: 4.0,
      width: 100,
      height: 200,
    })
  })

  test('width/height carried from rects[0] even if later rects differ', () => {
    const rects: StoredRect[] = [
      { x1: 0, y1: 0, x2: 1, y2: 1, width: 612, height: 792 },
      { x1: 0, y1: 0, x2: 2, y2: 2, width: 100, height: 100 },
    ]
    const b = bounding(rects)
    expect(b.width).toBe(612)
    expect(b.height).toBe(792)
  })
})

describe('quadStoredRects (sort by y1 asc then x1 asc)', () => {
  const W = 612
  const H = 792

  test('each fitz rect -> a stored rect, sorted by (y1, x1)', () => {
    // three fitz rects [left,top,right,bottom]; deliberately out of order
    const fitzRects: [number, number, number, number][] = [
      [50, 100, 150, 120], // y1=100, x1=50
      [30, 50, 130, 70], // y1=50,  x1=30  -> should come first (smallest top)
      [10, 100, 110, 120], // y1=100, x1=10  -> ties y1 with #1, smaller x1 first
    ]
    const out = quadStoredRects(fitzRects, W, H)
    expect(out.length).toBe(3)
    // expected order: (y1=50,x1=30), (y1=100,x1=10), (y1=100,x1=50)
    expect(out.map((r) => [r.y1, r.x1])).toEqual([
      [50, 30],
      [100, 10],
      [100, 50],
    ])
    // first rect content fully derived from toStored
    expect(out[0]).toEqual({
      x1: 30,
      y1: 50,
      x2: 130,
      y2: 70,
      width: W,
      height: H,
    })
  })

  test('stable on equal keys & carries page dims', () => {
    const fitzRects: [number, number, number, number][] = [
      [0, 10, 5, 20],
      [0, 10, 7, 20],
    ]
    const out = quadStoredRects(fitzRects, W, H)
    expect(out.every((r) => r.width === W && r.height === H)).toBe(true)
    expect(out.map((r) => r.x2)).toEqual([5, 7])
  })
})

describe('scaledToViewport (read-back inverse)', () => {
  test('literal formula: vw*coord/dim at scale 2', () => {
    const stored: StoredRect = {
      x1: 10,
      y1: 20,
      x2: 110,
      y2: 220,
      width: 612,
      height: 792,
    }
    // vwW=2*612=1224 ; left = 1224*10/612 = 20
    // vwH=2*792=1584 ; top  = 1584*20/792 = 40
    // right=1224*110/612 = 220 ; bot=1584*220/792 = 440
    expect(scaledToViewport(stored, 2, 612, 792)).toEqual([20, 40, 220, 440])
  })

  test('respects stored.width/height vs page dims independently', () => {
    // stored captured against width=300 but page is 600 wide -> read-back doubles x
    const stored: StoredRect = {
      x1: 10,
      y1: 10,
      x2: 20,
      y2: 20,
      width: 300,
      height: 300,
    }
    // scale 1, page 600x600 -> vwW=600 ; left = 600*10/300 = 20
    expect(scaledToViewport(stored, 1, 600, 600)).toEqual([20, 20, 40, 40])
  })
})

describe('CRUCIAL round-trip: scaledToViewport(toStored(rect)) === coord*S', () => {
  const W = 612
  const H = 792
  // a representative fitz rect (top-left, y-down), e.g. produced by flipRect
  const fitzRects: [number, number, number, number][] = [
    [38.692, 92.001, 200.4, 102.55],
    [0, 0, 612, 792], // full-page extremes
    [123.456, 234.567, 456.789, 567.891],
  ]
  const scales = [0.5, 1, 1.5, 2, 3, 7.25]

  for (const fr of fitzRects) {
    for (const S of scales) {
      test(`rect ${JSON.stringify(fr)} @ scale ${S}`, () => {
        const stored = toStored(fr, W, H)
        // because stored.width===W and stored.height===H, read-back collapses to coord*S
        const got = scaledToViewport(stored, S, W, H)
        const ref: [number, number, number, number] = [
          stored.x1 * S,
          stored.y1 * S,
          stored.x2 * S,
          stored.y2 * S,
        ]
        for (let i = 0; i < 4; i++) {
          expect(Math.abs(got[i]! - ref[i]!)).toBeLessThan(1e-9)
        }
      })
    }
  }

  test('round-trip also holds for a bounding rect', () => {
    const rects: StoredRect[] = fitzRects.map((fr) => toStored(fr, W, H))
    const b = bounding(rects)
    for (const S of scales) {
      const got = scaledToViewport(b, S, W, H)
      const ref = [b.x1 * S, b.y1 * S, b.x2 * S, b.y2 * S]
      for (let i = 0; i < 4; i++) {
        expect(Math.abs(got[i]! - ref[i]!)).toBeLessThan(1e-9)
      }
    }
  })

  test('end-to-end: PDF quad -> decode -> fitz -> stored -> read-back == coord*S', () => {
    // PDF-space quad (y-up), pageH=H
    const qp = [100, 700, 200, 700, 100, 690, 200, 690]
    const quad = decodeQuadpoints(qp)[0]!
    const fr = quadRectToFitz(quad.rect_pdf, H) // [100, 92, 200, 102]
    expect(fr).toEqual([100, 92, 200, 102])
    const stored = toStored(fr, W, H)
    const S = 2
    const got = scaledToViewport(stored, S, W, H)
    expect(got).toEqual([200, 184, 400, 204]) // [100,92,200,102] * 2
  })
})
