# The annotation core — engine, lineage & what's verified

The annotation **core** (`src/services/pdf-annot/`) reads native PDF annotations and
converts them into Logseq annotation records. This document is its decision record:
the engine choice, how it's organized, what's verified, and the lineage that explains
why the code looks the way it does.

> **Why "typescript-port".** This core began life as a TypeScript **port of a Python
> prototype** (`pdf-annot-logseq`), where the coordinate math was first worked out and
> validated. It is now **first-party** — new annotation work happens here, and there is
> no Python in this repo. But the port's fingerprints are deliberate and load-bearing:
> the module comments still cite `convert.py` / `geometry.py`, the serialized objects
> keep **snake_case keys**, and the test oracle is still the prototype's golden output.
> Those aren't leftovers to clean up — they're what keeps the validated math from
> drifting. This doc explains them.

> **See also:** [`architecture.md`](./architecture.md) for the end-to-end pipeline and
> the coordinate transform the core reproduces (§4 there).

---

## 1. What's in the core

The core is **stage 1** — `extract → convert → validate` — plus the Zotero-database
converter and the build-DSL EDN serializers. It is **filesystem-free and
environment-agnostic** so it runs inside the plugin's Electron renderer:

- `extract(bytes, sourcePath?)` — PDF bytes → annotation records (mupdf).
- `convert(extractResult, opts)` — records → Logseq `hl-value` records + tallies.
- `convertZoteroAnnotations(annots, pageMeta, opts)` — the Zotero-DB source → the same records.
- `pageGeometriesFromBytes(bytes)` — all-page geometry (the Zotero path needs it).
- `validate(records, pages, opts)` — the numeric round-trip proof.
- `edn.ts` — the build-DSL EDN serializers (the canonical payload byte-shape).
- `geometry.ts` / `colors.ts` / `uuid.ts` — the validated math, palette mapping, and deterministic uuids.

What it does **not** contain: the delivery to Logseq (the HTTP-API POST + Transit
encoding) — that's the glue in `src/services/` (`logseq-import-edn.ts`,
`logseq-transit.ts`), which the prototype handled in Python (`live.py`) and the CLI.
The EDN serializers the write path mirrors *are* here, so nothing has to be rebuilt to
author a valid payload.

---

## 2. Engine decision: `mupdf` (WASM)

The reference Python prototype used two PDF libraries: **PyMuPDF / `fitz`** (geometry,
rendering, word-level text) and **`pikepdf`** (the raw `/Annots` dictionary walk that
catches `/Link`, `/Popup`, and FreeText colors hidden in `/DS`÷`/RC`). The core uses a
single dependency, [`mupdf`](https://www.npmjs.com/package/mupdf), for **both** roles.

`mupdf` is the official WebAssembly build of **MuPDF — the same C engine PyMuPDF
wraps.** That makes it the lowest-risk choice for matching the validated Python output:

- **Same engine ⇒ same geometry and text.** Coordinates and structured text track fitz
  closely (covered text on the sample reproduces exactly).
- **One dependency, both jobs.** Its low-level `PDFObject` API
  (`page.getObject().get("Annots")`) is the `pikepdf` equivalent — it walks the raw
  array, so Links/Popups/off-`/C` colors are all seen; its `toStructuredText` is the
  `fitz` equivalent for words.
- **Runs everywhere we need.** Node/Bun for the tests, and the browser/Electron
  renderer for the plugin.

The trade-off is bundle size — the WASM is ~10 MB. That was an explicit, accepted
choice: the plugin is used locally, and **correctness/fidelity was prioritized over
size**. It's mitigated by a **dynamic import** (`import('./pdf-annot')` in
`import-annotations.ts`), so the WASM loads only the first time annotations are
actually imported, not on plugin start. `pdfjs-dist` was the lighter alternative but
its text tokenization diverges from fitz and raw-dict access is awkward; byte-level
parity of covered text mattered more than megabytes here.

---

## 3. Module map

Every serialized object keeps **snake_case keys identical to the Python prototype's
JSON output** — that is what lets the golden tests deep-equal them and the EDN
reproduce byte-for-byte. Internal identifiers (functions, locals) are idiomatic
camelCase.

