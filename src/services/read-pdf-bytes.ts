/**
 * Read a PDF attachment's raw bytes for mupdf (annotation extraction + page
 * geometry). Zotero's local API only 302-redirects to a `file://` URL — it never
 * streams the bytes (see `../../dev-notes/zotero-attachment-paths.md`) — so we
 * read the file directly from its on-disk path.
 *
 * As of Logseq 2.0.1-alpha nightly 20260612 the desktop renderer loads from
 * `lsp://logseq.com` instead of `file://` (and unpacked/external plugins are
 * rewritten under `lsp://…/external/…`), so the renderer process no longer holds
 * `file://` load privilege: `fetch`/XHR of a `file://` URL fails with Chromium's
 * "Not allowed to load local resource". The same Logseq commit made the
 * `assets://` scheme privileged + CORS-enabled + streamable, and its protocol
 * handler serves ANY absolute path — so we read through `assets://` there. We
 * cascade across three transports so old and new builds both work:
 *   1. assets:// fetch  — Logseq ≥ 20260612 (privileged scheme; clean, 200 response)
 *   2. main-process IPC — `readFileRaw` over the api:call bridge; works old AND new
 *   3. file:// fetch/XHR — Logseq ≤ 20260527 (renderer still holds a file:// origin)
 * Full root-cause + channel analysis in `../../dev-notes/debugging/reading-local-files.md`.
 */

/**
 * Per-segment percent-encode an absolute path into a URL for the given scheme.
 * Encoding per segment keeps `/` separators literal; the host protocol handlers
 * do exactly one whole-string `decodeURIComponent`, so spaces (incl. a double
 * space), `~`, and unicode round-trip. A UNIX absolute path (leading `/`) yields
 * the required triple slash, e.g. `assets:///Users/…` — two slashes would parse
 * the first segment as the URL host and mis-route.
 */
const pathToUrl = (scheme: 'file' | 'assets', absPath: string): string =>
  `${scheme}://${absPath.split('/').map(encodeURIComponent).join('/')}`

const fetchBytes = async (url: string): Promise<Uint8Array | null> => {
  try {
    const res = await fetch(url)
    // A file:// fetch can resolve with status 0 (opaque) yet still carry a body;
    // assets:// is a normal 200 from a secure + corsEnabled scheme.
    if (res.ok || res.status === 0) {
      const buf = await res.arrayBuffer()
      if (buf.byteLength > 0) return new Uint8Array(buf)
    }
  } catch {
    // fall through to the next transport
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

/** fetch → XHR for one URL (both are true binary reads via arraybuffer). */
const readViaUrl = async (url: string): Promise<Uint8Array | null> =>
  (await fetchBytes(url)) ?? (await xhrBytes(url))

/** Normalize whatever the IPC bridge returns into bytes. */
const toBytes = (v: unknown): Uint8Array | null => {
  if (v instanceof Uint8Array) return v.byteLength ? v : null
  if (v instanceof ArrayBuffer) return v.byteLength ? new Uint8Array(v) : null
  // `Buffer.toJSON()` shape, in case the value crossed a JSON boundary.
  const data = (v as { data?: unknown } | null)?.data
  if (Array.isArray(data)) {
    const u8 = Uint8Array.from(data as number[])
    return u8.byteLength ? u8 : null
  }
  if (Array.isArray(v)) {
    const u8 = Uint8Array.from(v as number[])
    return u8.byteLength ? u8 : null
  }
  return null
}

/**
 * Read the file in Logseq's main process via `readFileRaw`, over the same
 * `api:call` postMessage bridge `@benjypng/logseq-request` rides for
 * `exper_request`. Pass the RAW absolute path (NOT a URL, NOT percent-encoded) —
 * `fs.readFileSync` consumes it verbatim. The trailing `'js-obj'` marker is
 * load-bearing: it forces the raw-Buffer return instead of a transit encode that
 * can't carry a Buffer. Works on both old and new Logseq. Best-effort.
 */
const ipcReadBytes = async (absPath: string): Promise<Uint8Array | null> => {
  try {
    // Private SDK bridge (underscore method) — the same one exper_request rides.
    const anyLogseq = logseq as unknown as {
      _execCallableAPIAsync?: (
        method: string,
        args: unknown[],
      ) => Promise<unknown>
    }
    const raw = await anyLogseq._execCallableAPIAsync?.('doAction', [
      'readFileRaw',
      absPath,
      'js-obj',
    ])
    return toBytes(raw)
  } catch {
    return null
  }
}

/**
 * Read the bytes of the PDF at `absPath`, cascading transports so the read works
 * across Logseq builds (see the module header). Throws only if all three fail.
 */
export const readPdfBytes = async (absPath: string): Promise<Uint8Array> => {
  // 1. assets:// — the privileged scheme on Logseq ≥ 20260612 (a clean 200; no
  //    "Not allowed to load local resource" console noise the file:// path emits).
  const viaAssets = await readViaUrl(pathToUrl('assets', absPath))
  if (viaAssets) return viaAssets

  // 2. main-process IPC — cross-version, and dodges the file:// origin gate.
  const viaIpc = await ipcReadBytes(absPath)
  if (viaIpc) return viaIpc

  // 3. file:// — the original path; still works on Logseq ≤ 20260527.
  const viaFile = await readViaUrl(pathToUrl('file', absPath))
  if (viaFile) return viaFile

  throw new Error(
    `Couldn't read the PDF at ${absPath}. The plugin may not be permitted to read this file in the current Logseq build.`,
  )
}
