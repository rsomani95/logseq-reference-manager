/**
 * Helpers for the `:logseq.property.asset/external-url` value the plugin writes on
 * PDF asset blocks. The stored form is a BARE on-disk path — Logseq's own
 * `<make-asset-url` prepends the build-correct scheme when the viewer opens it
 * (`file:` on older builds, `assets:` since nightly `20260612`, which moved the
 * renderer to `lsp://` and can no longer load `file://`). See
 * `../../dev-notes/debugging/reading-local-files.md`. Older imports (and Logseq
 * itself, historically) may hold a scheme-qualified URL, so readers tolerate both.
 */

/**
 * An asset `external-url` value back to its absolute on-disk path. Handles every
 * shape that may coexist in a graph: a **bare path** (current emit — returned
 * verbatim, its characters are already literal), a legacy per-segment-encoded
 * **`file://`** URL (pages imported before the `20260612` fix), and **`assets://`**.
 * A scheme-qualified value is per-segment decoded.
 */
export const externalUrlToPath = (url: string): string => {
  if (!/^(file|assets):\/\//.test(url)) return url // already a bare path
  return url
    .replace(/^(file|assets):\/\//, '')
    .split('/')
    .map(decodeURIComponent)
    .join('/')
}

/**
 * SHA-256 hex digest of a string. The asset `checksum` property is derived from
 * the `external-url`, so it's recomputed whenever that value changes.
 */
export const sha256Hex = async (s: string): Promise<string> => {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