| Module | Role | Notes |
|---|---|---|
| `geometry.ts` | The validated transform, verbatim. | Python's `round()` is round-half-to-even, reproduced by a `pyRound(x, n)` helper so 3-dp coordinates match exactly. **Do not refactor the formulas.** |
| `colors.ts` | Palettes, `DB_IDENT`, `to255` (gray/rgb/cmyk), nearest-pastel `mapColor`. | Anchors copied verbatim; matched against Logseq's `--color-*-300` pastel family. |
| `convert.ts` | `buildRecord`/`convert`: type-mapping, color, skip/empty tallies, deterministic sort. | Fresh UUIDs use `crypto.randomUUID()`; `/NM` reuse is lowercased. |
| `edn.ts` | The build-DSL serializers (`emitSelfContainedEdn` + the live `emitLiveEdn`). | Python's single `edn_num` is split into `ednFloat` (rect coords/dims — integral → `"N.0"`) and `ednInt` (`:page`/`:hl-page`), since TS has no int/float type. |
| `extract.ts` | mupdf for both the raw `/Annots` walk and word reconstruction. | Takes **bytes** (`extract(bytes, sourcePath?)`), not a path — filesystem-free. |
| `zotero.ts` | The Zotero-DB converter (see [`zotero-annotations.md`](./zotero-annotations.md)). | Pure: parsed annotations + page geometry → the same `ConvertResult`. |
| `pdf-pages.ts` | All-page geometry via mupdf (the Zotero path). | Intentionally identical to extract.ts's inline block; kept separate so extract's byte-exact behavior is never perturbed. |
| `uuid.ts` | Deterministic v5 uuid for Zotero idempotency. | Vendors SHA-1 (no `node:crypto`, no async `crypto.subtle`). |
| `validate.ts` | The round-trip proof only; no Pillow overlay PNGs. | `overlays` is always `[]`. |
| `types.ts` | Shared type contract for all of the above. | Serialized shapes mirror the Python JSON. |
| `index.ts` | The public API the glue imports. | — |

---

## 4. Filesystem-free core (renderer-readiness)

Everything in `src/services/pdf-annot/` is filesystem-free and environment-agnostic.
`extract()` takes a `Uint8Array` of PDF bytes; `convert()`, `convertZoteroAnnotations()`,
and the EDN emitters are pure functions over plain data. So the glue imports from
`pdf-annot` directly — it already resolves a PDF asset, so it reads the asset bytes
(`read-pdf-bytes.ts`) and passes them straight into `extract()` /
`pageGeometriesFromBytes()`. No `node:fs`, no shelling out. (The prototype had a
node-coupled `cli.ts` for local runs; it was not brought into the plugin — the
`index.ts` header still mentions a `./cli`, which doesn't exist here.)

---

## 5. Covered text: rebuilding fitz "words" from mupdf char quads

The one genuinely non-mechanical part of the port. The Python selects, per markup
quad, the page **words** whose vertical center sits inside the quad (with ≥ 0.3
horizontal overlap), in reading order — using fitz's `page.get_text("words")`, which
hands back whitespace-delimited words with bounding boxes.

mupdf exposes characters, not pre-grouped words, via
`toStructuredText("preserve-whitespace").walk({ beginLine, endLine, onChar })`. Each
`onChar` gives the glyph and its **quad** `[ulx,uly, urx,ury, llx,lly, lrx,lry]` in
top-left / y-down page space (the same coordinates fitz uses). `extract.ts`
reconstructs words by accumulating chars and flushing on any whitespace char and at
every line boundary; the word bbox is the min/max over its chars' quad corners. The
selection math (`coveredTextForQuads`) is then a verbatim port. This reproduces the
sample's spans exactly (e.g. the underline "we fine-tuned Qwen3-Omni-30B-A3B …"); covered text is the one
field the project treats as ballpark-tolerant, but in practice it matches.

---

## 6. Correctness, and two benign differences

**What is exact (the part that matters):** for the golden sample, the full `extract →
convert` pipeline produces, for every record, an `hl-value` (the stored geometry Logseq
actually imports) that matches the prototype golden; the block titles (covered text /
note text), color, page, and reused `/NM` UUID all match; and the emitted **EDN payload
is byte-identical** to the golden `.edn`. `validate()` round-trips well under the `1e-6`
PASS threshold.

**Two differences, both confined to the diagnostic JSON artifacts — never the imported
payload** (they're why the tests compare a couple of *raw* fields with tolerance rather
than strict equality):

1. **Raw coordinate precision.** mupdf reads numbers as 32-bit floats, so a raw
   `rect_pdf` reads `290.9700012207031` where pikepdf preserved the literal `290.97`.
   This ~1e-5 noise is **washed out by the 3-decimal rounding** in `toStored`/`bounding`,
   so the stored geometry — and the on-screen placement — is identical. It survives only
   in the diagnostic raw fields.
2. **Integral-float rendering.** JavaScript has no int/float distinction, so
   `JSON.stringify` writes `612` where Python's `json.dump` writes `612.0` (e.g. page
   `width`/`height`). Numerically identical; and `edn.ts`'s `ednFloat` still emits
   `612.0`, so the import payload is unaffected.

