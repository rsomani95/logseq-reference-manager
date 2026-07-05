# Reading local PDF bytes broke on Logseq ≥ nightly.20260612

**Status:** root cause diagnosed against Logseq source (both nightlies); plugin-only fix implemented in `src/services/read-pdf-bytes.ts` as a 3-transport cascade. **Live-confirm the winning channel once per install** with the snippet below before trusting it in the wild.
**Symptom:** `Zotero: Sync annotations` fails; console shows `Not allowed to load local resource: file:///…` at `read-pdf-bytes.ts` (both the `fetch` and the `XMLHttpRequest` line), then `[annotations] sync failed for …: Couldn't read the PDF at …`. Happens even with the plugin **loaded unpacked** — it is not a marketplace-only sandbox issue.

## Root cause — a Logseq change, not a plugin bug

The plugin reads a Zotero attachment's bytes for mupdf by resolving its absolute on-disk path and doing `fetch('file://…')` / XHR. That worked until Logseq **nightly 20260527** and broke on **nightly 20260612**.

The operative change is in Logseq's Electron main process — `src/electron/electron/window.cljs` (commit `80aeb07d1c`):

```clojure
;; MAIN_WINDOW_ENTRY, production (non-dev) branch:
;; WORK  (d921807274, 0527):  (str "file://" (node-path/join js/__dirname "index.html"))
;; BROKE (80aeb07d1c, 0612):  "lsp://logseq.com/index.html"
;;   comment: "keeps the parent origin non-opaque for plugin iframe postMessage handshakes"
```

**Chromium mechanism.** `file:` is a *local* scheme. Blink lets a document load a `file:` URL only if the requesting document's own origin may load local resources — true only for a document that is itself `file:` (or explicitly granted). Separately, the browser process grants a *renderer process* `file:` access based on the top-level URL it commits. At 0527 the renderer committed `file://…/index.html`, so the whole process (including the plugin iframe) could read `file:` URLs. At 0612 it commits `lsp://logseq.com` — a `standard` + `secure` + `bypassCSP` + `corsEnabled` custom scheme, none of which is *local* — so the `file:` privilege is never granted and every `file:` subresource load is refused. `:webSecurity` is `(not dev?)` = **true in production** at both refs (`window.cljs`), so the gate is enforced.

**Why unpacked also breaks.** The SDK loader changed too: at 0527 a non-dotroot (unpacked) plugin's iframe ran at bare `file://` (`LSPlugin.core.ts` `_resolveResourceFullUrl`). At 0612 the external branch rewrites the entry to `lsp://logseq.com/external/<encodeURIComponent(localRoot)>/dist/index.html` (`LSPlugin.core.ts` `convertToExternalLSPResource`; `common.ts`). So even unpacked, the plugin now runs at an `lsp://` origin — the "load unpacked to get a `file://` iframe" escape hatch is gone. Either change alone is sufficient.

No Electron/Chromium version bump is involved (the in-range `package.json`/lockfile diff moves only JS deps).

## The fix — a 3-transport cascade (plugin-only, no Logseq change)

The *same* 0612 commit made the **`assets://` scheme** privileged: `registerSchemesAsPrivileged` now gives it `{standard secure bypassCSP corsEnabled supportFetchAPI stream}` (`core.cljs`), and its `registerFileProtocol` handler serves **any** absolute path — it strips `assets://`, does one `decodeURIComponent`, and if the remainder starts with `/` (or `/[A-Za-z]:`) calls back `{:path path}` directly, with **no graph-dir scoping** (`core.cljs`). This is the exact cross-origin read Logseq's own PDF viewer performs (`pdfjsLib.getDocument {:url <assets-url>}`).

`read-pdf-bytes.ts` tries, in order:

| # | Transport | How | Works on 0527 | Works on 0612 | Notes |
|---|-----------|-----|:---:|:---:|-------|
| 1 | `assets://` fetch/XHR | privileged scheme → `arrayBuffer` | ✗ (was `supportFetchAPI:false`) | ✓ | clean 200; no console noise |
| 2 | main-process IPC | `_execCallableAPIAsync('doAction', ['readFileRaw', absPath, 'js-obj'])` | ✓ | ✓ | cross-version safety net |
| 3 | `file://` fetch/XHR | original path | ✓ | ✗ | last resort for old builds |

