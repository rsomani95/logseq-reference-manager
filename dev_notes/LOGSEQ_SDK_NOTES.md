# Logseq DB-graph SDK & HTTP API — Notes

Practical, **empirically-verified** notes for building and debugging this plugin
against `@logseq/libs`. The official guides
([`db_properties_guide.md`](https://github.com/logseq/logseq/blob/master/libs/guides/db_properties_guide.md),
[`db_properties_references.md`](https://github.com/logseq/logseq/blob/master/libs/guides/db_properties_references.md))
are the contract; this page is **what actually happens** — the things that are
documented wrong, undocumented, or only discoverable by trial and error.

> **Scope: DB graphs only.** File graphs store properties as `key:: value` text
> and behave differently. Two execution contexts appear below: **in-plugin**
> (code running inside the plugin iframe) and the **local HTTP API** (used for
> probing/debugging — see the last section). They share one dispatch layer but
> differ in caller identity, which matters for properties.

**Versions / last verified.** `@logseq/libs` pinned at **0.3.3**. Empirically
re-verified against a running graph on **2026-05-26**.

---

## Property identity: bare name vs full `:db/ident`

A property is an entity keyed by a `:db/ident` like
`:plugin.property.<plugin-id>/<name>`. A bare name (`url`, `title`) is resolved
to an ident by namespacing it under the **calling plugin's id**:

- **In-plugin**, the caller is *your* plugin, so a bare name resolves/creates
  under your namespace — `getProperty('url')` → `:plugin.property.<your-id>/url`.
  Bare names are fine and idiomatic for your own properties. Even names that look
  like built-ins (`tags`, `title`, `url`, `date`) return *your* property —
  Logseq's built-ins live under different idents (`:block/tags`, `:block/title`).
- **Over HTTP**, the caller id is `_test_plugin` (see the HTTP section), so a bare
  name forks to `:plugin.property._test_plugin/<name>` — a *different* property.
  **Over HTTP, always use the full `:db/ident`.**

A **full `:db/ident` always resolves as-is**, in either context: the host's
`get-db-ident-from-property-name` returns a qualified keyword unchanged (only
bare names get namespaced). So full idents are the safe, unambiguous form
everywhere. A property **value** read off a block is always keyed by the full
ident (`:plugin.property.<id>/<name>`), so value reads/writes need the full form.

`getProperty(fullIdent)` is a **safe existence check** — returns the entity or
`null`, and does not create on miss.

---

## Deleting a property: clear `:logseq.property/hide?`, then **let it settle** ⚠️

**`removeProperty(ident)` / `removeBlock(uuid)` silently no-op on a property whose
block has `:logseq.property/hide?` = true.** They return without error, no console
output — the entity stays. This is the single biggest property gotcha, and it has
a second, subtler half (the settle race) that hid behind it.

Verified with an isolated controlled matrix against a running graph:

| property block has… | `removeProperty` result |
|---|---|
| no flags | ✅ deleted |
| `:logseq.property/hide-empty-value` only | ✅ deleted |
| **`:logseq.property/hide?` only** | ❌ **survives (silent)** |
| both | ❌ survives |
| `hide?` → *cleared + settled* → remove | ✅ deleted |

Things that do **not** block (re-confirmed 2026-05-26): a **`node`-type** property,
and a property that **holds values** — both delete fine once `hide?` is clear.
`hide-empty-value` doesn't block either. **Only `hide?` blocks.**

**The settle race ⚠️ — the part that actually bit us.** Clearing `hide?` and
calling `removeProperty` **back-to-back in the same tick races the uncommitted
write**: `removeProperty` reads a `hide?` that's still `true` and no-ops, so the
property survives *despite* the clear. The awaits resolve, but the DB index hasn't
committed the clear yet. Confirmed against a live graph: `removeProperty` with
`hide?` still set → survives; once the clear commits → deletes.

> This was a **real shipped bug**. In-plugin the `removeBlockProperty` →
> `removeProperty` awaits resolve fast enough to lose the race, so "delete schema"
> removed *nothing*; the follow-up "re-apply" then hit the type-lock (Logseq won't
> change a type once data exists — see "`upsertProperty` HANGS") and kept every
> property at its **old type**. The original verification "passed" only because it
> was done over the **HTTP API**, whose inter-call latency happened to let the
> clear commit. (An earlier revision of this very note claimed "no settling
> needed" — wrong; the HTTP-API section's "race uncommitted writes — let it
> settle" warning applies to in-plugin awaits too, not just fresh entities.)

**Canonical procedure** (`services/delete-zotero-schema.ts`):

1. Clear `hide?` on the **whole batch** first — `removeBlockProperty(uuid,
   'logseq.property/hide?')` for each.
2. **Settle** (a short delay, ~200 ms, or poll until the clear is observable) so
   the writes commit.
3. `removeProperty(ident)` (full `:db/ident`, never a bare name) for each, falling
   back to `removeBlock(uuid)`.
4. **Backstop:** if a property survives, re-clear `hide?`, wait, retry (slow commit).
5. Verify with `getAllProperties()` — it's **fresh** (reflects a deletion
   immediately), so a still-present result is genuine, not a stale read.

> `deletePage(title)` silently no-ops on a property entity — it's not a page in
> that sense. Use `removeProperty`, not `deletePage`.

> **Knock-on for re-apply / "applied" state.** If a delete silently leaves a
> property behind, a later re-apply takes the type-lock skip and keeps the old
> type — and if the app records its "applied" snapshot from the *intended* config,
> the UI reads "up to date" while the graph type is stale, hiding the failure.
> Snapshot what's **actually in the graph**, not the intent (see
> `use-schema-state.ts` + `readCreatorsAreNodes` in `set-logseqdb-schema.ts`).

---

## Property display on a tagged page: `hide?` vs `hide-empty-value`

A page tagged with a class surfaces that **class's full property schema** —
including fields the page has no value for. What shows is governed by the host's
filter (paraphrased from `components/property.cljs`):

```clojure
(cond
  show-empty-and-hidden-properties?   false              ; "Hidden properties" expanded → show ALL
  (and hide-empty-value (nil? value)) true               ; hide-empty-value + nil value → HIDE
  :else                               (boolean hide?))   ; hide-by-default → HIDE (into the collapsed group)
```

Consequences:

- **`hide-empty-value` only hides `nil`** — *not* `""` and *not* `"   "`. An
  empty/whitespace string is a present value, so it renders as a visible empty
  row. So: never *write* a blank value (the import path skips blank-after-trim
  strings — see `services/handle-zot-db.ts`), and rely on `hide-empty-value` to
  suppress genuinely-unset fields.
- **`hide?` (hide-by-default)** moves a property into the collapsed "Hidden
  properties" group. **Expanding that group sets `show-empty-and-hidden? → true`,
  which shows *everything* — empties included** (the empty-value check isn't
  re-applied on expand). So marking everything hide-by-default means the only way
  to see any metadata is to expand the group, which then also shows every unset
  field as an empty row.
- **This plugin's choice:** do **not** set `hide?`; set `hide-empty-value`. Then
  populated fields show inline and unset fields are hidden (nil + hide-empty-value
  → hidden). See `services/set-logseqdb-schema.ts`, which also actively *clears*
  any `hide?` a prior schema version set, so a re-apply migrates old properties.

---

## Other property quirks

**`upsertProperty`'s `name` opt is a no-op.** The display name is the property
block's `title` — set it directly:

```ts
const prop = await logseq.Editor.upsertProperty('tags', schema)
if (prop?.uuid) await logseq.Editor.updateBlock(prop.uuid, 'Tags')
```

**Block-level property attributes are qualified keywords, set on the property
block.** `schema.hide` is dead (the SDK rewrites it to `:hide?`, but the UI reads
the qualified `:logseq.property/hide?`). Set these directly via
`upsertBlockProperty(prop.uuid, key, val)`:

```ts
'logseq.property/hide?'              // "Hide by default"
'logseq.property/hide-empty-value'   // "Hide empty value"
'logseq.property/description'        // the per-property description
```

**Setting `''` stores an empty string — it does NOT unset.** Verified 0.3.3:
`upsertBlockProperty(uuid, key, '')` writes `""` (the prior value is *not*
preserved, and the attribute is *not* removed). `""` and "absent" are distinct
states. To truly unset, use `removeBlockProperty(uuid, key)` (→ `nil`).

**`upsertProperty` HANGS when it would change the type of a property that
already has values ⚠️.** Logseq won't change a property's `:logseq.property/type`
once any block holds a value for it — but on refusal it shows a host-side toast
(*"This property's type can't be changed because it has existing data."*) and
**never replies to the plugin**, so the `upsertProperty` RPC never resolves. It
sits until the SDK's deferred-call timeout, which rejects with `[deferred
timeout] async call #N` (every SDK call is a deferred tagged with an incrementing
id; cf. `lsplugin.user.js`). So the symptom is *"the call lags for ~the timeout,
then throws a cryptic timeout"* — not a clean typed error — and it takes down
whatever loop it's in. **Don't re-issue a type on a property that may already
exist:** `getProperty(name)` first (safe existence check, above) and only
`upsertProperty` when it's `null`; to actually change a type, `removeProperty`
then recreate. A same-type re-upsert appears harmless — only a *type change* with
data present trips this. (Observed on re-apply after import; fix in
`services/set-logseqdb-schema.ts`.)

