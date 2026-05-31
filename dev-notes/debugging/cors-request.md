# Connecting to the Zotero local API is CORS-blocked for marketplace installs

**Status:** root cause fully diagnosed and validated (Zotero source + Logseq source + live tests). `effect: true` (the obvious community fix) **tested and rejected** — it doesn't relocate this plugin's UI iframe. The `exper_request` fix is validated but **not yet implemented**.
**Issue:** <https://github.com/rsomani95/logseq-reference-manager/issues/1>
**Last verified:** 2026-05-27

---

## TL;DR

The plugin reads Zotero's local HTTP API at `http://127.0.0.1:23119`. When the plugin is **installed from the marketplace**, that `fetch` is blocked by CORS. When loaded **unpacked during development**, it works. The split comes from two independent facts:

1. **Zotero never grants CORS permission to us.** Its local API returns an `Access-Control-Allow-Origin` (ACAO) header *only* for `https://www.zotero.org`. For every other origin it returns none — by design. So any browser `fetch` to it from the plugin is CORS-blocked.
2. **The plugin's origin differs by install method, and only one of them is CORS-checked.** A marketplace install runs at `lsp://logseq.io`, which Logseq registers as a *standard* web scheme → Chromium runs CORS on its `fetch`. A dev/unpacked plugin runs at `file://`, which Chromium treats as an **opaque origin exempt from CORS** → the identical `fetch` is never CORS-checked and succeeds.

