/**
 * Unit tests for src/colors.ts — the PDF-color -> Logseq-palette mapping layer.
 *
 * Behavioral spec: pdf_annot_logseq/colors.py.
 * Golden oracle for the documented edge cases (cream #FCF5A4 / peach #FFCCA1 ->
 * red): out/xu-et_al_2025_qwen3-omni_technical_report/logseq-annotations.json.
 */

import {
  colorFromCss,
  DB_IDENT,
  DEFAULT_COLOR,
  hexOf,
  mapColor,
  nearestLogseq,
  nearestName,
  to255,
} from './colors'
import { describe, expect, test } from 'bun:test'

describe('to255', () => {
  test('gray (1 value) [0.5] -> (128,128,128)', () => {
    // Python round(0.5*255) = round(127.5) = 128 (round-half-to-even: 128 is even).
    expect(to255([0.5])).toEqual([128, 128, 128])
  })

  test('rgb (3 values) [1, 0.5, 0] -> (255,128,0)', () => {
    expect(to255([1, 0.5, 0])).toEqual([255, 128, 0])
  })

  test('cmyk (4 values) -> deviced-to-rgb conversion', () => {
    // r = round(255*(1-c)*(1-k)); g = round(255*(1-m)*(1-k)); b = round(255*(1-y)*(1-k))
    // pure cyan: c=1 => r=0, g=255, b=255
    expect(to255([1, 0, 0, 0])).toEqual([0, 255, 255])
    // pure magenta: m=1 => r=255, g=0, b=255
    expect(to255([0, 1, 0, 0])).toEqual([255, 0, 255])
    // pure yellow: y=1 => r=255, g=255, b=0
    expect(to255([0, 0, 1, 0])).toEqual([255, 255, 0])
    // pure black: k=1 => (0,0,0)
    expect(to255([0, 0, 0, 1])).toEqual([0, 0, 0])
    // no ink: (255,255,255)
    expect(to255([0, 0, 0, 0])).toEqual([255, 255, 255])
    // mixed: c=0.5,m=0.25,y=0,k=0.2 -> r=round(255*0.5*0.8)=102, g=round(255*0.75*0.8)=153, b=round(255*1*0.8)=204
    expect(to255([0.5, 0.25, 0, 0.2])).toEqual([102, 153, 204])
  })

  test('empty array -> null', () => {
    expect(to255([])).toBeNull()
  })

  test('null -> null', () => {
    expect(to255(null)).toBeNull()
  })

  test('undefined -> null', () => {
    expect(to255(undefined)).toBeNull()
  })
})

describe('hexOf', () => {
  test('(255,128,0) -> #FF8000 (uppercase, zero-padded)', () => {
    expect(hexOf([255, 128, 0])).toBe('#FF8000')
  })

  test('(0,0,0) -> #000000', () => {
    expect(hexOf([0, 0, 0])).toBe('#000000')
  })

  test('(252,245,164) -> #FCF5A4 (cream golden hex)', () => {
    expect(hexOf([252, 245, 164])).toBe('#FCF5A4')
  })

  test('null -> null', () => {
    expect(hexOf(null)).toBeNull()
  })
})

describe('colorFromCss', () => {
  test("'color: #FF9300' -> (255,147,0)", () => {
    expect(colorFromCss('...color: #FF9300')).toEqual([255, 147, 0])
  })

  test('lowercase hex is accepted', () => {
    expect(colorFromCss('color:#ff8000;')).toEqual([255, 128, 0])
  })

  test('string with no #RRGGBB -> null', () => {
    expect(colorFromCss('color: rgb(255,147,0)')).toBeNull()
  })

  test('empty string -> null', () => {
    expect(colorFromCss('')).toBeNull()
  })

  test('null -> null', () => {
    expect(colorFromCss(null)).toBeNull()
  })

  test('undefined -> null', () => {
    expect(colorFromCss(undefined)).toBeNull()
  })

  test('picks the FIRST #RRGGBB in the string', () => {
    expect(colorFromCss('a #010203 then #FFFFFF')).toEqual([1, 2, 3])
  })
})

describe('mapColor', () => {
  test('orange (255,128,0) -> yellow (orange maps to yellow per validated pastel logic)', () => {
    expect(mapColor([255, 128, 0])).toEqual([
      'yellow',
      ':logseq.property/color.yellow',
    ])
  })

  test('orange (255,147,0) #FF9300 -> yellow', () => {
    expect(mapColor([255, 147, 0])).toEqual([
      'yellow',
      ':logseq.property/color.yellow',
    ])
  })

  // Documented edge cases verified against the golden
  // out/xu-et_al_2025_qwen3-omni_technical_report/logseq-annotations.json:
  // #FCF5A4 and #FFCCA1 both bucket to "red", NOT yellow/green.
  test('cream #FCF5A4 (252,245,164) -> red (golden edge case)', () => {
    expect(mapColor([252, 245, 164])).toEqual([
      'red',
      ':logseq.property/color.red',
    ])
  })

  test('peach #FFCCA1 (255,204,161) -> red (golden edge case)', () => {
    expect(mapColor([255, 204, 161])).toEqual([
      'red',
      ':logseq.property/color.red',
    ])
  })

  test('null -> [DEFAULT_COLOR, ident] = [yellow, :logseq.property/color.yellow]', () => {
    expect(mapColor(null)).toEqual([DEFAULT_COLOR, DB_IDENT[DEFAULT_COLOR]])
    expect(mapColor(null)).toEqual(['yellow', ':logseq.property/color.yellow'])
  })

  test('exact palette anchors snap to themselves', () => {
    expect(mapColor([255, 213, 0])[0]).toBe('yellow')
    expect(mapColor([96, 165, 250])[0]).toBe('blue')
    expect(mapColor([134, 239, 172])[0]).toBe('green')
    expect(mapColor([252, 165, 165])[0]).toBe('red')
    expect(mapColor([216, 180, 254])[0]).toBe('purple')
  })

  test('second element is always the DB ident matching the name', () => {
    const [name, ident] = mapColor([216, 180, 254])
    expect(ident).toBe(DB_IDENT[name])
  })
})

describe('nearestLogseq', () => {
  test('null -> null', () => {
    expect(nearestLogseq(null)).toBeNull()
  })

  test('exact anchors snap to their own name', () => {
    expect(nearestLogseq([255, 213, 0])).toBe('yellow')
    expect(nearestLogseq([96, 165, 250])).toBe('blue')
    expect(nearestLogseq([134, 239, 172])).toBe('green')
    expect(nearestLogseq([252, 165, 165])).toBe('red')
    expect(nearestLogseq([216, 180, 254])).toBe('purple')
  })

  test('near-anchor colors snap to the closest anchor', () => {
    // slightly perturbed yellow -> still yellow
    expect(nearestLogseq([250, 210, 5])).toBe('yellow')
    // peach maps to red here too (consistent with mapColor's anchors)
    expect(nearestLogseq([255, 204, 161])).toBe('red')
  })
})

describe('nearestName (broad CSS-ish table)', () => {
  test('null -> null', () => {
    expect(nearestName(null)).toBeNull()
  })

  test('exact orange -> orange', () => {
    expect(nearestName([255, 165, 0])).toBe('orange')
  })

  test('pure black/white sanity', () => {
    expect(nearestName([0, 0, 0])).toBe('black')
    expect(nearestName([255, 255, 255])).toBe('white')
  })
})