**Descriptions don't render until the property is hydrated** (upstream render
bug). After a cold load, a tag's property-schema view shows *"Add description"*
for every row even though the descriptions are persisted — the main-thread entity
exists but its description ref hasn't been pulled from the worker yet. Eager
fetches force a worker round-trip and return the real value
(`getBlockProperties(uuid)` works; `getProperty(name)` returns the lazy entity and
may show `null`). Hovering the property name or opening its page also shows it. No
clean plugin-side fix — the practical workaround is to hydrate every tagged
property at startup (one `getBlockProperties` each) so the entity is warm.

---

## Tags are classes; properties arrive via inheritance

- A tag is a **class entity**: plugin-created = `:plugin.class.<plugin-id>/<Name>`,
  user = `:user.class/<Name>-<hash>`.
- It carries properties through `:logseq.property.class/properties` (a list of
  property entities) and **inherits** more through `:logseq.property.class/extends`
  (a list of parent classes, recursive). A page tagged with a child class ends up
  carrying the parent class's properties too, sharing their idents.
- Associate / dissociate with `addTagProperty(tag, prop)` /
  `removeTagProperty(tag, prop)`.

Pull a tag's full (own + inherited) schema in one query — `{... ...}` recurses the
enclosing pattern, terminating at a class with no `extends`:

