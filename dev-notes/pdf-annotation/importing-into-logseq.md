# Bringing annotations (and blocks) into Logseq

How data actually gets written into a Logseq **DB graph**. This doc is centered on
PDF annotations — the reason this subsystem exists — but the mechanism (an EDN
"build" payload handed to Logseq's importer, delivered as Transit-JSON over the
desktop HTTP API) is general: it is the same way you would inject *any* typed block
into a DB graph from a plugin.

Logseq has no built-in way to import the annotations you already made in Preview,
Zotero, Acrobat, or Skim. It will *render* a PDF's baked-in annotations through
PDF.js, but it has no data awareness of them — you cannot click, link, query, or
backlink them. The plugin re-creates each annotation as a **first-class Logseq
annotation block** so it joins the knowledge graph. This document explains the
ingestion half of that pipeline.

> Audience: a developer working on the write path. You should come away able to
> author a valid import payload, attach blocks under an existing asset without
> corrupting it, deliver the write over the HTTP API, and generalize the approach.

> **See also:** [`architecture.md`](./architecture.md) for the end-to-end pipeline
> and the coordinate transform (§4) that produces the geometry referenced here,
> [`overview.md`](./overview.md) for the non-technical summary, and
> [`typescript-port.md`](./typescript-port.md) for the engine that produces the records.

Source-of-truth files (in this repo unless noted):

- Build map + Transit encoder: `src/services/logseq-transit.ts`
  (`buildLiveImportMap` / `transitWrite`)
- The HTTP POST + error handling: `src/services/logseq-import-edn.ts`
  (`importAnnotationRecords`)
- The canonical EDN serializers (golden-tested byte-shape the Transit encoder
  mirrors): `src/services/pdf-annot/edn.ts` (`emitLiveEdn`)
- The orchestrator that produces the records: `src/services/import-annotations.ts`
- Logseq importer (the actual writer): `/Users/rahulsomani/git/logseq/deps/db/src/logseq/db/sqlite/export.cljs`
  and `.../sqlite/build.cljs`

---

## 1. The mental model

A Logseq DB graph **is a Datascript database** (persisted in SQLite as a key/value
store of datoms). Everything — pages, blocks, properties, classes/tags — is an
entity with attributes. There is no Markdown file to append to; you change the
graph by **transacting datoms**.

You do not hand-write datoms. Instead you hand Logseq a high-level, human-readable
EDN **build payload**, and a function called `build-import` turns it into the
transaction for you. That function is `logseq.db.sqlite.export/build-import`; the EDN
dialect it consumes is defined by `logseq.db.sqlite.build`. The CLI, the desktop
app's "Import EDN" dialog, and the HTTP API all funnel through this same
`build-import` — so **the payload format is identical no matter how you deliver it.**
Learn the format once. (How the plugin *delivers* it — Transit-JSON over the HTTP API
— is §4.)

### The payload shape

Top level is a map with exactly three keys:

```clojure
{:pages-and-blocks [ ... ]   ; the content: a vector of {:page {...} :blocks [...]}
 :properties       {}        ; user-defined property definitions (usually empty)
 :classes          {}}       ; user-defined classes/tags (usually empty)
```

`:pages-and-blocks` is a vector of entries, each `{:page <page-map> :blocks
[<block-map> ...]}`. The `:page` names the page the blocks land on (created if it
does not exist); each block map describes one block.

Inside a block map, the DSL uses a few `:build/*` convenience keys that
`build-import` expands:

