# Architecture — start here

High-level orientation for a developer new to this codebase. The goal is to
give you the right *mental model* and point you at the right files — not to
explain implementations (read the code for that). Pair this with
[`module-map.md`](./module-map.md) (where everything lives) and
[`CLAUDE.md`](../CLAUDE.md) (the exhaustive behavioural reference).

> Reflects `main` as of **2026-05-31**. When this drifts from the code, the code
> wins — but please fix the drift.

---

## What this is

A Logseq **reference manager**, for **DB graphs only** (not file graphs — they
store properties differently and aren't supported). It pulls references into
Logseq from two sources that share **one property schema** (the field set is
modelled on Zotero's API):

- **Zotero** — imports items directly from a **running Zotero 7+ instance** over
  its local HTTP API (`http://127.0.0.1:23119`). No Zotero Cloud sync is
  involved; the desktop app must be open. **This is the bulk of the codebase.**
- **Web** — a companion browser extension (separate repo,
  [`logseq-web-clipper`](../../logseq-web-clipper)) clips web pages straight into
  the graph. **This plugin does not clip the web.** For this source it only owns
  the shared schema + the tag the extension writes into, and stores the capture
  config the extension reads back.

**The product stance that shapes everything:** an imported page is *not* an
archival record — it's the user's note-taking workbench and a link target from
across the graph. Import should feel instant and native; the generated page
should be a good place to **write**, not a metadata dump. (See the *Design
context* section of [`CLAUDE.md`](../CLAUDE.md) for the full framing — read it
before doing any UI work.)

---

## The mental model: a client between two local servers

The single most useful thing to understand up front: **the plugin is a client
sitting between two local apps, and talks to each over more than one channel.**
Nothing here is a cloud service; everything is `127.0.0.1`.

```
            ┌───────────────────────────┐
            │       Zotero 7+ (app)     │
            │   local connector API     │
            │      127.0.0.1:23119      │
            └─────────────▲─────────────┘
                          │  ① HTTP  — items, collections, saved searches
                          │  ② file:// — read a PDF's raw bytes
                          │             (the API only 302s to a file:// URL)
   ┌──────────────────────┼──────────────────────────────────────────────┐
   │ Logseq desktop (Electron)                                           │
   │                      │                                              │
   │   ┌──────────────────┴────────────────────┐                         │
   │   │  Reference Manager plugin (this repo) │   runs in an iframe,    │
   │   │  React UI  +  services/ logic         │   mounted at #app       │
   │   └───┬───────────────────────────┬───────┘                         │
   │       │ ③ @logseq/libs SDK        │ ④ HTTP 127.0.0.1:12315          │
   │       │   (in-iframe RPC to host) │   (build-import — see below)    │
   │   ┌───▼───────────────────────────▼───────┐                         │
   │   │     Logseq host  →  the DB graph      │                         │
   │   └────────────────────▲──────────────────┘                         │
   └────────────────────────┼────────────────────────────────────────────┘
                            │ ⑤ HTTP 127.0.0.1:12315
                            │   reads this plugin's settings; writes its clips
                   ┌────────┴──────────┐
                   │   Web clipper     │  separate Chrome extension.
                   │  (separate repo)  │  A *sibling* client of Logseq —
                   └───────────────────┘  it never talks to this plugin
                                          directly, only through the shared
                                          settings + schema contract.
```

The four channels the plugin uses:

| # | From → To | Transport | Used for |
|---|-----------|-----------|----------|
| ① | plugin → Zotero | HTTP `:23119` (`wretch`) | fetch items / collections / saved searches / children |
| ② | plugin → disk | `fetch`/XHR on a `file://` path | read a PDF's bytes for annotation extraction |
| ③ | plugin → Logseq | `@logseq/libs` SDK | **almost everything** — create pages, write properties, query the graph, settings, UI |
| ④ | plugin → Logseq | HTTP `:12315` | the **one** write the SDK can't do: typed annotation blocks via `build-import` |
| ⑤ | web clipper → Logseq | HTTP `:12315` | (not us) reads our settings, writes clipped pages |

**Why two ways to talk to Logseq (③ and ④)?** The `@logseq/libs` SDK can only
write scalar user-properties. A PDF-annotation block needs a *closed-value
reference* (`hl-color`) and an *EDN-map* value (`hl-value`) that the SDK refuses.
The only route that writes those is Logseq's own `build-import`, reachable from a
plugin **only** over the desktop HTTP API. So the annotation feature carries its
own HTTP client. Full rationale in
[`logseq-sdk-notes.md`](./logseq-sdk-notes.md) ("Writing typed blocks…").

**Why read files over `file://` (②)?** Zotero's local API never streams attachment
bytes — `GET /items/<key>/file` just `302`s to a `file://` URL. So to extract
annotations the plugin reads the file itself. See
[`zotero-attachment-paths.md`](./zotero-attachment-paths.md).

---

## Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language | **TypeScript 5.9**, strict + `noUncheckedIndexedAccess` | path alias `../*` → `src/*` |
| UI | **React 19** + react-dom | renders into the plugin iframe's `#app`; toggled via `showMainUI()` / `hideMainUI()` |
| Logseq integration | **`@logseq/libs` 0.3.3** | DB-graph SDK. ⚠️ on npm the `latest` tag is the *old* 0.0.x line; the DB line is `next` → 0.3.x |
| Forms | react-hook-form | the search form |
| HTTP | wretch | Zotero local API + Logseq HTTP API |
| Dates | date-fns | |
| Icons | lucide-react | |
| PDF engine | **mupdf 1.27.0** (WASM, ~10 MB) | native annotation extraction; behind a dynamic `import()` so it only loads when annotations are imported |
| Drag-and-drop | @dnd-kit | only in `features/setup/WebSection.tsx` (reordering web sections) |
| Build / dev | **Vite 7** + `vite-plugin-logseq` | HMR dev server loads straight into Logseq; PostCSS (`postcss-simple-vars`) |
| Pkg manager / tests | **bun** | `bun test` runs `*.test.ts` (pure functions only) |
| Lint / format | **Biome 2.4** | single quotes, no semicolons; husky pre-commit runs `biome check` + `tsc --noEmit` |
| Styling | plain CSS + custom props | `src/styles/` mirrors Logseq's resolved theme tokens (light + dark) |

> Note: an earlier client-side fuzzy search (fuse.js) was **removed** — search now
> hits Zotero's own SQLite index server-side. Don't reintroduce a local index.

The dev-loop gotcha worth knowing on day one: **a prod `bun run build` clobbers the
dev server's `dist/index.html`.** If source edits stop reaching Logseq after a
build, restart the dev server and reload the plugin. (More in
[`logseq-sdk-notes.md`](./logseq-sdk-notes.md) → *Dev workflow*.)

---

## The spine: one schema, two tags, a key per item

Everything orbits a single data transformation and a single schema model.

**The transformation.** Raw Zotero JSON → the plugin's working shape → a Logseq
page:

```
ZotItem          map-items.ts         ZotData              handle-zot-db.ts      Logseq page
(raw Zotero  ──────────────────►  (plugin working   ──────────────────────►  (tagged with
 API JSON)    join children,       shape: + children, write typed properties,   zotTag, props
              compute inGraph,      citeKey, inGraph,  attachments, tag rules,   per the preset)
              libraryLink, …)       libraryLink)        then annotations
```

- `ZotItem` (in [`interfaces.ts`](../src/interfaces.ts)) mirrors Zotero's API
  JSON exactly — the big string-literal unions are a *pinned snapshot* of
  Zotero's schema, not a live binding.
- `ZotData` is the same data after `map-items.ts` joins in child items
  (attachments + their annotations, notes), computes the `inGraph` badge, and
  derives `citeKey` / `libraryLink` / `zotero-code`.

**The schema model.** A single **base tag** (`zotTag`, default `Reference`)
carries all shared properties. Zotero imports are tagged with it directly. The
**web tag** (`webTag`, default `Web`) is a class that **`extends`** the base,
inheriting the same property idents. This is deliberately **single base, single
level of inheritance** — the user does not want multi-inheritance tag trees.

**The identity key.** Every imported page carries a `zotero-code` property = the
Zotero item key. This — *not* a name rebuilt from a template — is how the plugin
knows a page is "in the graph" (`zotero-code-index.ts`). So renaming an imported
page in Logseq never breaks the link back to Zotero.

**Two namespacing facts that bite if you don't know them:**

1. The plugin **id** (`logseq-reference-manager`) namespaces every stored
   property: `:plugin.property.logseq-reference-manager/<name>`. It's
   single-sourced as `PLUGIN_ID = pkg.logseq.id` in `constants.ts`. The web
   clipper reads settings under this same id — changing it is a breaking change
   on both sides.
2. Properties are kebab-cased everywhere they touch Logseq (`url`, `date-added`)
   — **except** `ISSN`/`ISBN`/`DOI`, which stay uppercase.

---

## The four subsystems

The plugin is small but has four fairly independent feature areas. Each has a UI
surface (under `features/`) and a cluster of `services/`. Entry points are all
registered in [`index.tsx`](../src/index.tsx) on `logseq.ready`.

### 1. Import (the core)
Pull Zotero items into the graph as tagged pages.
- **Single** — slash `Zotero: Import single item` → cursor-anchored search popup
  (`features/search-item/`). Picks one item, creates its page, links it into the
  current block. Slash-only (needs an active block).
- **Batch** — slash + palette `Zotero: Batch import` → centered modal
  (`features/batch-import/`). Pick many from a search / collection / saved
  search; sequential, cancellable, skips items already in the graph.
- Both flows converge on **`services/handle-zot-db.ts`** — the heart of page
  creation (properties, attachments, tag rules, then annotations).

### 2. Schema setup
Create the base tag + its property schema in the graph before importing.
- **`Reference Manager: Settings`** → the **setup hub** (`features/setup/`), the
  single home for all config. The Schema section's **Apply schema** button calls
  `services/set-logseqdb-schema.ts`.
- The native Logseq settings panel is reduced to a launcher; all real editing
  happens in the hub. (Logseq's settings panel can't render dynamic UI like rule
  builders — see [`logseq-sdk-notes.md`](./logseq-sdk-notes.md) → *Settings
  panel*, and [`settings.md`](./settings.md) for the per-key reference.)

### 3. Annotation import
Import a PDF's annotations as **first-class `Pdf-annotation` highlight blocks**
(clickable, queryable, rendered by Logseq's PDF viewer) — not plain text.
- Runs **automatically at import** (for each on-disk PDF), and on demand via
  page-menu `Zotero: Sync annotations` / palette `Zotero: Sync all annotations`.
- The picking rule (`services/import-annotations.ts`): extract from the PDF file
  itself first (mupdf); if that yields any record, use it and ignore Zotero;
  otherwise fall back to Zotero's DB annotations.
- The extraction core lives in **`services/pdf-annot/`** — a self-contained,
  golden-tested module (originally ported from the `pdf-annot-logseq` prototype,
  now first-party). Its coordinate math is delicate, so the golden tests are the
  guardrail: change the math deliberately and keep them green, don't casually
  refactor.
- Writes via `logseq-transit.ts` (builds the Transit payload) →
  `logseq-import-edn.ts` (POSTs to the Logseq HTTP API). Idempotent by stable
  `:block/uuid`.

### 4. Web references (config only)
Own the schema + capture contract the companion clipper reads.
- The setup hub's **Web references** section edits `webTag` + the capture keys,
  and the **Set up web tag** button makes the web class `extends` the base.
- The clipper *reads* these over the HTTP API but **cannot write** them, so the
  hub is the only editing surface. **Renaming any of these keys — or the plugin
  id — breaks the extension** unless updated in lockstep. The section templating
  contract is in `web-sections.ts`; full handoff context is in the clipper repo's
  `LOGSEQ_SETTINGS_INTEGRATION.md`.

---

## Worked example: importing a single item, end to end

The canonical flow. Conceptual — file names point you in, not at line numbers.

1. **Invoke.** User runs the slash command in a block. `index.tsx` renders
   `ZotContainer` (the search popup) into `#app` and calls `showMainUI()`.
2. **Fetch.** `hooks/use-items.ts` (`useSearchItems`) pulls recents (or, while
   typing, hits Zotero's `q=` search) via `services/get-zot-items.ts`.
3. **Map.** `services/map-items.ts` turns raw `ZotItem[]` into `ZotData[]` —
   joining children, and resolving each item's **in-graph badge** through
   `services/zotero-code-index.ts` (a Zotero-key → page index).
4. **Pick → insert.** On selection, `services/insert-zot-into-graph.ts` calls
   `services/handle-zot-db.ts`:
   - If the item is already in the graph (matched by `zotero-code`), **no page is
     created** — the existing page is linked into the current block. Done.
   - Otherwise: create the page, tag it with `zotTag`, write each property from
     the resolved preset (typed + kebab-cased), apply any matching **tag rules**
     (`extended-tags.ts`), and build the **attachments** block. A `linked_file`
     PDF becomes a first-class *asset block* (which is what activates Logseq's
     embedded PDF viewer + annotation tooling).
5. **Annotations.** After the page is built, `handle-zot-db.ts` runs the
   annotation importer for each on-disk PDF asset (subsystem 3 above).
6. **Link.** The new (or existing) page is linked back into the block the user
   was editing; `hideMainUI()` dismisses the popup.

Batch import is the same minus steps 1/6: `services/batch-insert-into-graph.ts`
loops `handleZotInDb(item, …, { navigate: false })` over the selection, building
the in-graph index once and reusing it.

---

## A few conventions that will save you confusion

- **No backward-compat shims for stored data shapes.** When a stored shape
  changes (a heading name, a setting key, a property), the codebase writes the
  *new* shape only — no migration readers, no legacy constants. The user
  re-imports / re-applies trivially and prefers a clean codebase. Flag breaking
  changes explicitly. (See [`CLAUDE.md`](../CLAUDE.md) → *Backward compatibility*.)
- **`logseq.settings` is global, not per-graph.** Anything graph-specific must be
  derived by *querying the graph*, never cached in a setting. (This bit the
  schema-applied state — see [`logseq-sdk-notes.md`](./logseq-sdk-notes.md).)
- **Pure logic is unit-tested; SDK-touching code is not.** Tests
  (`*.test.ts`, run by `bun test`) cover pure functions — template resolution,
  tag-rule matching, the `pdf-annot` core, geometry, keyboard intent. Anything
  that calls `@logseq/libs` or the network is verified manually against a running
  graph.
- **The `@logseq/libs` SDK has sharp edges.** Property deletion, type-locks that
  *hang* the SDK, `hide?` gotchas, theming that doesn't cascade into the iframe —
  all documented empirically in [`logseq-sdk-notes.md`](./logseq-sdk-notes.md).
  Check there first when an SDK call misbehaves.

---

## Where to go next

- [`module-map.md`](./module-map.md) — the directory-by-directory map and a
  "I want to change X, where do I look?" table.
- [`CLAUDE.md`](../CLAUDE.md) — the exhaustive reference: every command, every
  setup-hub section, the full data-flow spec, design context.
- [`README.md` in this folder](./README.md) — index of the deep-dive notes
  (SDK quirks, file links, Zotero paths) and when to reach for each.
- [`settings.md`](./settings.md) — every settings key, how to add one, the
  hidden-keys mechanism.