Neither changes where a highlight lands.

---

## 7. Tests

`bun test src/services/pdf-annot/` — **123 tests across 6 files** (all green, 335
assertions) — and `bunx tsc --noEmit` (strict).

| File | What it proves |
|---|---|
| `convert.test.ts` | Golden parity, no PDF library: `convert()` deep-equals the golden `logseq-annotations.json` records + tallies for the vendored fixture dir; exercises the color buckets (incl. the peach `#FFCCA1` / cream `#FCF5A4` → `red` edge cases), forced flat color, and the invalid-color throw. |
| `edn.test.ts` | `emitSelfContainedEdn` / `emitLiveEdn` / `emptyEdn` match the golden `.edn` byte-for-byte. |
| `zotero.test.ts` | Golden parity on the captured `LKXJEQ5S` item, plus units: parse edge cases, type mapping/skips, the comment child block, deterministic uuids, and a cross-path geometry check against the PDF-path golden. |
| `geometry.test.ts`, `colors.test.ts`, `validate.test.ts` | Units, including the scale-independent round-trip to `< 1e-9` and the color-bucket edge cases. |

**Coverage caveat — `extract` and the full pipeline are not tested in-repo.** The
source PDF is **not vendored** (only the JSON the prototype extracted from it), so:
- there is **no `extract.test.ts` / `pipeline.test.ts`** here — the one mupdf-dependent
  stage has no in-repo test; `convert`/`edn`/`validate` are tested against its golden
  JSON output instead;
- only **one** golden dir (`xu-…__pdf-expert`) is vendored, so `convert` parity is
  proven against a single fixture (the prototype proved it against four).

When changing `extract`, run it against real PDFs by hand. Re-vendoring more golden dirs
(regenerated from their source PDFs) would re-enable broader `convert` parity.

---

## 8. The consumer surface

The glue (`import-annotations.ts`) consumes the core like this:

- `extract(bytes)` → `convert(extractResult, { assetUuid, assetTitle, color })` →
  records whose `hl_value`, `uuid`, `color_db_ident`, `hl_page`, and `block_title` are
  exactly what a `:logseq.class/Pdf-annotation` block needs.
- On the Zotero fallback: `pageGeometriesFromBytes(bytes)` +
  `convertZoteroAnnotations(annots, pageMeta, { assetUuid, assetTitle, libraryID, color })`
  → the same records.
- The records go to `importAnnotationRecords` (`logseq-import-edn.ts`), which builds the
  attach payload (`buildLiveImportMap`, mirroring `edn.ts`'s `emitLiveEdn`), Transit-
  encodes it, and POSTs it — see [`architecture.md`](./architecture.md) §5.

---

## 9. Shared caveats

The core's known gaps are properties of the **algorithm**, not the engine, so they hold
identically wherever the math runs — the **same** list as
[`architecture.md`](./architecture.md) §7: rotation ≠ 0 and non-zero CropBox origin are
coded defensively but unvalidated; `Underline`/`StrikeOut`/`Squiggly` flatten to
text-highlight bands (the line *look* is lost); area/ink are not generated; and the
color anchors mis-bucket pale/cream sources to `red` (faithfully reproduced, with the
`annotationColor` forced-color setting as the escape hatch).