```clojure
[:find (pull ?t [:block/title
                 {:logseq.property.class/properties
                    [:db/ident :block/title :logseq.property/type :db/cardinality]}
                 {:logseq.property.class/extends ...}])
 :where [?t :block/title "Zotero"]]
```

A property entity looks like:

```json
{ "ident": ":plugin.property.logseq-reference-manager/url", "id": 378, "name": "url",
  "title": "URL", ":logseq.property/type": "url",
  "cardinality": ":db.cardinality/one", "valueType": ":db.type/ref" }
```

A `name`/`title` is **not** a unique key — only `:db/ident` is; two properties can
share a title in different namespaces.

---

## Writing property values, by type

The property's `:logseq.property/type` + cardinality decide the value shape:

| `:logseq.property/type` | how to write the value |
|---|---|
| `default`, `url`, `number`, `checkbox` | the scalar directly (string / number / bool) |
| `node` | a page **`.id`** (entity id — **not** `.uuid`). `cardinality :many` → array of ids; `:one` → a single id |
| `date` | a **journal page** id — `createJournalPage(...)`, then write the returned `page.id` |

- For `date`, anchor to **local noon** (`YYYY-MM-DDT12:00:00`). A bare
  `YYYY-MM-DD` parses as midnight **UTC** and rolls to the previous day in any
  negative-offset timezone.
- `IBatchBlock.properties` is **silently ignored on DB graphs** — create the block
  tree, then set properties in follow-up `upsertBlockProperty` calls.
- A native blockquote (`:logseq.property.node/display-type = :quote`) can't be set
  over the JSON API — the value arrives as a string and fails the host's
  `keyword?` validation. Use a clean block.

---

## Theming

`--ls-*` CSS variables live on Logseq's host DOM and **don't cascade into the
plugin iframe**. Resolve and mirror them onto your own `:root`:

```ts
const vars = await logseq.UI.resolveThemeCssPropsVals([
  '--ls-primary-text-color', '--ls-primary-background-color', '--ls-border-color',
])
for (const [k, v] of Object.entries(vars ?? {})) {
  document.documentElement.style.setProperty(k, v)
}
```

