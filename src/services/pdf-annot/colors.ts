/**
 * Color helpers and palettes for mapping PDF annotation colors to Logseq's
 * fixed 5-color highlight palette.
 *
 * The RGB anchor values and the nearest-pastel logic are copied VERBATIM from
 * the Python `colors.py`. Logseq highlights use the --color-*-300 PASTEL family
 * (pdf.css:2-6), so matching is against the pastel anchors, NOT saturated hues
 * (matching saturated would misbucket, e.g. orange -> red). Do not "improve"
 * these anchors; they reproduce the validated recon verdict.
 */

import { pyRound } from './geometry'
import type { ColorName, RGB } from './types'

// Logseq's native PDF highlight palette (closed value set), from
// src/main/frontend/extensions/pdf/pdf.css. There is NO orange.
export const LOGSEQ_PALETTE: Record<ColorName, RGB> = {
  yellow: [255, 213, 0], // --color-yellow-300 family
  blue: [96, 165, 250],
  green: [134, 239, 172],
  red: [252, 165, 165],
  purple: [216, 180, 254],
}

// Alias used on the convert side. Same anchors as LOGSEQ_PALETTE (the
// convert.py comment notes "red" is pastel/salmon, NOT (255,0,0)).
export const LOGSEQ_COLORS: Record<ColorName, RGB> = {
  yellow: [255, 213, 0],
  blue: [96, 165, 250],
  green: [134, 239, 172],
  red: [252, 165, 165], // pastel/salmon, NOT (255,0,0)
  purple: [216, 180, 254],
}

export const DB_IDENT: Record<ColorName, string> = {
  yellow: ':logseq.property/color.yellow',
  red: ':logseq.property/color.red',
  green: ':logseq.property/color.green',
  blue: ':logseq.property/color.blue',
  purple: ':logseq.property/color.purple',
}

export const DEFAULT_COLOR: ColorName = 'yellow' // build-annotation-block default (exporter.cljs:1422)

// A broader CSS-ish name table for a human-friendly "nearest name" guess.
export const NAMED_COLORS: Record<string, RGB> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  dark_orange: [255, 140, 0],
  amber: [255, 191, 0],
  gold: [255, 215, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  gray: [128, 128, 128],
}

/**
 * Normalize a PDF color array (0..1 floats) to a 0-255 int triple.
 *
 * Handles gray (1), RGB (3) and CMYK (4) arrays. Returns null for empty/null.
 */
export function to255(arr: number[] | null | undefined): RGB | null {
  if (arr === null || arr === undefined) {
    return null
  }
  const vals = arr.map((x) => Number(x))
  if (vals.length === 0) {
    return null
  }
  if (vals.length === 1) {
    const v0 = vals[0]!
    const g = pyRound(v0 * 255)
    return [g, g, g]
  }
  if (vals.length === 3) {
    return [
      pyRound(vals[0]! * 255),
      pyRound(vals[1]! * 255),
      pyRound(vals[2]! * 255),
    ]
  }
  if (vals.length === 4) {
    const c = vals[0]!
    const m = vals[1]!
    const y = vals[2]!
    const k = vals[3]!
    const r = pyRound(255 * (1 - c) * (1 - k))
    const g = pyRound(255 * (1 - m) * (1 - k))
    const b = pyRound(255 * (1 - y) * (1 - k))
    return [r, g, b]
  }
  // Unknown arity: best-effort first three.
  return [
    pyRound(vals[0]! * 255),
    pyRound(vals[1]! * 255),
    pyRound(vals[2]! * 255),
  ]
}

export function hexOf(rgb: RGB | null): string | null {
  if (rgb === null) {
    return null
  }
  const hh = (n: number): string =>
    n.toString(16).toUpperCase().padStart(2, '0')
  return `#${hh(rgb[0])}${hh(rgb[1])}${hh(rgb[2])}`
}

export function nearestName(
  rgb: RGB | null,
  table: Record<string, RGB> = NAMED_COLORS,
): string | null {
  if (rgb === null) {
    return null
  }
  let best: string | null = null
  let bestd: number | null = null
  for (const [name, ref] of Object.entries(table)) {
    const d =
      (rgb[0] - ref[0]) ** 2 + (rgb[1] - ref[1]) ** 2 + (rgb[2] - ref[2]) ** 2
    if (bestd === null || d < bestd) {
      best = name
      bestd = d
    }
  }
  return best
}

/** Snap to the nearest color in Logseq's fixed 5-color palette. */
export function nearestLogseq(rgb: RGB | null): ColorName | null {
  if (rgb === null) {
    return null
  }
  let best: ColorName | null = null
  let bestd: number | null = null
  for (const name of Object.keys(LOGSEQ_PALETTE) as ColorName[]) {
    const ref = LOGSEQ_PALETTE[name]
    const d =
      (rgb[0] - ref[0]) ** 2 + (rgb[1] - ref[1]) ** 2 + (rgb[2] - ref[2]) ** 2
    if (bestd === null || d < bestd) {
      best = name
      bestd = d
    }
  }
  return best
}

const HEX_RE = /#([0-9a-fA-F]{6})/

/** Pull the first #RRGGBB out of a /DS or /RC style string. */
export function colorFromCss(s: string | null | undefined): RGB | null {
  if (!s) {
    return null
  }
  const m = HEX_RE.exec(String(s))
  if (!m) {
    return null
  }
  const h = m[1]!
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** Nearest pastel Logseq bucket. Returns [name, db_ident_keyword_string]. */
export function mapColor(rgb: RGB | null): [ColorName, string] {
  if (rgb === null) {
    return [DEFAULT_COLOR, DB_IDENT[DEFAULT_COLOR]]
  }
  let name: ColorName | null = null
  let bestd: number | null = null
  for (const n of Object.keys(LOGSEQ_COLORS) as ColorName[]) {
    const ref = LOGSEQ_COLORS[n]
    const d =
      (ref[0] - rgb[0]) ** 2 + (ref[1] - rgb[1]) ** 2 + (ref[2] - rgb[2]) ** 2
    if (bestd === null || d < bestd) {
      name = n
      bestd = d
    }
  }
  const chosen = name!
  return [chosen, DB_IDENT[chosen]]
}
