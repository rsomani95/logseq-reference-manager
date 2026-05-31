# Extracting Annotations from Zotero

How the plugin reads annotations out of **Zotero** and turns them into Logseq
DB-graph annotation records — the fallback source, used when a PDF file carries no
embedded markup of its own.

It is the companion to two sibling docs:

- [`pdf-annotations-across-platforms.md`](./pdf-annotations-across-platforms.md) explains the PDF/ISO-32000 annotation taxonomy and how each app (Preview, Acrobat, PDF Expert, **and Zotero**) maps onto it. Read its §4–§6 first for *what* Zotero's annotation model is.
- [`importing-into-logseq.md`](./importing-into-logseq.md) defines the **target**: the `:logseq.class/Pdf-annotation` block and its `hl-value` geometry sub-shape. Everything below produces exactly that shape.

This doc is about the **source side for Zotero specifically**: where the data lives,
its format, and its quirks/shortcomings. It focuses on annotations made **inside
Zotero's own PDF reader** (the case the fallback path relies on), with a short section
(§8) on what Zotero does to annotations imported from an externally-annotated PDF.

> **The fork that motivates all of this.** A PDF you annotated *outside* Zotero
> (PDF Expert, Preview…) carries its marks **inside the file's `/Annots`** — read those
> with the mupdf path ([`architecture.md`](./architecture.md)). A PDF you annotated
> *inside* Zotero has **nothing in the file**; the marks live only in Zotero's database
> and must be read via the API described here. See §9 for the ingestion policy that
> chooses between the two.

---

## 1. Where Zotero stores annotations, and how to fetch them

Zotero keeps annotations in its **own SQLite database, not in the PDF** (this is the
deliberate design that lets it sync without rewriting files — see
`pdf-annotations-across-platforms.md` §4). They are exposed through the **local HTTP
API** (the same Zotero local API the plugin already talks to in
`services/get-zot-items.ts`) as `annotation` items.

Items nest **three deep** — an annotation is a *grandchild* of the regular item:

```
parent item  (e.g. a preprint)
└── attachment  (the PDF; itemType "attachment")
    └── annotation  (itemType "annotation")   ← the marks live here
```

The annotation importer already holds the **attachment key** (from the PDF asset
block — `find-pdf-asset.ts` reads the plugin's `zotero-attachment-key` property, or
the at-import flow passes it through), so it fetches annotations in **one** call off
that attachment:

```
GET /items/<attachmentKey>/children?itemType=annotation
```

`getRawAnnotationsForAttachment` (`services/get-zot-items.ts`) does exactly this and
returns `{ annotations, libraryID }`. Note the **library id** (from any item's
`library.id`): it is not used for placement, but is folded into each annotation's
stable identifier (§7).

---

## 2. The annotation `data` shape

A Zotero annotation item's `data` (the fields consumed by `ZoteroAnnotationData`;
others — `version`, `dateAdded`, `tags` — are ignored):

| field | meaning | present on |
|---|---|---|
| `key` | the annotation item's key (8 chars, e.g. `IHJYKJEF`) — unique within the library | all |
| `annotationType` | `highlight` · `underline` · `note` · `text` · `image` · `ink` | all |
| `annotationPosition` | **JSON-encoded string** with the geometry (§3) | all |
| `annotationText` | the **covered text** (Zotero already extracted it) | markup (highlight/underline) |
| `annotationComment` | the user's typed note | note/text always; markup if commented |
| `annotationColor` | a hex string, e.g. `#f19837` | all |
| `annotationSortIndex` | reading-order key, e.g. `00004\|000738\|00185` | all |
| `annotationPageLabel` | the page's printed label (`"7"`) | all |
| `annotationAuthorName` | author (often empty in a personal library) | all |

The six `annotationType` values are Zotero's *authoring* model, **not** PDF subtypes,
and the names are **swapped relative to the spec**: Zotero `note` ≈ PDF `Text` (sticky
note), Zotero `text` ≈ PDF `FreeText` (typewriter box). See
`pdf-annotations-across-platforms.md` §5 for the full mapping table.

---

## 3. `annotationPosition` — the geometry (the crux)