Re-run on `logseq.App.onThemeModeChanged` to track light/dark switches.

---

## Plugin icon (`logseq.icon`) renders as an isolated image ⚠️

The `logseq.icon` in `package.json` (`./icon.svg`, shown in the plugins list +
marketplace) is rendered by Logseq's host app as an **image**, not inline SVG.
(Evidence: many marketplace plugins ship full-color logos that display in color —
only possible via `<img>`/background.) Consequences for `icon.svg`:

- `stroke="currentColor"` does **not** inherit Logseq's theme text color — it
  resolves to the SVG's own default (black) and goes invisible on dark themes.
  (The original placeholder icon hardcoded `stroke="gray"` for this reason.)
- An icon can't read the in-app theme. The closest "theme-adaptive" trick is a
  self-contained `<style>` inside the SVG with `@media (prefers-color-scheme: …)`
  swapping the stroke, plus a **mid-tone default** stroke so it stays visible if
  the query is ignored. This tracks **OS/app appearance**, not Logseq's in-app
  theme (usually the same; the mismatch case just falls back to the default):

  ```xml
  <svg … stroke="#7c8786">
    <style>
      @media (prefers-color-scheme: light) { svg { stroke: #41494a; } }
      @media (prefers-color-scheme: dark)  { svg { stroke: #cdd8d6; } }
    </style>
    …paths…
  </svg>
  ```

- The icon is read from the **plugin root** (next to `package.json`), so a
  **plugin reload** picks up changes — no rebuild needed (unlike the iframe UI).

Current icon: lucide **book-marked** (book + ribbon), monoline, via the pattern
above (set 2026-05-25, replacing the dim off-centre "z").

---

## Dev workflow

**Prod build clobbers the dev-server `dist/index.html`.** The dev server (`vite`
via `vite-plugin-logseq`) and the prod build both write `dist/index.html`. Running
a prod build while the dev server is active overwrites the dev HTML with the
static bundle — source edits then stop reaching Logseq. Fix: restart the dev
server and reload the plugin (Settings → Plugins → reload).

---

## Settings panel

**The schema renders a fixed set of widgets — no repeaters, no buttons.**
`SettingSchemaDesc` accepts only `string | number | boolean | enum | object |
heading` (with `inputAs: color | date | datetime-local | range | textarea` and
`enumPicker: select | radio | checkbox`). No array/repeater, no button. Anything
with a dynamic shape (a list of rules, etc.) can't be a native widget — render
your own React UI into `#app` and open it from a command (this plugin's setup
hub: `Zotero: Settings` → `SetupContainer`).

**The plugin iframe can't touch the settings-panel DOM — only `provideStyle` CSS
crosses.** The panel is rendered by the host, so `document.querySelector` from
plugin code can't reach it (no setting `readonly`/`disabled`, no injecting
buttons). The one thing that crosses is CSS injected via `logseq.provideStyle`,
scoped to `.panel-wrap[data-id="<plugin-id>"]`. This plugin uses that to **hide
rows**: register every key always (so Logseq seeds defaults on a fresh install),
then `display: none` the rows via injected CSS — see `HIDDEN_KEYS` /
`applySettingsStyles` in `settings.ts`. The real editing surface is the setup-hub
modal, not the panel.

