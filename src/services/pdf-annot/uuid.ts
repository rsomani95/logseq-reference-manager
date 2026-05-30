/**
 * uuid.ts — deterministic RFC-4122 v5 UUIDs.
 *
 * Why this exists: a Logseq PDF annotation block is keyed by `:block/uuid` with
 * `:build/keep-uuid? true`, which is what makes re-import idempotent (see
 * docs/importing-into-logseq.md §1). For the PDF path, convert.ts reuses the
 * annotation's `/NM` (already a UUID) as that key. Zotero annotations instead
 * carry an 8-char item `key` (e.g. "IHJYKJEF"), not a UUID — so we derive a
 * STABLE UUID from `(libraryID, key)`. v5 (name-based, SHA-1) gives us exactly
 * that: same Zotero annotation → same Logseq uuid on every sync, so re-syncing
 * upserts instead of duplicating.
 *
 * Self-contained on purpose: this runs in the Logseq plugin's Electron renderer
 * as well as bun/node, so we avoid `node:crypto` (absent in a browser context)
 * and the async `crypto.subtle` (would force the converter to be async). The
 * vendored SHA-1 below is the standard algorithm; it's covered by a known-answer
 * test (sha1("abc") and a published v5 vector) in test/zotero.test.ts.
 */

/** SHA-1 of a byte array → 20-byte digest. Standard FIPS-180 implementation. */
function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length * 8
  // pad: 0x80, then zeros until (len % 64 === 56), then 64-bit big-endian bit length
  const withOne = bytes.length + 1
  const padLen = (56 - (withOne % 64) + 64) % 64
  const total = withOne + padLen + 8
  const msg = new Uint8Array(total)
  msg.set(bytes, 0)
  msg[bytes.length] = 0x80
  const dv = new DataView(msg.buffer)
  // bit length as 64-bit big-endian (inputs are tiny, but split hi/lo correctly)
  dv.setUint32(total - 8, Math.floor(ml / 0x100000000), false)
  dv.setUint32(total - 4, ml >>> 0, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const w = new Uint32Array(80)
  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false)
    for (let j = 16; j < 80; j++) {
      const v = w[j - 3]! ^ w[j - 8]! ^ w[j - 14]! ^ w[j - 16]!
      w[j] = (v << 1) | (v >>> 31)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let j = 0; j < 80; j++) {
      let f: number
      let k: number
      if (j < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (j < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      // terms are 32-bit ints; their sum stays < 2^53 (exact in a double),
      // then >>>0 reduces mod 2^32. Signs of intermediates are irrelevant.
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]!) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = t
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  const odv = new DataView(out.buffer)
  odv.setUint32(0, h0, false)
  odv.setUint32(4, h1, false)
  odv.setUint32(8, h2, false)
  odv.setUint32(12, h3, false)
  odv.setUint32(16, h4, false)
  return out
}

/** Parse a UUID string into its 16 bytes (hyphens ignored). */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(`invalid namespace UUID: ${JSON.stringify(uuid)}`)
  }
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Format 16 bytes as a canonical lowercase 8-4-4-4-12 UUID string. */
function bytesToUuid(b: Uint8Array): string {
  const h: string[] = []
  for (let i = 0; i < 16; i++) h.push(b[i]!.toString(16).padStart(2, '0'))
  return (
    h.slice(0, 4).join('') +
    '-' +
    h.slice(4, 6).join('') +
    '-' +
    h.slice(6, 8).join('') +
    '-' +
    h.slice(8, 10).join('') +
    '-' +
    h.slice(10, 16).join('')
  )
}

/**
 * RFC-4122 v5 (SHA-1, name-based) UUID. `namespace` is a UUID string; `name` is
 * any UTF-8 string. Deterministic: identical inputs always yield the same UUID.
 */
export function uuidv5(name: string, namespace: string): string {
  const ns = uuidToBytes(namespace)
  const nm = new TextEncoder().encode(name)
  const input = new Uint8Array(ns.length + nm.length)
  input.set(ns, 0)
  input.set(nm, ns.length)
  const hash = sha1(input)
  const out = hash.slice(0, 16)
  out[6] = (out[6]! & 0x0f) | 0x50 // version 5
  out[8] = (out[8]! & 0x3f) | 0x80 // RFC variant
  return bytesToUuid(out)
}

// Fixed namespace for pdf-annot-logseq Zotero annotations. Arbitrary but
// constant — changing it would re-key every block, breaking idempotency.
export const ZOTERO_ANNOTATION_NAMESPACE =
  '7a1f6b2c-9d8e-4c3a-b5f0-1e2d3c4b5a69'

/**
 * Stable Logseq block uuid for a Zotero annotation. Keyed by library + the
 * annotation's item key (unique within a library). `suffix` derives a related
 * but distinct uuid from the same annotation — used for the child commentary
 * block (suffix "comment") so it, too, is idempotent across syncs.
 */
export function uuidForZoteroAnnotation(
  libraryID: number | string,
  annotationKey: string,
  suffix = '',
): string {
  const name = `${libraryID}/${annotationKey}${suffix ? `/${suffix}` : ''}`
  return uuidv5(name, ZOTERO_ANNOTATION_NAMESPACE)
}