**IPC channel details.** It rides the same `api:call` postMessage bridge `@benjypng/logseq-request` already uses live for `exper_request`, reaching `window.apis.doAction` → `ipcRenderer.invoke('main', …)` → `:readFileRaw` = `fs.readFileSync(path)` verbatim (`handler.cljs`, `utils.cljs`). Pass the **raw** absolute path (no `file://`, no percent-encoding, no NFC) — `readFileSync` consumes it verbatim, so spaces / double-space / `~` / unicode round-trip. The trailing **`'js-obj'` marker is load-bearing**: it forces the raw-Buffer return instead of a transit encode that can't carry a Buffer. It's on the private SDK surface (underscore method + un-allowlisted `window.apis` fallback), hence a fallback rather than primary.

**`assets://` URL format.** Per-segment `encodeURIComponent` (same as the `file://` builder), which for a UNIX absolute path yields the required **triple slash**: `assets:///Users/…` (two slashes would parse the first segment as the URL host). The handler's single whole-string decode round-trips the gnarly Zotero paths. Windows `C:/…` drive paths would need a `C:/ → /C/logseq__colon/` rewrite (`assets.cljs`) — not handled (plugin is macOS/desktop, Zotero paths are absolute POSIX).

**Ordering rationale.** `assets://` first because it's clean on the latest build (the user's target: a normal 200, no scary `file://` "Not allowed to load local resource" logged per read) and is the most refactor-durable (a plain scheme fetch, not the private `window.apis` surface). IPC second because it covers both versions. `file://` last for ancient builds.

## Dead ends (ruled out with source evidence)

- **`logseq.Assets.makeUrl` / `makeSandboxStorage` / any `logseq.api`/`logseq.sdk` file read** — storage reads are hard path-scoped (`sub-path?`) and text-only (`.toString`); `makeUrl` mangles absolute paths and returns a URL not bytes; no base64/arraybuffer file-read export exists on the plugin surface.
- **`logseq.Net` / `exper_request` with `responseType:'arraybuffer'|'base64'`** — the host runs `node-fetch` in the main process, which is http(s)-only; it can read neither `file://` nor `assets://`.
- **Desktop HTTP API (`:12315`)** — no file-read method exists.

## Is a Logseq change needed?

**No** — the cascade above is plugin-only. File an issue *only* as a hardening request if the reliance on the private `window.apis` fallback + version-specific `assets://` behavior becomes a maintenance concern. Minimal ask: expose the already-arbitrary-path `utils/read-file-raw` (`fs.readFileSync`) as a `^:export`ed plugin-callable returning **base64** (transit-safe), or switch `:httpRequest` from `node-fetch` to Electron's `net.fetch` (which supports the `file:` scheme) so `logseq.Net.request({url:'file://…', responseType:'arraybuffer'})` works with no new API.

## Live smoke test (run once in the plugin iframe on the target build)

DevTools → pick the plugin's `lsp://…/dist/index.html` context → paste (replace the path):

```js
(async () => {
  const abs = '/absolute/path/to/some.pdf'
  const enc = abs.split('/').map(encodeURIComponent).join('/')
  try { const r = await fetch('assets://' + enc); const b = await r.arrayBuffer()
    console.log('assets:// →', r.status, b.byteLength, new TextDecoder().decode(new Uint8Array(b.slice(0,5)))) } // "%PDF-"
  catch (e) { console.log('assets:// FAILED', e.message) }
  try { const buf = await logseq._execCallableAPIAsync('doAction', ['readFileRaw', abs, 'js-obj'])
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    console.log('IPC →', u8.byteLength, new TextDecoder().decode(u8.slice(0,5))) } // "%PDF-"
  catch (e) { console.log('IPC FAILED', e.message) }
})()
```

`%PDF-` + a nonzero byte count = that channel reads the file. Expected on the latest build: both succeed; a bare `fetch('file://'+enc)` still throws `Not allowed to load local resource`.