**`logseq.settings` is GLOBAL, not per-graph ⚠️.** Plugin settings persist in one
file per plugin — `~/.logseq/settings/<plugin-id>.json` (desktop) — shared by
*every* graph, and `updateSettings` writes there. Anything graph-specific must be
derived by *querying the graph* (e.g. `isSchemaAdded()` → `getAllProperties`), not
stashed in a setting. The trap: caching a per-graph fact in a global setting makes
it leak across graphs. This bit the schema-applied snapshot (`appliedSchema`) — a
snapshot written when the schema was applied in graph A made graph B (never set
up) look already-applied, disabling its first Apply. Fix: the per-graph query is
the source of truth; the global setting is only trusted when that query confirms
it for the current graph (see `use-schema-state.ts`'s open-time probe).

---

## Debugging

**Slash-command callbacks swallow errors.** A throw inside the handler vanishes —
no console output. Wrap risky calls:

```ts
logseq.Editor.registerSlashCommand('My command', async () => {
  try { await doRiskyThing() }
  catch (e) { console.error('failed:', e); await logseq.UI.showMsg(`Error: ${(e as Error).message}`, 'error') }
})
```

**Plugin logs may live in the iframe console.** Plugin UI runs in an iframe; its
logs may not surface in the main DevTools console. Right-click a plugin UI element
→ *Inspect*, or pick the plugin iframe in the DevTools frame selector.

---

## The local HTTP API (for probing / debugging)

A token-authed HTTP endpoint that dispatches to the same `@logseq/libs` SDK — the
fastest way to inspect/mutate a running graph from a script (used to verify most
of the above).

- **Transport.** `POST {base}/api` (default `http://127.0.0.1:12315`), header
  `Authorization: Bearer <token>` (Logseq → Settings → Features → HTTP APIs
  Server), body `{"method": "logseq.Editor.upsertBlockProperty", "args": [...]}`.
  The method string is split on `.` and dispatched as if called in-plugin. CORS is
  open. Many methods return `null`/empty on success.
- **Slow writes.** Reads are ~25 ms; writes (`createPage` especially) can take
  >10 s and look like a hang — they still complete. Use generous timeouts;
  requests serialize behind a slow one. Beware: a delete/mutate of a *freshly*
  created+referenced entity can race uncommitted writes — let it settle.
- **Caller identity is `_test_plugin`.** So a **bare** property name forks to
  `:plugin.property._test_plugin/<name>`, not the shared one — **always pass the
  full `:db/ident` over HTTP.** Demonstrated by writing both forms to one page:

  ```
  upsertBlockProperty(uuid, 'url', 'A')                                # → :plugin.property._test_plugin/url  (junk)
  upsertBlockProperty(uuid, ':plugin.property.logseq-reference-manager/url', 'B') # → the shared property               (ok)
  ```

- **Cross-plugin rules** (caller `_test_plugin` acting on another plugin's idents):
  - **Create is blocked**: upserting an ident that doesn't exist →
    `{"error": "Plugins can only upsert its own properties"}`. So the HTTP caller
    can only *create* properties in its own `_test_plugin` namespace.
  - **Writing a value** by full ident to an *existing* property succeeds
    regardless of owner.
  - **`addTagProperty` / `removeTagProperty` work** on another plugin's class
    (verified — associating/dissociating is not ownership-gated).
  - Earlier "cross-plugin delete is gated" guesses were wrong — those no-ops were
    the `hide?` flag (above), not ownership.
- **JSON-key quirk.** The HTTP layer simplifies some keyword keys
  (`:db/ident`→`ident`, `:block/title`→`title`, `:db/cardinality`→`cardinality`,
  `:block/uuid`→`uuid`) but keeps others namespaced (`:logseq.property/type`,
  `:logseq.property.class/properties`). Keyword **values** keep their leading colon
  (`":db.cardinality/one"`). `getPageProperties` keys are the colon-prefixed idents.

### Reusable probe

```bash
export LOGSEQ_URL=http://127.0.0.1:12315
export TOKEN=...   # Logseq → Settings → Features → HTTP APIs Server → auth token

lsq () {  # usage: lsq <method> '<json-args-array>'
  curl -sS -X POST "$LOGSEQ_URL/api" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"method\":\"$1\",\"args\":${2:-[]}}" | python3 -m json.tool
}

# Inspect a property by ident:
lsq logseq.Editor.getProperty '[":plugin.property.logseq-reference-manager/url"]'
# List every property in the graph (ident + title + type):
lsq logseq.DB.datascriptQuery '["[:find (pull ?p [:db/ident :block/title :logseq.property/type]) :where [?p :logseq.property/type _]]"]'
# A page's stored property values:
lsq logseq.Editor.getPageProperties '["<page-uuid>"]'
# A tag's full (inherited) schema:
lsq logseq.DB.datascriptQuery '["[:find (pull ?t [:block/title {:logseq.property.class/properties [:db/ident :block/title :logseq.property/type]} {:logseq.property.class/extends ...}]) :where [?t :block/title \"Zotero\"]]"]'
```

---

## Writing typed blocks the Editor API can't — `build-import` over the HTTP API ⚠️

The plugin Editor API (`upsertBlockProperty`, `insertBlock`'s `properties`) only
writes **scalar user-properties**. It **cannot** set:
- a **closed-value reference** (e.g. `:logseq.property.pdf/hl-color
  :logseq.property/color.yellow` — a ref to a closed-value entity), or
- an **EDN-map** property value (e.g. `:logseq.property.pdf/hl-value {…}`), or
- any **keyword** value (same root cause as the blockquote `display-type`
  gotcha above — over the JSON bridge a keyword arrives as a string and fails the
  host's `keyword?` validation).

So a first-class typed block — a `:logseq.class/Pdf-annotation` (PDF annotation
import), and in general anything needing internal idents/closed values — can't be
built with the Editor API. The route that works is Logseq's own
**`logseq.db.sqlite.export/build-import`**, reached from a plugin **only** via the
desktop **HTTP API** (the same `:12315` server in the section above):

- **Method:** `logseq.cli.import_edn` (the method `@logseq/cli`'s `import-edn`
  dispatches to). Body: `{"method":"logseq.cli.import_edn","args":[<payload>]}`,
  `Authorization: Bearer <token>`.
- **The arg is Transit-JSON, NOT raw EDN.** `@logseq/cli`
  (`commands/import_edn.cljs`) reads the `.edn` file, parses it, and sends
  `(sqlite-util/transit-write import-map)` — i.e. a single **Transit-encoded
  string**. Posting raw EDN fails with a JSON parse error. Uncached transit-json
  is accepted: `map → ["^ ",k,v,…]`, `keyword → "~:ns/name"`, `uuid → "~u<uuid>"`,
  and a string starting with `~`/`^`/`` ` `` is escaped with a leading `~`.
- **Caller identity doesn't matter here.** Even though the HTTP caller is
  `_test_plugin`, `build-import` sets idents straight from the payload (it doesn't
  namespace them), so the closed-value `hl-color` ref and the `Pdf-annotation`
  class resolve correctly regardless of caller.
- **Idempotent** via `:build/keep-uuid? true` on each block (upsert by
  `:block/uuid`, no duplicates). Attach-under-existing-asset trick: declare blocks
  under the existing page (matched by `:block/title`) and set `:block/parent`
  explicitly by uuid; reference the asset by uuid, never re-declare it.

Verified against a live graph: a no-op `{:pages-and-blocks [] …}` returns HTTP
200; a real annotation block round-trips with its `hl-color` closed-value ref
(`{:ident ":logseq.property/color.yellow"}`) and full `hl-value` map intact.

In this plugin: the Transit encoder + `build-import` payload builder live in
`src/services/logseq-transit.ts`; the HTTP client (token/base from the
`logseqApiToken` / `logseqApiBaseUrl` settings) in
`src/services/logseq-import-edn.ts`. The token is the user's "HTTP APIs Server"
auth token, set in the setup hub's **Annotations** section.

### Reading local file bytes + bundling a WASM engine in the plugin iframe

Two things the PDF-annotation feature needs, both confirmed working in Logseq's
plugin iframe (Electron renderer):

- **`fetch('file://…')` / `XMLHttpRequest` on a local path works.** Zotero's local
  API only `302`-redirects `/items/<key>/file` to a `file://` URL (it never
  streams bytes — see [`ZOTERO_ATTACHMENT_PATHS.md`](./ZOTERO_ATTACHMENT_PATHS.md)),
  so the plugin reads the file itself. `read-pdf-bytes.ts` tries `fetch` then an
  XHR fallback; one of them is permitted in the sandbox. (This is reading an
  *external* file, distinct from the plugin's own bundled assets.)
- **`mupdf` (10 MB WASM) bundles + loads.** Its `mupdf-wasm.js` locates the wasm
  via `new URL("mupdf-wasm.wasm", import.meta.url)`, which Vite rewrites + emits as
  a hashed **same-origin** asset (not inlined). In the renderer mupdf detects
  `process.type === "renderer"` and takes its **browser** code path (fetch /
  `instantiateStreaming`, with an ArrayBuffer fallback), so the Node-only
  `node:fs` / `module` imports Vite externalizes are never reached. Keep it behind
  a **dynamic `import()`** so the 10 MB chunk loads only when annotations are
  actually imported, not on every plugin start.
