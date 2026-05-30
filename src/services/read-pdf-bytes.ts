/**
 * Read a PDF attachment's raw bytes for mupdf (annotation extraction + page
 * geometry). Zotero's local API only 302-redirects to a `file://` URL — it never
 * streams the bytes (see `../../dev_notes/ZOTERO_ATTACHMENT_PATHS.md`) — so we
 * read the file directly from its on-disk path.
 *
 * Whether a Logseq plugin iframe may read a `file://` URL is environment
 * dependent, so we try `fetch()` first and fall back to `XMLHttpRequest` (which
 * is sometimes permitted where `fetch` is not), surfacing a clear error if
 * neither works.
 */

/**
 * Build a percent-encoded `file://` URL from an absolute path. Encode per
 * segment (so `/` separators stay literal) — the inverse of the per-segment
 * decode the plugin uses to recover paths from Zotero's enclosure URLs.
 */
const pathToFileUrl = (absPath: string): string =>
  `file://${absPath.split('/').map(encodeURIComponent).join('/')}`

const fetchBytes = async (url: string): Promise<Uint8Array | null> => {
  try {
    const res = await fetch(url)
    // A file:// fetch can resolve with status 0 (opaque) yet still carry a body.
    if (res.ok || res.status === 0) {
      const buf = await res.arrayBuffer()
      if (buf.byteLength > 0) return new Uint8Array(buf)
    }
  } catch {
    // fall through to XHR
  }
  return null
}

const xhrBytes = (url: string): Promise<Uint8Array | null> =>
  new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', url, true)
      xhr.responseType = 'arraybuffer'
      xhr.onload = () => {
        const ok = xhr.status === 200 || xhr.status === 0
        const buf = xhr.response as ArrayBuffer | null
        resolve(ok && buf && buf.byteLength > 0 ? new Uint8Array(buf) : null)
      }
      xhr.onerror = () => resolve(null)
      xhr.send()
    } catch {
      resolve(null)
    }
  })

/**
 * Read the bytes of the PDF at `absPath`. Throws if the iframe can't read the
 * local file by either transport.
 */
export const readPdfBytes = async (absPath: string): Promise<Uint8Array> => {
  const url = pathToFileUrl(absPath)
  const viaFetch = await fetchBytes(url)
  if (viaFetch) return viaFetch
  const viaXhr = await xhrBytes(url)
  if (viaXhr) return viaXhr
  throw new Error(
    `Couldn't read the PDF at ${absPath}. The plugin may not be permitted to read local file:// URLs in this environment.`,
  )
}