**Consequence for the fix:** from the marketplace (`lsp://`) iframe, no browser `fetch` can reach Zotero (no header trick helps — see [Dead ends](#approaches-that-do-not-work)). The host-side `logseq.Request` API also fails there, and the community's usual sandbox-escape fix `effect: true` was **tested here and does not work** (it doesn't relocate this plugin's UI iframe — see [Fix options](#fix-options)). The **only** validated path is to make the HTTP request in Logseq's *host process* over postMessage, via the (undocumented) `exper_request` call. See [Working approach](#working-approach-postmessage-exper_request) and [Recommended fix](#recommended-fix--exper_request-over-postmessage).

---

## Environment

- **Zotero** 7+ local API at `http://127.0.0.1:23119/api/users/0` (test instance reported `X-Zotero-Version: 9.0.4`, connector API v3).
- **Logseq** desktop (Electron/Chromium), **production build**, DB graph.
- **`@logseq/libs`** 0.3.3.
- Plugin HTTP code is isolated to **`src/services/get-zot-items.ts`** (built on `wretch`). Every Zotero call is a `GET`.

---

## Symptom

In a marketplace install, the connection test (and all imports) fail with:

```
Access to fetch at 'http://127.0.0.1:23119/api/users/0/items?limit=1'
from origin 'lsp://logseq.io' has been blocked by CORS policy:
Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

The same plugin loaded unpacked has no such error.

---

## Root cause

### Fact 1 — Zotero only sends ACAO to the bookmarklet origin

Zotero's HTTP server adds CORS headers only when the request `Origin` equals `BOOKMARKLET_ORIGIN` (`https://www.zotero.org`). Source — `chrome/content/zotero/xpcom/server/server.js`, `_generateResponse`:

```js
if (this.origin === ZOTERO_CONFIG.BOOKMARKLET_ORIGIN) {   // = https://www.zotero.org
  response += "Access-Control-Allow-Origin: " + this.origin + "\r\n";
  response += "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n";
  response += "Access-Control-Allow-Headers: Content-Type,X-Zotero-Connector-API-Version,X-Zotero-Version\r\n";
}
```

For any other origin, no ACAO is emitted. An `OPTIONS` preflight is answered with a bare `200` (the same `_generateResponse`, so still no ACAO). This is intentional — Abe Jellinek (zotero-dev): *"we wouldn't want to allow cross-origin requests to the local API; webpages shouldn't have access to it."*

The plugin's request is **preflighted** because its headers (`Content-Type: application/json`, `x-zotero-connector-api-version`, `zotero-allowed-request`) are not CORS-safelisted. The preflight gets no ACAO → Chromium blocks before the real `GET` is ever sent. That is the exact error above.

> **`zotero-allowed-request` is not a CORS fix.** In Zotero's code (`server.js`, `_processEndpoint`) it only gates whether a GET/POST is *processed* server-side (the "Preventing request from browser" check, which also keys off a `Mozilla/…` User-Agent). It produces no ACAO and cannot ride the preflight, because browsers strip custom headers from the automatic `OPTIONS`.

**Validated** against the live instance with curl (curl has no Origin and no Same-Origin Policy, so it bypasses both the browser-gate and CORS):

```bash
ZURL="http://127.0.0.1:23119/api/users/0/items?limit=1"

# Per-origin ACAO probe:
for O in "lsp://logseq.io" "http://localhost:5173" "https://www.zotero.org"; do
  printf "%-26s ACAO: " "$O"
  curl -sS -D - -o /dev/null "$ZURL" -H "Origin: $O" -H "zotero-allowed-request: true" \
    | grep -i access-control || echo "(none)"
done
# lsp://logseq.io          ACAO: (none)
# http://localhost:5173    ACAO: (none)
# https://www.zotero.org   ACAO: Access-Control-Allow-Origin: https://www.zotero.org

# OPTIONS preflight from the marketplace origin → bare 200, no ACAO (reproduces the error):
curl -sS -i -X OPTIONS "$ZURL" -H "Origin: lsp://logseq.io" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-zotero-connector-api-version,zotero-allowed-request"
# HTTP/1.0 200 OK ... Content-Length: 0   (no Access-Control-* headers)
```

Key implication: Zotero returns **no ACAO to `lsp://logseq.io` *or* `http://localhost`** — it does not treat localhost specially. So the dev-vs-marketplace difference is **not** on Zotero's side.

### Fact 2 — the difference is the plugin's origin/scheme, enforced by Chromium

The plugin runs inside an iframe whose document origin depends on how it was installed:

| | Unpacked (dev) | Marketplace (installed) |
|---|---|---|
| Document origin | `file://` (or `http://localhost:PORT` if a vite dev server is actively serving it) | `lsp://logseq.io` |
| vs Logseq host window (`file://`) | **same-origin** | cross-origin |
| `window.top.logseq` / `logseq.Request` | works | `SecurityError` (cross-origin) |
| Chromium origin type | **opaque → CORS-exempt** | **standard tuple origin → CORS-checked** |
| `fetch` → Zotero | **succeeds** | **blocked (no ACAO)** |

Why the origins differ and why only one is CORS-checked:

- **Origin assignment.** Logseq rewrites the `file://` entry of installed plugins (those whose localRoot is under `~/.logseq/plugins`) to `lsp://logseq.io` via `convertToLSPResource` (`libs/src/LSPlugin.core.ts:454-462`). Unpacked plugins are *not* rewritten, so they keep `file://` (or the vite localhost URL).
- **Scheme registration is the crux.** Logseq registers the `lsp`/`logseq` schemes as **standard** + fetch-capable (`src/electron/electron/core.cljs:422-435`):

  ```clojure
  (let [privileges {:standard true :secure true :bypassCSP true :supportFetchAPI true}]
    (.registerSchemesAsPrivileged protocol
      (bean/->js [{:scheme "logseq" :privileges privileges}
                  {:scheme "lsp"    :privileges privileges}      ; ← marketplace plugin origin
                  {:scheme "assets" :privileges {:standard false :secure false
                                                 :bypassCSP false :supportFetchAPI false}}])))
  ```

  `:standard true` gives `lsp://logseq.io` a real **tuple origin** `(scheme, host, port)` that Chromium funnels through its normal CORS network stack — exactly like an `https://` site. So a cross-origin `fetch` to Zotero is CORS-checked, gets no ACAO, and is blocked. (`corsEnabled` is left unset → `false`, which only makes the treatment stricter; it does not turn CORS off.)

  `file://`, by contrast, is a Chromium-special **opaque, non-CORS-enabled** origin. Chromium applies CORS only to http/https and registered standard schemes — it does **not** run the CORS algorithm on `file://`-initiated cross-origin fetches. So the identical request to Zotero is simply made and read.

> **The irony:** the very thing that makes a marketplace plugin "proper" — promotion from a raw `file://` path to a real `lsp://logseq.io` origin — is exactly what subjects it to CORS.

**A second, independent axis (does NOT gate CORS, but worth knowing):** Logseq's window sets `:webSecurity (not dev?)` (`src/electron/electron/window.cljs:48`; `dev? = NODE_ENV !== "production"`, `utils.cljs:23-25`). A **dev build of Logseq** (`yarn dev`, host window at `http://localhost:3001`) has `webSecurity` **off** → SOP/CORS disabled window-wide, so *everything* works regardless of origin. A **production/released build** (host window at `file://`) has it **on**. The instance under test is a production build (`window.top.location.origin === "file://"`, and cross-frame access throws — see below), so `webSecurity` is constant-ON here and is *not* the operative variable; origin is. Don't confuse this with the in-app **"Developer mode" settings toggle**, which only unlocks plugin-dev UX (the "Load unpacked plugin" button, reload) and changes none of `webSecurity` / `NODE_ENV` / origin.

**Validated** in each iframe's DevTools console (right-click the plugin UI → Inspect to scope the console to the plugin iframe):

```js
// Diagnostic — run in each plugin's iframe console
console.log('plugin origin:', location.origin)
try { console.log('top origin :', window.top.location.origin) } catch (e) { console.log('top BLOCKED:', e.message) }
try { console.log('top.logseq :', typeof window.top.logseq) }     catch (e) { console.log('top.logseq BLOCKED:', e.message) }
fetch('http://127.0.0.1:23119/api/users/0/items?limit=1',
      { headers: { 'zotero-allowed-request': 'true', 'x-zotero-connector-api-version': '3.0' } })
  .then(r => r.json()).then(d => console.log('raw fetch OK →', d))
  .catch(e => console.error('raw fetch FAIL →', e.message))
```

| | Unpacked result | Marketplace result |
|---|---|---|
| `plugin origin` | `file://` | `lsp://logseq.io` |
| `top origin` | `file://` | `BLOCKED` (cross-origin SecurityError) |
| `top.logseq` | `object` | `BLOCKED` |
| raw `fetch` → Zotero | **`OK → [ {…} ]`** | **CORS error** (the symptom) |

---

## Approaches that do not work

Tried and ruled out (so a future attempt doesn't repeat them):

- **Browser `fetch` with any header combination (from `lsp://`).** Catch-22: *with* the custom Zotero headers → preflight → no ACAO → blocked; *without* them → Zotero's server-side browser-gate cancels the request (it sees the `Mozilla/…` User-Agent, which JS cannot remove) and the response has no ACAO anyway. There is no header set that satisfies both Zotero's gate and CORS from a browser.
- **`fetch(url, { mode: 'no-cors' })`.** Avoids the preflight but yields an *opaque* response (status 0, unreadable body). Useless for reading JSON.
- **`logseq.Request` / any `logseq.Experiments.*` (host-side HTTP).** `logseq.Request._request` routes through `Experiments.invokeExperMethod('request')`, which reaches into the host window **synchronously** — `window.top.logseq.api.exper_request` (`libs/src/modules/LSPlugin.Experiments.js`):

  ```js
  ensureHostScope() { try { const _ = window.top?.document } catch (_e) { console.error('Can not access host scope!') } return window.top }
  invokeExperMethod(type, ...args) {
    const host = this.ensureHostScope()
    const fn = host.logseq.api['exper_' + type] || host.logseq.sdk.experiments[type]   // ← cross-origin read of window.top
    return fn?.apply(host, args)
  }
  ```

  At `lsp://logseq.io` the iframe is cross-origin with the `file://` host window, so reading `window.top.logseq` throws `SecurityError: Blocked a frame with origin "lsp://logseq.io" from accessing a cross-origin frame` (SDK logs `Can not access host scope!`). The SDK exposes no other HTTP path (no `http`/`request`/`fetch` entry in its postMessage-callable schema). *(This is why it nonetheless works for unpacked plugins — `file://` is same-origin with the host, so the host-scope read succeeds.)*
- **Change Zotero / run a local proxy.** Not viable: Zotero has no allowed-origins preference, we can't patch users' Zotero, and a bundled proxy defeats the zero-config goal.

---

## Working approach: postMessage `exper_request`

The only channel that survives a cross-origin iframe is the normal **postMessage RPC** (the same transport `logseq.Editor`/`App`/`DB` use — which is why page creation already works in marketplace installs). The SDK's schema declares no HTTP method there, **but the host still dispatches the undeclared `exper_request` over postMessage**, performs the HTTP request in its own (non-browser, CORS-free) process, and posts the result back.

**Validated live in the marketplace (`lsp://`) iframe** — the exact case that fails for `fetch`:

```js
// 1) fire the request → returns a numeric request id
const reqId = await logseq._execCallableAPIAsync('exper_request', logseq.baseInfo.id, {
  url: 'http://127.0.0.1:23119/api/users/0/items?limit=1',
  method: 'GET', returnType: 'json',
  headers: { 'zotero-allowed-request': 'true', 'x-zotero-connector-api-version': '3.0' },
})
// reqId → 2

// 2) the parsed result arrives on logseq.Request's `task_callback_<reqId>` event:
//    task_callback_2 → [ { key: '7AL3LWKZ', itemType: 'attachment', … } ]
```

(The result event was captured in testing by temporarily wrapping `logseq.Request.emit`; in real code attach a listener keyed on `task_callback_${reqId}` — see implementation notes.)

Why it works: the request is made by Logseq's host process, not the iframe — there is no browser CORS, no preflight, and no cross-origin frame access. Confirmed: a no-Origin request to Zotero returns `200 + JSON` (curl Fact 1 above), and the host request behaves the same.

---

## Fix options

The Logseq community has hit this class of problem for years (Ollama, flomo, mermaid, several AI plugins). Their usual answers, and whether each applies here:
- **Make the *server* CORS-permissive** (e.g. `OLLAMA_ORIGINS=*`, LM Studio `--cors`) — the ecosystem's standard fix for local APIs. **Not available for Zotero:** its local API has no allowed-origins setting and only ACAOs `https://www.zotero.org` (Fact 1). ✗
- **A local CORS proxy** — can't reach a user's `127.0.0.1`, and defeats zero-config. ✗
- **`effect: true` (escape the sandbox)** — the canonical *forum* fix and the obvious candidate. **Tested here → does NOT fix this plugin** (details below). ✗
- **A local CORS proxy** — can't reach a user's `127.0.0.1`, and defeats zero-config. ✗
- **`logseq.Request`** — the SDK's *intended* CORS bypass, but broken cross-origin in marketplace (see [Approaches that do not work](#approaches-that-do-not-work)); works only same-origin. ✗ alone.

That leaves exactly one validated path — **`exper_request` over postMessage** (the [Recommended fix](#recommended-fix--exper_request-over-postmessage)). First, the `effect: true` result, since it's the obvious thing to reach for:

### `effect: true` — TESTED 2026-05-27 → does NOT fix this plugin

**Theory.** Add `"effect": true` to the `logseq` block; Logseq then loads the plugin **same-origin with the host** (skipping the `lsp://` rewrite — `convertToLSPResource` is gated on `!effect`, `LSPlugin.core.ts:790`/`:613`), so browser CORS no longer applies and the existing `fetch` code works unchanged. This is the community's standard fix (the Ollama CORS thread was resolved by shipping it; many marketplace plugins use it), documented in the marketplace repo as *"whether the sandbox is running under the same origin with host."*

**Result: it does not work for this plugin.** We reproduced the real `lsp://` condition with a local build — staged under `~/.logseq/plugins/`, which makes `isInstalledInLocalDotRoot` true → confirmed `lsp://` origin + the CORS failure — then added `effect: true` and verified with a **full uninstall + re-add via Load unpacked (forces a fresh `package.json` parse) + full Logseq restart**:

- The plugin's **UI-iframe origin stayed `lsp://logseq.io`** (checked by right-clicking the Connection panel → Inspect → `location.origin`). The connection still failed with the same preflight CORS error; batch import still "Failed to fetch."
- The UI rendered fine — so `effect` did **not** turn it headless/background (an earlier worry, now dead).
- A `file://` reading seen mid-test was the **host/top window**, not the plugin's UI iframe — a measurement slip, corrected by inspecting the panel directly.

So `effect: true` does **not** relocate this plugin's `showMainUI`/`provideUI` iframe — and the plugin fetches from that iframe. (It likely *does* work for plugins that fetch from their background/main context, which is why the forum reports succeed.)

**Unresolved discrepancy:** Logseq's `master` source (`LSPlugin.core.ts:790`, `:613`) reads as though `effect: true` should resolve the entry + resources to `file://`. Empirically the UI iframe stays `lsp://`. Not pinned why — `effect` may not gate the UI-iframe path the way it gates the entry; the manifest `logseq.effect` may map to something other than `_options.effect`; or the installed Logseq build differs from `master`. The empirical verdict stands regardless.

## Recommended fix — `exper_request` over postMessage

Refactor `get-zot-items.ts` off `wretch` onto a thin host-request helper built on the validated transport (the one path proven to work *inside* the `lsp://` iframe). Sketch:

```ts
type ReqOpts = { url: string; method?: string; returnType?: 'json' | 'text'; headers?: Record<string,string> }

function hostRequest<T>(opts: ReqOpts): Promise<T> {
  return new Promise((resolve, reject) => {
    logseq._execCallableAPIAsync('exper_request', logseq.baseInfo.id, { method: 'GET', returnType: 'json', ...opts })
      .then((reqId: string | number) => {
        logseq.Request.once(`task_callback_${reqId}`, (payload: unknown) =>
          payload instanceof Error ? reject(payload) : resolve(payload as T))
      })
      .catch(reject)
  })
}
```

**Scope** (small, one file):
- All Zotero calls are `GET`; bake query strings directly into `url` (no `wretch` query addon).
- Use `returnType: 'json'`.
- Rework error handling: the failure payload is a plain `Error`, not a `WretchError` — update `testZotConnection` and the toast paths in `get-zot-items.ts` that currently read `.status` / `.response`.

**Implementation notes / risks:**
- **⚠ Undocumented API.** `exper_request` is not in the `@logseq/libs` schema and `_execCallableAPIAsync` is an underscore-internal method. This could change across Logseq versions. Surface a clear, actionable error if `exper_request` ever returns nothing, and consider pinning behavior with a smoke test.
- **Optional robustness:** prefer the official `logseq.Request._request` when host scope is reachable (i.e. same-origin/dev), and fall back to `exper_request` only when that throws. Keeps the supported API on the happy path and the internal one only where required (marketplace).
- **Race condition to handle carefully.** The validation pre-attached the result listener. In `hostRequest`, the listener is attached *after* `await`. This is expected to be safe (the host posts the `reqId` ack before the async data callback, and the microtask attaching `.once` runs before the next message macrotask), but it was **not** stress-tested — verify, or attach a listener on the low-level callback channel before firing / buffer early callbacks, to be certain.

**Prior art & endorsement:** exactly one published plugin uses this path — `hdansou/logseq-ai-actions` (study `src/adapter/`; its CHANGELOG + tasks.md trace `fetch → logseq.Request → exper_request`). And the SDK flags the route as preferred: `libs/src/modules/LSPlugin.Net.ts:458` — `// TODO: instead exper_request of callable apis`. So although undocumented, it's SDK-blessed and field-tested.

## Bottom line

`exper_request` over postMessage is the fix: it's the only approach proven to reach Zotero from the `lsp://` marketplace iframe, it keeps the plugin sandboxed, and its "desktop-only" limit is moot for a local-Zotero plugin. `effect: true` — the obvious community fix — was tested and does **not** work here. A local CORS proxy, or petitioning Logseq to expose HTTP in the SDK schema, remain distant fallbacks only. (The viable desktop path reaches the Electron main-process fetch; it does not help Logseq Web, which has no Electron IPC.)

---

## Open questions / unknowns

- **Exact Chromium predicate exempting `file://` from CORS** was not source-quoted from Chromium itself. The behavior is corroborated by MDN ("CORSRequestNotHttp": CORS applies only over http/https; `file://` gets opaque origins) and Electron issues (#20730 standard schemes trigger CORS; #24849 file:// gated by `CanDisplay`, not the CORS path), **and** confirmed empirically (raw `fetch` from `file://` returns 200+data). It does not affect the fix.
- **`exper_request` stability** across Logseq versions is unverified (see risk above). The fix depends on it for the marketplace case.
- **Race-free listener attachment** in the production helper is reasoned, not stress-tested (see implementation notes).
- **Why `effect: true` does not relocate this plugin's UI iframe** — despite `LSPlugin.core.ts:790`/`:613` reading as though it should — is unresolved (see Fix options). It does not block the fix; `exper_request` is the path. Likely it only gates the entry/background context, not the `showMainUI` iframe where this plugin fetches.

---

## Key source references

- Zotero CORS + browser-gate: `chrome/content/zotero/xpcom/server/server.js` (`_generateResponse` ACAO block; `_processEndpoint` browser-prevention gate).
- Logseq scheme registration: `src/electron/electron/core.cljs:422-435` (`lsp`/`logseq` = `standard:true, supportFetchAPI:true`).
- Logseq origin rewrite for installed plugins: `libs/src/LSPlugin.core.ts:454-462` (`convertToLSPResource`).
- Logseq web-security flag: `src/electron/electron/window.cljs:48` (`:webSecurity (not dev?)`); `utils.cljs:23-25` (`dev?`).
- SDK host-scope mechanism (why `logseq.Request` fails cross-origin): `libs/src/modules/LSPlugin.Experiments.js` (`ensureHostScope`, `invokeExperMethod`).
