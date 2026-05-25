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
re-verified against a running graph on **2026-05-25**.

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

## Deleting a property: clear `:logseq.property/hide?` first ⚠️

**`removeProperty(ident)` and `removeBlock(uuid)` silently no-op on a property
whose block has `:logseq.property/hide?` = true.** They return without error, no
console output — the entity stays. This is the single biggest property gotcha.

Verified with an isolated controlled matrix against a running graph:

| property block has… | `removeProperty` result |
|---|---|
| no flags | ✅ deleted |
| `:logseq.property/hide-empty-value` only | ✅ deleted |
| **`:logseq.property/hide?` only** | ❌ **survives (silent)** |
| both | ❌ survives |
| `hide?` → *stripped first* → remove | ✅ deleted |

**Fix:** `removeBlockProperty(uuid, 'logseq.property/hide?')`, then
`removeProperty(ident)`. No settling needed between the two. `hide-empty-value`
does **not** block — only `hide?`. `getAllProperties()` is **fresh** (reflects a
deletion immediately), so use it to verify a removal really happened — a no-op is
genuine, not a stale read. See `services/delete-zotero-schema.ts`.

> `deletePage(title)` silently no-ops on a property entity — it's not a page in
> that sense. Use `removeProperty`, not `deletePage`.

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
{ "ident": ":plugin.property.logseq-zotero/url", "id": 378, "name": "url",
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
  upsertBlockProperty(uuid, ':plugin.property.logseq-zotero/url', 'B') # → the shared property               (ok)
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
lsq logseq.Editor.getProperty '[":plugin.property.logseq-zotero/url"]'
# List every property in the graph (ident + title + type):
lsq logseq.DB.datascriptQuery '["[:find (pull ?p [:db/ident :block/title :logseq.property/type]) :where [?p :logseq.property/type _]]"]'
# A page's stored property values:
lsq logseq.Editor.getPageProperties '["<page-uuid>"]'
# A tag's full (inherited) schema:
lsq logseq.DB.datascriptQuery '["[:find (pull ?t [:block/title {:logseq.property.class/properties [:db/ident :block/title :logseq.property/type]} {:logseq.property.class/extends ...}]) :where [?t :block/title \"Zotero\"]]"]'
```