`annotationPosition` is a **string** you must `JSON.parse` (`parseZoteroPosition` in
`zotero.ts` does it defensively — it's an opaque string from an external system).
Shapes by type:

```jsonc
// highlight / underline — one rect per covered line:
{"pageIndex":4,"rects":[[337.296,679.512,525.656,689.096],[70.448,668.553,524.408,678.137], …]}

// note / text — a single anchor box (text also carries fontSize/rotation):
{"pageIndex":6,"fontSize":6,"rotation":0,"rects":[[10.192,255.929,93.605,330.929]]}
```

- `pageIndex` is **0-based** (page 1 is `pageIndex: 0`).
- Each rect is `[x1, y1, x2, y2]` in **PDF user space — points, origin bottom-left, y-up** — i.e. the *same* space as the file's `/Rect` and `/QuadPoints`, **not** viewport pixels. So `y1`/`y2` are the bottom/top edges with `y1 < y2`, and a higher `y` is higher on the page.
- Zotero has **already decoded `/QuadPoints` into per-line rects**, so there is no quad math on this path — each entry is one line band, ready to transform.

Because it's the same space as the PDF path, the geometry reuses the **validated
transform** in [`architecture.md`](./architecture.md) §4 verbatim: per rect,
`flipRect(rect, pageH)` → fitz top-left space, then `toStored(_, pageW, pageH)` →
Logseq's stored `{x1,y1,x2,y2,width,height}`; the union of a markup's rects is its
bounding box (all from `geometry.ts`).

**Empirically confirmed.** The same passages were annotated in a PDF-Expert copy (read
by mupdf) and in a Zotero copy. Transforming the live Zotero rects reproduces the
mupdf-derived golden rects **to 3 d.p.** wherever both viewers selected the same span;
residuals are a systematic ≈0.35 pt top-edge difference (sub-pixel line-box
interpretation) and the occasional genuine selection difference (one viewer grabbing a
leading word the other didn't). `zotero.test.ts` includes a cross-path geometry check
against the PDF-path golden.

### The one thing Zotero does *not* give you: page dimensions

`annotationPosition` carries no page width/height, and a Zotero-annotated file has no
`/Annots` to read them from indirectly. The flip needs `pageH`, and the stored rect
records `width`/`height` (= the page dims) so Logseq's proportional read-back is
scale-independent. So the plugin **reads page geometry from the PDF file itself** —
`pdf-pages.ts:pageGeometriesFromBytes()` walks *every* page (the mupdf `extract()` only
records pages that already have `/Annots`, which a Zotero-annotated file does not).
This is the only reason the Zotero path still needs the PDF on disk. Path resolution is
discussed in §6.

---

## 4. How each Zotero type is captured into Logseq

Logseq has only two annotation constructs: a 5-color **text-highlight** (a band over
`:rects`) and an **area highlight** (a cropped-region image). The plugin emits only
the former.

| Zotero type | Captured as | Block title (`hl-value` `:content`) | Comment |
|---|---|---|---|
| `highlight` | text-highlight band over the rects | `annotationText` (covered text) | `annotationComment` → **child block** |
| `underline` | text-highlight band over the rects | `annotationText` (covered text) | `annotationComment` → **child block** |
| `note` (sticky) | text-highlight anchored at the single box rect | `annotationComment` (the note body) | — (the note *is* the comment) |
| `text` (typewriter) | text-highlight anchored at the single box rect | `annotationComment` (the typed text) | — |
| `image` (area) | **skipped** (warned + tallied) | — | needs the PNG-crop construct, not built |
| `ink` | **skipped** (warned + tallied) | — | no text-highlight equivalent |

Notes:

- **Comments on a highlight/underline become a nested child block** (`:build/children`
  in the payload — see [`importing-into-logseq.md`](./importing-into-logseq.md) §2), so
  your commentary reads as a child of the highlight — Logseq's idiom, and richer than
  the PDF path, which currently drops a markup's `/Contents`. For `note`/`text` the
  comment *is* the body, so it becomes the block title with no child.
- **Reading order** comes straight from `annotationSortIndex` (a fixed-width,
  zero-padded string) — a lexicographic sort yields Zotero's own order, columns handled
  correctly. Records are emitted in that order (`bySortIndex` in `zotero.ts`).
- **Color** is `annotationColor` (a hex) mapped to the nearest of Logseq's five pastels
  via the shared `colors.ts` (`colorFromCss` → `mapColor`). This is lossy by design —
  e.g. Zotero orange `#f19837` and yellow `#ffd400` both land on Logseq `yellow`.
  (Ballpark color is acceptable here; the **Annotations** setting can force one flat
  color instead.)

The output is the **same `ConvertedRecord` / `hl-value` / EDN** the PDF path produces,
so the EDN/Transit serializers and the write path need no changes
(`convertZoteroAnnotations` returns the same `ConvertResult` as `convert`).

---

## 5. Quirks & shortcomings of the Zotero source

- **The covered text is Zotero's, not ours.** `annotationText` is whatever Zotero's
  text layer extracted under the selection. It's convenient (no structured-text
  reconstruction needed, unlike the PDF path) but viewer-dependent: the same visual
  highlight can yield slightly different text/rects than another reader would.
- **Color is quantized to 5 buckets** (above). The original hex is preserved on the
  record as `src_color_hex` for diagnostics, but the imported highlight uses the
  nearest pastel.
- **`image` and `ink` are dropped.** Area/figure regions have no portable
  text-highlight representation (`pdf-annotations-across-platforms.md` §6); supporting
  them means building the area-highlight PNG path
  ([`importing-into-logseq.md`](./importing-into-logseq.md) §"Area-highlight extras").
- **Rotated pages are unvalidated.** As on the PDF path, a non-zero page rotation emits
  rot-0 geometry with a warning.
- **Needs the PDF on disk for page dims** (§3) — see §6.

---

## 6. Resolving the PDF file (for page geometry)

The Zotero path needs the attachment's bytes only to read page dimensions
(`read-pdf-bytes.ts` reads them off the asset block's `file://` path). What's
available depends on the attachment's `linkMode`:

- **`linked_file`** (a link to a file left in place — including everything moved by
  **ZotMoov**) exposes an absolute `data.path`; the plugin turns the PDF into an asset
  block and reads the bytes off it. **Handled.**
- **`imported_file` / `imported_url`** (copied / snapshotted into Zotero storage)
  resolve through Zotero's `links.enclosure` (a `file://` URL → on-disk path; see
  [`../zotero-attachment-paths.md`](../zotero-attachment-paths.md)). The plugin
  asset-blocks these too, **gated on `enclosure.length`** — Zotero sets it only when the
  stored bytes are actually present. So an imported PDF whose bytes were never synced to
  this machine has no asset block, hence no page geometry and no annotation import;
  everything else is **handled**.

---

## 7. Identity & idempotent re-sync

A Zotero annotation `key` (e.g. `IHJYKJEF`) is unique within the library but is **not a
UUID**, so it can't be used directly as a Logseq `:block/uuid`. The plugin derives a
**deterministic RFC-4122 v5 UUID** from `(libraryID, key)` (`uuid.ts`,
`uuidForZoteroAnnotation`). Because it's deterministic, re-syncing the same annotation
produces the same block uuid, so an import with `:build/keep-uuid? true` **upserts
instead of duplicating**. The child comment block gets its own stable uuid (the same
derivation with a `"comment"` suffix).

This mirrors how the PDF path reuses an annotation's `/NM` UUID for idempotency
([`importing-into-logseq.md`](./importing-into-logseq.md) §6) — Zotero just doesn't
hand us one, so the plugin synthesizes a stable one. (`uuid.ts` vendors a SHA-1 so it
needs neither `node:crypto` nor the async `crypto.subtle`, keeping the converter
synchronous and renderer-safe; a known-answer test covers it.)

---

## 8. What Zotero imports from an *externally*-annotated PDF (and what's lost)

When you open a PDF that was annotated **outside** Zotero (PDF Expert, Preview…),
Zotero **reads the embedded `/Annots` and imports them into its own database**,
translating them into the *same* Zotero annotation schema described above.
Consequences, verified on a real file (PDF Expert copy: 10 marks → Zotero shows 7):

- **They are schema-identical to native ones.** Via the local API there is **no field
  that distinguishes imported-from-PDF from Zotero-native** — same `annotationType`,
  same `annotationPosition`, etc. (Zotero flags them `isExternal`/read-only
  *internally*, in its SQLite, but **the local API does not surface that flag**.)
- **`FreeText` / typewriter-`text` boxes are dropped.** Zotero's importer brings in
  highlight/underline/note but **does not import typed text boxes** as editable
  annotations — it bakes them into the rendered page appearance instead (they look
  "burnt in" and are often truncated). On the test file this is exactly the **10 → 7**
  difference (3 typed margin notes lost).
- **Colors are preserved verbatim** from the source app — e.g. PDF Expert's `#ff8000` /
  `#ffcca1` / `#fcf5a4`, which are *not* Zotero palette colors.
- **Soft tells only:** imported annotations tend to show `version: 0` and carry the
  source app's raw (non-Zotero-palette) colors. Neither is a reliable discriminator on
  its own.

So if you want a file's annotations and it was annotated externally, **the file is a
strictly better source than Zotero's import**: the mupdf path reads everything,
including the `FreeText` boxes Zotero drops.

---

## 9. Ingestion policy: PDF-first short-circuit

Because external annotations are indistinguishable inside Zotero's API (§8), the **PDF
file is the reliable discriminator**, not the database. `import-annotations.ts`
(`importAnnotationsForAsset`) implements it:

1. **Inspect the PDF file first.** Run `convert(extract(bytes))`. If that yields **any
   renderable record**, the file was annotated externally → use the **mupdf path**,
   which also recovers the dropped `FreeText`.
2. **Only if it yields zero records**, fall back to the **Zotero database path**
   described here (the file was annotated inside Zotero, or not at all).

The decision keys off **converted records**, not the bare presence of an `/Annots`
entry — a file whose only marks are `Link`/`Popup`/ink/stamps/form-field widgets
converts to zero records and correctly falls through. (An academic PDF can carry
hundreds of `Link` annotations that are not user markup, so "has annotations" must mean
"has real markup.") If a file was annotated in *both* places, PDF-first deliberately
ignores the Zotero-native marks — an accepted simplification (pick one source
explicitly); the only true external-vs-native discriminator would be Zotero's internal
`isExternal`, reachable only by reading Zotero's SQLite directly.

---

## 10. Where this lives in the code

- `src/services/pdf-annot/zotero.ts` — `convertZoteroAnnotations(annots, pageMeta, opts)` + `parseZoteroPosition`: the parser + converter (§3–§4). Pure (no fs/mupdf): takes parsed annotations + page geometry, returns a `ConvertResult`.
- `src/services/pdf-annot/pdf-pages.ts` — `pageGeometriesFromBytes(bytes)`: all-page geometry via mupdf (§3).
- `src/services/pdf-annot/uuid.ts` — the deterministic v5 uuid (§7).
- `src/services/get-zot-items.ts` — `getRawAnnotationsForAttachment(attachmentKey)`: the local-API fetch (§1).
- `src/services/import-annotations.ts` — `importAnnotationsForAsset`: the picking rule (§9), and the entry the Sync commands use.
- `src/services/pdf-annot/zotero.test.ts` + `src/services/pdf-annot/__fixtures__/zotero/LKXJEQ5S.*` — golden parity on a captured real item, plus units (parse edge cases, type mapping/skips, the comment child block, deterministic uuids, and a cross-path geometry check against the PDF-path golden).

---

## Sources

- Why Zotero stores annotations in its database — Zotero KB: <https://www.zotero.org/support/kb/annotations_in_database>
- Zotero PDF reader (highlight/underline/note/text/image/ink) — <https://www.zotero.org/support/pdf_reader>
- Zotero annotation type constants — `chrome/content/zotero/xpcom/annotations.js`
- Companion docs: [`pdf-annotations-across-platforms.md`](./pdf-annotations-across-platforms.md) (taxonomy), [`importing-into-logseq.md`](./importing-into-logseq.md) (Logseq target), [`architecture.md`](./architecture.md) (coordinate transform).