| Key | Meaning |
|---|---|
| `:build/tags [:logseq.class/...]` | tag the block with one or more classes (becomes `:block/tags`, each resolved to `{:db/ident ...}`) |
| `:build/properties {<ident> <value>}` | set typed/internal properties by their db-ident (handles closed-value refs, typed values, EDN-map values) |
| `:build/keep-uuid? true` | preserve the `:block/uuid` you supplied instead of minting a new one — **this is what makes re-import idempotent** |
| `:build/children [...]` | nested child blocks (the Zotero path uses this for a highlight's comment) |

Plain block attributes (`:block/uuid`, `:block/title`, `:block/parent`,
`:block/collapsed?`) are written through as-is.

The crucial property of `:build/properties` (and why the plugin uses this path at
all) is that it sets **internal idents directly** — including a closed-value
reference like `:logseq.property.pdf/hl-color :logseq.property/color.yellow` and an
EDN **map** value like `:logseq.property.pdf/hl-value {...}`. No sanitization, no
coercion to a user-property string. That is exactly what a PDF annotation needs and
what the `@logseq/libs` Editor API cannot do (see §5).

---

## 2. The annotation block schema

A Logseq PDF annotation is an ordinary block that (a) is tagged with the
`:logseq.class/Pdf-annotation` class, (b) carries a fixed set of typed properties,
and (c) points at the PDF's asset block. The class **requires** these five
properties (`deps/db/src/logseq/db/frontend/class.cljs`): `:logseq.property/ls-type`,
`:logseq.property.pdf/hl-color`, `:logseq.property/asset`, `:logseq.property.pdf/hl-page`,
`:logseq.property.pdf/hl-value`. Omit one and the block is invalid.

### Full attribute set (text highlight)

| Attribute | Type | Value |
|---|---|---|
| `:build/tags` | class ref | `[:logseq.class/Pdf-annotation]` |
| `:block/title` | string | the highlighted text (or, for a note, the note text). This is the readable body and what shows in the annotation list. |
| `:logseq.property/ls-type` | keyword | `:annotation` (constant) |
| `:logseq.property/asset` | entity ref | the PDF **asset block** (`[:block/uuid #uuid "..."]`). **This is the key the viewer's loader query uses** — see §3. |
| `:logseq.property.pdf/hl-color` | closed-value ref | one of `:logseq.property/color.{yellow,red,green,blue,purple}` (a db-ident, *not* the string) |
| `:logseq.property.pdf/hl-page` | int | 1-based page number |
| `:logseq.property.pdf/hl-value` | EDN map | the full geometry/content record (sub-shape below) |

The renderer reads geometry and color **only** from `hl-value` at render time; the
individual `hl-page`/`hl-color` properties exist for queries and for the annotation
list.

### The `hl-value` sub-shape

`hl-value` is the entire highlight map that the live app persists verbatim. Its
position fields are the `viewportToScaled` output — keys `{:x1 :y1 :x2 :y2 :width
:height}`, **not** `{:left :top ...}`. Read-back (`scaledToViewport`) **throws** `"You
are using old position format"` if `:x1` is missing, so every rect — `:bounding` and
each `:rects` entry — must carry all six numbers.

```clojure
{:id        #uuid "..."         ; MUST equal the block's :block/uuid
 :page      3                    ; 1-based int (also grouping key at render)
 :position  {:page     3
             :bounding {:x1 .. :y1 .. :x2 .. :y2 .. :width 612.0 :height 792.0}
             :rects    [{:x1 .. :y1 .. :x2 .. :y2 .. :width 612.0 :height 792.0} ...]}
 :content   {:text "the highlighted text"}   ; NO :image key for a text highlight
 :properties {:color "yellow"}}              ; lowercase NAME string (matches hl-color)
```

Notes on the geometry (full derivation in [`architecture.md`](./architecture.md) §4):

- `:width`/`:height` are the page dimensions in points at scale 1.0 (e.g. US-Letter
  `612.0 × 792.0`). Read-back is proportional, so storing the rect verbatim in PDF
  points (top-left origin, y-down) makes it scale-independent.
- `:rects` is one entry per visual line (per QuadPoints quad), sorted top→left.
  `:bounding` is the union of those rects. Keep `:rects` non-empty for a text
  highlight or it will not be clickable/visible.
- Store floats with a decimal point so the EDN reader yields a double — the live app
  does no rounding. (`pdf-annot/edn.ts`'s `ednFloat` renders integral values as
  `"N.0"`; the Transit encoder sends them as JSON numbers, which the reader also
  treats as doubles.)

### Area-highlight extras

An area highlight (a rectangular region crop, e.g. a figure) adds the following on
top of the base block, and routes to the area renderer because
`(get-in hl [:content :image])` is truthy:

- `:logseq.property.pdf/hl-type :area`
- `:logseq.property.pdf/hl-image [:block/uuid #uuid "<png-asset>"]` — a ref to a
  **PNG asset block** (a second asset, with real bytes/size/checksum)
- `:block/collapsed? true`
- in `hl-value`: `:content {:text "" :image [:block/uuid #uuid "<png-asset>"]}`
  and `:rects []` (area highlights have no per-line rects)
- `:block/title` is conventionally a locale date string rather than covered text

The plugin does **not** emit area highlights (no portable source equivalent yet, and
it would require generating PNG assets); they are documented for completeness.

### A literal, annotated text-highlight block

A real text-highlight block from the golden fixture (a red sticky-note on page 1),
with inline commentary. Page dims are rounded to 3 dp for readability; the asset uuid
is a placeholder — at import it's the uuid of the PDF asset block the plugin just
created.

```clojure
{:block/uuid #uuid "b5d9eea7-ca28-4f7c-9b00-87a84bf88763"   ; == hl-value :id
 :block/title "Make sure to check these out!"               ; the note's text
 ;; THE ATTACH TRICK (see §3): parent under the existing PDF asset block by uuid,
 ;; but do NOT re-declare that asset block anywhere in this payload.
 :block/parent {:db/id [:block/uuid #uuid "6a189ba1-a16a-4f18-b563-daacc36dc98d"]}
 :build/keep-uuid? true                                     ; idempotent re-import
 :build/tags [:logseq.class/Pdf-annotation]                 ; the class
 :build/properties
 {:logseq.property/ls-type :annotation
  :logseq.property/asset [:block/uuid #uuid "6a189ba1-a16a-4f18-b563-daacc36dc98d"] ; loader key
  :logseq.property.pdf/hl-color :logseq.property/color.red   ; closed-value db-ident
  :logseq.property.pdf/hl-page 1
  :logseq.property.pdf/hl-value
  {:id #uuid "b5d9eea7-ca28-4f7c-9b00-87a84bf88763"          ; same uuid again
   :page 1
   :position {:page 1
              :bounding {:x1 492.725 :y1 136.657 :x2 510.725 :y2 154.657
                         :width 595.276 :height 841.89}
              :rects [{:x1 492.725 :y1 136.657 :x2 510.725 :y2 154.657
                       :width 595.276 :height 841.89}]}
   :content {:text "Make sure to check these out!"}
   :properties {:color "red"}}}}
```

A markup highlight that wraps across lines has one `:rects` entry per visual line, with
a `:bounding` that is their union — e.g. this 3-line underline from the same fixture:

```clojure
:position {:page 1
           :bounding {:x1 106.732 :y1 432.545 :x2 488.545 :y2 464.395 :width 595.276 :height 841.89}
           :rects [{:x1 426.009 :y1 432.545 :x2 488.545 :y2 442.477 :width 595.276 :height 841.89}
                   {:x1 106.732 :y1 443.504 :x2 488.543 :y2 453.436 :width 595.276 :height 841.89}
                   {:x1 106.732 :y1 454.463 :x2 382.46  :y2 464.395 :width 595.276 :height 841.89}]}
```

On the **Zotero path**, a highlight's comment is attached as a child block:

```clojure
 :build/children
 [{:block/uuid #uuid "<comment-uuid>"
   :block/title "my note about this passage"
   :build/keep-uuid? true}]
```

The color closed-value db-idents are fixed: `yellow → :logseq.property/color.yellow`,
and likewise `red`, `green`, `blue`, `purple`. There are exactly five — no orange, no
custom hex. The block property stores the **db-ident**; the `:properties {:color
"..."}` inside `hl-value` stores the lowercase **name** string. (Passing the string
`"yellow"` to `hl-color` instead of the db-ident fails the build with `"Tempids used
only as value"`.)

---

## 3. The asset block, and the trick to attach under it

### What an asset block is

A PDF is registered in a DB graph as an **asset block**: a block tagged
`:logseq.class/Asset` carrying the file's metadata. The `Asset` class requires
`[:type :size :checksum]`. For an **external** file (the Zotero case) the literal
shape is:

```clojure
{:block/uuid    #uuid "6a189ba1-a16a-4f18-b563-daacc36dc98d"
 :block/title   "paper"                                       ; basename, sans ".pdf"
 :block/tags    #{:logseq.class/Asset}
 :logseq.property.asset/type         "pdf"
 :logseq.property.asset/external-url "file:///Users/you/Zotero/storage/ABCD/paper.pdf"
 :logseq.property.asset/size         0                        ; external => no local bytes
 :logseq.property.asset/checksum     "<sha256-hex of the external-url STRING>"}
```

Two non-obvious details for an external file: `size` is `0` (no local file is
written), and `checksum` is the **SHA-256 of the external-url string itself**, not of
the file bytes. **In this plugin these asset blocks are created by the import flow**
(`handle-zot-db.ts`, for `linked_file` PDFs) — the annotation subsystem only finds
and attaches to them, it does not create them.

### How the viewer finds highlights

The PDF viewer loads highlights with one Datascript query (`assets.cljs`):

```clojure
[:find (pull ?e [*]) :where [?e :logseq.property/asset ?asset-eid]]
```

That is, it finds every block whose `:logseq.property/asset` points at the asset
block. **It does not care about the tree parent.** A highlight renders as long as it
carries that ref. This is liberating: correctness of rendering depends on the
`:logseq.property/asset` ref, not on where the block sits in the outline.

### The attach trick (important and non-obvious)

We still want the annotations to live where Logseq natively puts them — as children
of the asset block, on the PDF's reference page — so the graph matches hand-made
annotations. But we must do this **without re-stating the asset block**, because
`build-import`'s deduplication is narrow. `check-for-existing-entities`
(`export.cljs`) only reconciles three things against the existing graph:

- **pages** in `:pages-and-blocks` — matched by `:block/title`,
- **classes** — matched by db-ident,
- **properties** — matched by db-ident.

It does **not** dedupe arbitrary nested blocks. So if you put the asset block into the
payload as a nested block, the importer treats it as new content and will re-parent or
duplicate it — corrupting the real asset. Therefore: **reference the asset by uuid;
never re-declare it.**

The technique `buildLiveImportMap` (`logseq-transit.ts`, mirroring `edn.ts`'s
`emitLiveEdn`) uses:

1. **Declare the blocks under the existing reference page, matched by title.** The
   payload's single `:page` is `{:block/title "<the reference page>"}`. Because page
   dedup matches by title, `build-import` recognizes this as the existing page and
   only minimally touches it (it injects the existing `:block/uuid` and otherwise
   leaves it alone). This sets each new block's `:block/page` to that real page. The
   plugin sources the exact page title from a scalar Datascript query in
   `find-pdf-asset.ts` so it matches `build-import`'s `ldb/get-case-page` lookup.

2. **Set `:block/parent` explicitly to the asset block by uuid** on every block:
   `:block/parent {:db/id [:block/uuid #uuid "6a189ba1-...]}`. The build DSL honors an
   explicit `:block/parent` (`build.cljs:249`,
   `:block/parent (or (:block/parent m) {:db/id page-id})`): it uses your value when
   present and only falls back to the page otherwise. So the annotations become
   children of the asset block while their `:block/page` stays the reference page,
   exactly mirroring native structure.

3. **Carry `:logseq.property/asset` pointing at the same asset uuid** so the loader
   query finds them. (This is what actually makes them render; the parent is
   cosmetic/structural.)

### Finding the asset block

At fresh import the plugin already holds the asset block's uuid (it just created it).
For the **Sync** path it doesn't, so `find-pdf-asset.ts` walks the page's block tree
and matches each block's `:logseq.property.asset/external-url` (decoding the `file://`
URL back to a path) and reads the plugin's `zotero-attachment-key` (for the Zotero
fallback). The asset's `external-url` is the most reliable key.

