/**
 * Unit + golden tests for src/edn.ts — the EDN serializers for the Logseq
 * sqlite.build import payload.
 *
 * Behavioral spec: the EDN serializers in pdf_annot_logseq/convert.py
 * (edn_str, edn_num, edn_rect, edn_hl_value, edn_annotation_block,
 * emit_self_contained_edn, _empty_edn) and pdf_annot_logseq/live.py
 * (_block, emit_live_edn).
 *
 * Golden oracle:
 *   out/xu-…__pdf-expert/logseq-annotations.{json,edn} — emitSelfContainedEdn
 *   out/zero_annot/logseq-annotations.edn         — emptyEdn
 *   out/bai-et_al_2025_qwen2/{logseq-annotations.json,import-live.edn} — emitLiveEdn
 *
 * Python's single `edn_num` relied on int-vs-float typing; the TS port splits it
 * into ednFloat (rect coords / page dims, always keeps a decimal point) and
 * ednInt (:page / :hl-page, stays an int).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ednFloat,
  ednHlValue,
  ednInt,
  ednRect,
  ednStr,
  emitSelfContainedEdn,
  emptyEdn,
} from './edn'
import type { ConvertResult, HlValue, StoredRect } from './types'
import { describe, expect, test } from 'bun:test'

const OUT = resolve(import.meta.dir, '__fixtures__/pdf-golden')

describe('ednFloat', () => {
  test('integral 612 -> "612.0"', () => {
    expect(ednFloat(612)).toBe('612.0')
  })

  test('non-integral 466.138 -> "466.138"', () => {
    expect(ednFloat(466.138)).toBe('466.138')
  })

  test('integral 70 -> "70.0"', () => {
    expect(ednFloat(70)).toBe('70.0')
  })

  test('a value with a non-trivial repr round-trips like Python', () => {
    // 595.276 stored as an f32-ish double round-trips to its shortest decimal in
    // both Python repr() and JS Number.prototype.toString().
    expect(ednFloat(595.2760009765625)).toBe('595.2760009765625')
    expect(ednFloat(841.8900146484375)).toBe('841.8900146484375')
  })

  test('an integral value carried as N.0 from JSON renders as N.0', () => {
    // JSON.parse("792.0") === 792 in JS; ednFloat must still emit "792.0".
    expect(ednFloat(JSON.parse('792.0'))).toBe('792.0')
  })
})

describe('ednInt', () => {
  test('3 -> "3"', () => {
    expect(ednInt(3)).toBe('3')
  })

  test('0 -> "0"', () => {
    expect(ednInt(0)).toBe('0')
  })

  test('10 -> "10" (no decimal point, unlike ednFloat)', () => {
    expect(ednInt(10)).toBe('10')
    expect(ednFloat(10)).toBe('10.0')
  })
})

describe('ednStr', () => {
  test('plain string is wrapped in double-quotes', () => {
    expect(ednStr('hello')).toBe('"hello"')
  })

  test('escapes a backslash (\\ -> \\\\)', () => {
    expect(ednStr('a\\b')).toBe('"a\\\\b"')
  })

  test('escapes a double-quote (" -> \\")', () => {
    expect(ednStr('say "hi"')).toBe('"say \\"hi\\""')
  })

  test('escapes backslash BEFORE quote (order matters)', () => {
    // Python: s.replace("\\","\\\\").replace('"','\\"').
    // Input: backslash then quote -> \\ then \" .
    expect(ednStr('\\"')).toBe('"\\\\\\""')
  })

  test('does NOT escape a newline (left literal, matching the goldens)', () => {
    expect(ednStr('a\nb')).toBe('"a\nb"')
  })
})

describe('ednRect', () => {
  test('renders all six fields via ednFloat in fixed order', () => {
    const r: StoredRect = {
      x1: 466.138,
      y1: 38.693,
      x2: 594.304,
      y2: 58.693,
      width: 612,
      height: 792,
    }
    expect(ednRect(r)).toBe(
      '{:x1 466.138 :y1 38.693 :x2 594.304 :y2 58.693 :width 612.0 :height 792.0}',
    )
  })
})

describe('ednHlValue', () => {
  test('renders id/page/position/content/properties in spec shape', () => {
    const hv: HlValue = {
      id: 'c87aaf96-2c53-4671-8928-a66e180fd257',
      page: 3,
      position: {
        page: 3,
        bounding: {
          x1: 466.138,
          y1: 38.693,
          x2: 594.304,
          y2: 58.693,
          width: 612,
          height: 792,
        },
        rects: [
          {
            x1: 466.138,
            y1: 38.693,
            x2: 594.304,
            y2: 58.693,
            width: 612,
            height: 792,
          },
        ],
      },
      content: { text: 'Is edit distance a common metric in OCR systems?' },
      properties: { color: 'yellow' },
    }
    // :id uses #uuid + ednStr; :page / :position :page use ednInt (no decimal);
    // bounding/rects use ednRect (ednFloat); content/properties via ednStr.
    expect(ednHlValue(hv)).toBe(
      '{:id #uuid "c87aaf96-2c53-4671-8928-a66e180fd257"' +
        ' :page 3' +
        ' :position {:page 3' +
        ' :bounding {:x1 466.138 :y1 38.693 :x2 594.304 :y2 58.693 :width 612.0 :height 792.0}' +
        ' :rects [{:x1 466.138 :y1 38.693 :x2 594.304 :y2 58.693 :width 612.0 :height 792.0}]}' +
        ' :content {:text "Is edit distance a common metric in OCR systems?"}' +
        ' :properties {:color "yellow"}}',
    )
  })
})

describe('emptyEdn (literal no-op payload)', () => {
  // ported: asserts against the literal constant string instead of reading
  // out/zero_annot/logseq-annotations.edn — fixture zero_annot not vendored
  // (regenerate from source PDF to re-enable the file-backed golden). emptyEdn()
  // returns a fixed literal, so this is the equivalent file-free check.
  test('equals the canonical empty import payload byte-for-byte', () => {
    expect(emptyEdn()).toBe(
      '{:pages-and-blocks [] :properties {} :classes {}}\n',
    )
  })
})

describe('emitSelfContainedEdn (golden parity with out/xu __pdf-expert)', () => {
  test('equals out/xu-…__pdf-expert/logseq-annotations.edn byte-for-byte', () => {
    const STEM = 'xu-et_al_2025_qwen3-omni_technical_report__pdf-expert'
    const cr: ConvertResult = JSON.parse(
      readFileSync(`${OUT}/${STEM}/logseq-annotations.json`, 'utf-8'),
    )
    const golden = readFileSync(
      `${OUT}/${STEM}/logseq-annotations.edn`,
      'utf-8',
    )
    const out = emitSelfContainedEdn(cr.records, cr.asset_uuid, cr.asset_title)
    expect(out).toBe(golden)
  })
})

// ported: dropped — describe('emitLiveEdn (golden parity with
// out/bai-et_al_2025_qwen2/import-live.edn)') and its emitLiveEdn import; fixture
// bai-et_al_2025_qwen2 not vendored (regenerate from source PDF to re-enable).