---

## 4. The write: Transit-JSON over the desktop HTTP API

The plugin can't shell out to a CLI, so it delivers the build payload over Logseq's
**desktop HTTP API server** (`Settings → Features → HTTP APIs Server`). The transport
is `src/services/logseq-import-edn.ts` (`importAnnotationRecords`).

### The request

```
POST http://127.0.0.1:12315/api
Authorization: Bearer <logseqApiToken>
Content-Type: application/json

{"method": "logseq.cli.import_edn", "args": ["<TRANSIT-JSON string of the build map>"]}
```

- The base URL defaults to `LOGSEQ_API_BASE_DEFAULT` (`http://127.0.0.1:12315`) and is
  overridable via the `logseqApiBaseUrl` setting; the token is the `logseqApiToken`
  setting. Both are set in the setup hub's **Annotations** section.
- The method `logseq.cli.import_edn` routes through the running app to `build-import`
  and transacts. Because the *app* performs the transaction, the SQLite lock it holds
  is a non-issue.

### Why Transit-JSON, not raw EDN

Despite the method name, `logseq.cli.import_edn` expects its single arg to be a
**Transit-encoded** string of the build map — *not* an EDN string. (`@logseq/cli`'s
own `import_edn` command reads the EDN file, parses it, and sends
`(sqlite-util/transit-write import-map)`; the plugin produces that Transit form
directly, skipping the EDN round-trip.) `logseq-transit.ts` hand-encodes **uncached**
Transit-JSON (cognitect transit-json):

- map → `["^ ", k0, v0, k1, v1, ...]` (the `"^ "` map marker)
- keyword → `"~:" + name` (`:block/uuid` → `"~:block/uuid"`)
- uuid → `"~u" + uuid-string`
- string → as-is, unless it begins with `~`, `^`, or `` ` ``, which is escaped with a
  single leading `~` (so annotation text starting with one of those isn't mis-read as
  a tagged value)
- number / boolean / array → native JSON

`buildLiveImportMap` builds the value tree and `transitWrite` serializes it. It is
kept a faithful mirror of `pdf-annot/edn.ts`'s `emitLiveEdn` (the golden-tested
byte-shape), so the two encoders can't silently diverge.

### Reading the result

A successful import returns `null`. But the desktop API wraps a *thrown* method in
**HTTP 200 + a JSON `{error: …}` body** — a `build-import`/transact rejection still
returns 200. So `importAnnotationRecords` inspects the body, not just the status: a
non-empty `{error}` (or a non-2xx status) raises `LogseqApiError`. `testLogseqApi`
does the same lightweight check against `logseq.App.getCurrentGraph` to power the
Annotations section's "Test" button.

---

## 5. Write paths considered and rejected

Two other ways to write into a DB graph were evaluated and dropped:

- **Plugin API — `logseq.Editor.upsertBlockProperty` / `insert_block`.** Rejected:
  `upsert_block_property` routes the key through user-property *sanitization*
  (`sanitize-user-property-name` + `get-db-ident-from-property-name`). It cannot
  reliably set an internal db-ident closed-value ref like
  `:logseq.property.pdf/hl-color :logseq.property/color.yellow` or an EDN-**map** value
  like `:logseq.property.pdf/hl-value {...}`. It is built for user properties, not
  internal typed schema. (`insert_block` can make the empty child shell, but the typed
  properties still need the EDN-import path.)

- **Direct Datascript / SQLite writes.** Rejected: it reinvents `build-import`
  (closed-value resolution, validation, ordering) by hand, carries real corruption
  risk, and the live DB is locked by the running app anyway.

The `build-import` path (delivered as Transit over the HTTP API) avoids all three
problems: it produces the exact internal schema, runs through Logseq's own validated
builder, and lets the app own the transaction.

---

## 6. Safety, idempotency, and undo

**Additive.** Import only adds new blocks. Nothing existing is modified — the asset
block, the reference page's other children, and the page itself are left intact (page
reconciliation only injects the existing uuid).

**Idempotent via kept UUIDs.** Every annotation block sets `:build/keep-uuid? true`
and uses a stable `:block/uuid`:
- **PDF path** — reuses the PDF annotation's `/NM` id when it is a well-formed UUID
  (`pdf-annot/convert.ts` `pickUuid`).
- **Zotero path** — derives a deterministic RFC-4122 v5 UUID from `(libraryID, key)`
  (`pdf-annot/uuid.ts`); the child comment block uses the same derivation with a
  `"comment"` suffix.

Re-running an import (via *Sync annotations*) therefore **upserts by `:block/uuid`** —
no duplicates.

**Isolation, not a dry run.** The Python prototype validated each import by writing to
a `/tmp` copy of the graph's SQLite first and inspecting it with `export-edn`. The
plugin has no offline mode; instead its safety net is: (1) the build is purely
additive, (2) idempotent uuids mean a re-run can't duplicate, (3) the at-import call
is best-effort and isolated (a failure never fails the item import — `handle-zot-db.ts`
catches per-PDF; `import-annotations.ts` isolates per-target and per-page), and (4)
`importAnnotationRecords` detects the HTTP-200-with-`{error}` failure mode so a
rejected transaction surfaces instead of silently "succeeding."

**Undo.** Because the import is purely additive and the annotations are uniquely
identifiable, undo is a targeted delete: remove the `:logseq.class/Pdf-annotation`
blocks under the asset (by their kept UUIDs, or by the asset-ref query in §3).
Nothing else needs reverting.

---

## 7. Generalizing

The same machinery imports far more than one PDF's highlights.

**Other block types.** Anything you can describe with the build DSL imports the same
way: pick the class (`:build/tags`), set its required properties via
`:build/properties` using their db-idents, keep a stable `:block/uuid`, and either let
the block land on its page or `:block/parent` it under an existing entity. The
PDF-annotation block is just one instance of this pattern; the asset-attach trick in
§3 generalizes to "attach new children under any existing block without re-declaring
that block — reference it by uuid, match its host page by title."

**Many PDFs / batch.** Batch import already runs the annotation importer per item.
The interchange format is the contract: as long as a producer emits the
`{:pages-and-blocks [...] :properties {} :classes {}}` DSL with the right tags,
db-ident properties, and kept UUIDs, the source (mupdf here, Zotero's DB, anything
else later) is irrelevant to the Logseq side. The one case left out is an
`imported_file` PDF whose bytes aren't on this machine — it gets no asset block to
attach to (see [`architecture.md`](./architecture.md) §7).
