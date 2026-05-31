# PDF Annotations Across Platforms

A reference companion to [`overview.md`](./overview.md). It answers one question: **where does the "PDF annotation kind" column come from, and why does every tool (Zotero, Preview, Acrobat, PDF Expert…) list slightly different kinds?**

Short answer: PDF annotations **are** a real, single standard. The table in `overview.md` is that standard's taxonomy — read straight out of the file — not any one app's invention. Each app then supports a *subset* of the standard and gives those subsets its own names, which is why the lists look different.

> This is evergreen platform knowledge — it describes the PDF/ISO-32000 world, not this
> plugin's code. The plugin's annotation core lives in `src/services/pdf-annot/`; the
> module references below (`convert.ts`, `geometry.ts`) point there.

---

## 1. There is a standard: ISO 32000

PDF annotations are defined by the PDF specification: originally Adobe's *PDF Reference*, since 2008 the ISO standard **[ISO 32000-1:2008](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)** (PDF 1.7), updated by **[ISO 32000-2:2020](https://pdfa.org/resource/iso-32000-2/)** (PDF 2.0).

In the file, every annotation is a dictionary listed in a page's `/Annots` array, and its **`/Subtype`** key names the kind. The spec defines ~25 standard subtypes (ISO 32000-1 §12.5, Table 169):

> `Text` · `Link` · `FreeText` · `Line` · `Square` · `Circle` · `Polygon` · `PolyLine` · `Highlight` · `Underline` · `Squiggly` · `StrikeOut` · `Stamp` · `Caret` · `Ink` · `Popup` · `FileAttachment` · `Sound` · `Movie` · `Widget` · `Screen` · `PrinterMark` · `TrapNet` · `Watermark` · `3D`
>
> (PDF 2.0 adds a few, e.g. `Projection`, `RichMedia`, `Redact`, and deprecates others like `Movie`/`Sound`.)

A named subset of these are **markup annotations** (§12.5.6.2) — the ones that represent a *human reading the document*: they carry an author, a creation date, and an optional popup comment. That subset is: `Text`, `FreeText`, `Line`, `Square`, `Circle`, `Polygon`, `PolyLine`, `Highlight`, `Underline`, `Squiggly`, `StrikeOut`, `Stamp`, `Caret`, `Ink`, `FileAttachment`, `Sound`.

Crucially, **`Link`, `Popup`, and `Widget` (form fields) are *not* markup annotations** — they're machinery, not reading notes.

---

## 2. So where did `overview.md`'s column come from?

The PDF standard, read directly from the file. The plugin takes the literal `/Subtype` string — no remapping:

- It reads them via the [`mupdf`](https://www.npmjs.com/package/mupdf) package (`extract.ts`). mupdf is the WASM build of the same MuPDF engine PyMuPDF wraps, so it just surfaces the standard's names.
- `convert.ts` hard-codes the spec names: `MARKUP_SUBTYPES = {Highlight, Underline, StrikeOut, Squiggly}` and `NOTE_SUBTYPES = {FreeText, Text}`.
- `geometry.ts` even cites the spec by section ("PDF spec 12.5.6.10", the text-markup-annotations clause).

So the column is **not** PDF Expert's taxonomy, and not "mupdf's own" — mupdf just surfaces the standard's names. **Preview, Acrobat, PDF Expert, and Skim all write these same standard subtypes into the file**, which is exactly why a mark made in one app is readable by another (and by this plugin). `overview.md`'s table is the markup subset that matters for reading notes, plus `Link` — which is listed only to say "we skip it."

---

## 3. What is a `Link` annotation?

Your instinct is right *and* the thing that confused you is the answer: the clickable links *inside* a PDF **are** Link annotations. There is no separate mechanism.

`/Subtype /Link` is a standard annotation: a clickable rectangle (`/Rect`) on the page tied to an action. Two flavours:

| Flavour | PDF action | Example |
|---|---|---|
| **Internal** | `/GoTo` / `/Dest` | A citation `[12]`, a table-of-contents entry, a cross-reference, an equation/figure jump — moves you elsewhere *in the same document*. |
| **External** | `/URI` | A clickable web URL, DOI, or email — opens *outside* the document. |

Because every clickable hotspot lives in the page's `/Annots` array, Link annotations show up the moment you enumerate annotations — which is why the plugin has to *actively* skip them. It's classified separately from a highlight because a Link has **no authored content, no color-as-markup, and no "I was reading here" intent** — it's navigation plumbing emitted by the typesetter (LaTeX `hyperref`, Word→PDF export, etc.).

The plugin reads the link target anyway (recording `kind: "uri"` or `kind: "goto"`) purely so it can confidently drop it, counting them as `skipped_links`. A typical academic paper has on the order of 100+ of them — ordinary for citation cross-references.

---

## 4. How each platform maps onto the standard

Most readers store annotations **as native PDF subtypes inside the file**, so the marks travel with the document. **Two tools here are outliers that keep annotations in their own database instead of in the file: Zotero and Logseq.** Zotero does it for fast, conflict-free sync — it stores annotations in its **own SQLite database, not in the PDF**, and only writes standard subtypes when you explicitly use *File → Export PDF…* (see [`zotero-annotations.md`](./zotero-annotations.md) for how the plugin reads those database-stored annotations — their format, quirks, and what Zotero does with externally-made marks). **Logseq — the destination this whole subsystem targets — does the same**, storing each annotation as a first-class block in its DB graph (§6).

| Platform | Where annotations live | Annotation model |
|---|---|---|
| Apple Preview | Native subtypes in the PDF | Highlight, Underline, StrikeOut, Text, FreeText, Ink, Square… |
| Adobe Acrobat | Native subtypes in the PDF | Full standard set |
| PDF Expert | Native subtypes in the PDF | Full standard set |
| Skim (macOS) | Native PDF (with an optional extended sidecar) | Full standard set |
| **Zotero** | **Its own database** (PDF only on explicit export) | A curated 6-type subset (§5) |
| **Logseq** | **Its own DB graph** (also *renders* native PDF marks, but can't act on them) | Two representations: text highlight + area highlight (§6) |

---

## 5. Zotero's types vs. the standard

Zotero defines **exactly six** annotation types — its *authoring* model, i.e. what its reader lets you create, not the PDF taxonomy:

```js
ANNOTATION_TYPE_HIGHLIGHT = 1
ANNOTATION_TYPE_NOTE      = 2
ANNOTATION_TYPE_IMAGE     = 3
ANNOTATION_TYPE_INK       = 4
ANNOTATION_TYPE_UNDERLINE = 5   // added in Zotero 7
ANNOTATION_TYPE_TEXT      = 6   // added in Zotero 7
```

Mapped to the standard and to `overview.md`:

| Zotero type | Closest PDF subtype | `overview.md` row |
|---|---|---|
| `highlight` | `Highlight` | Highlight |
| `underline` | `Underline` | Underline |
| `note` | `Text` (sticky note + comment) | Text / sticky note |
| `text` | `FreeText` (typewriter on page) | FreeText note |
| `image` | *(no clean subtype — `Square`/`Stamp` region capture)* | **Area / figure region** |
| `ink` | `Ink` | Freehand ink |

So:

- **Area/figure region is *not* missing** — it's Zotero's **`image`** type (3).
- **Genuinely absent** vs. the standard markup set: **`StrikeOut`** and **`Squiggly`**, plus all the vector shapes (`Line`, `Square`, `Circle`, `Polygon`, `PolyLine`), `Stamp`, `Caret`, `FileAttachment`, `Sound`.
- **`Link` absent — correctly**, because it isn't user markup at all (§3).

> **Naming caution:** the words are *swapped* relative to the spec. Zotero's **`note`** ≈ PDF **`Text`** (a sticky note), and Zotero's **`text`** ≈ PDF **`FreeText`** (typewriter text on the page). When you compare lists across tools, match on *behaviour*, not on the label. The plugin's Zotero converter (`zotero.ts`) keys off these Zotero type names directly.

---

## 6. Logseq's model vs. the standard

Logseq is the **second database-backed outlier** — and the *destination* this whole subsystem exists to serve. Like Zotero, it never writes standard subtypes into the PDF; it stores each annotation as a **first-class block in its DB graph** (a Datascript database persisted in SQLite). But Logseq's relationship to native PDF marks has a twist worth stating plainly:

**Logseq renders native PDF marks yet has no data model for them.** Open a PDF carrying baked-in Preview/Acrobat/PDF-Expert annotations and Logseq's PDF.js viewer will *draw* them on screen — but you cannot click, link, query, or backlink one. Only annotations created in Logseq's own viewer (or injected as DB blocks, which is what this plugin does) are first-class graph citizens, and Logseq has **no feature to import** a PDF's existing marks. Native marks visible but inert, with no bridge to the graph — that gap is the entire reason this subsystem exists (see [`overview.md`](./overview.md) §1 and [`importing-into-logseq.md`](./importing-into-logseq.md)).

### Logseq's two representations

Where Zotero exposes six authoring types, Logseq's model is narrower still — effectively **two** (`importing-into-logseq.md` §2):

| Logseq representation | What it is | Standard subtypes it absorbs |
|---|---|---|
| **Text highlight** | A colored band over text — per-line rects under a bounding box, like `/QuadPoints` | `Highlight`, `Underline`, `StrikeOut`, `Squiggly`, plus `FreeText`/`Text` notes anchored at their `/Rect` (the note text becomes the block body) |
| **Area highlight** | A rectangular region crop saved as a PNG asset (`hl-type :area`, `:content {:image …}`) | The `Square`/`Stamp` region-capture idea — the same "Area / figure region" concept as Zotero's `image` (§7) |

That is the whole vocabulary. Logseq has **no** underline, strikethrough, squiggly, typed-text, ink, or vector-shape annotation type: every text-markup subtype and every on-page note collapses into the single **text highlight** band — the distinctive look is lost, but the words and their place on the page survive — and anything region-shaped becomes an **area highlight**. `Ink` and the vector shapes (`Line`, `Square`, `Circle`, …) have no representation at all and are dropped (§8).

### Color: exactly five closed values

Logseq highlights come in **exactly five** colors, stored as closed-value keywords: `:logseq.property/color.{yellow,red,green,blue,purple}`. **No orange, no custom hex, no opacity.** That is far narrower than the PDF standard, where the annotation color `/C` is any RGB triple — which is why the plugin snaps each source color to its nearest of the five (`colors.ts`; e.g. orange marks land as **yellow**).

### How a Logseq annotation is stored

Each annotation is a block tagged `:logseq.class/Pdf-annotation` that points at the PDF's *asset block* and carries its geometry as `viewportToScaled` coordinates — **anchored to page coordinates, not to the underlying text**, so a replaced or re-paginated PDF can drift the marks off their words. The full block schema, the color db-idents, and the import mechanics live in [`importing-into-logseq.md`](./importing-into-logseq.md).

---

## 7. "Area / figure region" is not a standard subtype

There is no `/Subtype /Area`. It's an *application* concept: Zotero calls it `image`, Logseq calls it an "area highlight." In raw PDF the nearest standard representations are `Square` (a plain rectangle) or `Stamp` (an embedded image). That ambiguity — no single portable subtype to read back — is exactly why `overview.md` lists it as planned-but-not-yet-produced.

---

## 8. This subsystem's position, in one glance

| `/Subtype` | Handling |
|---|---|
| `Highlight`, `Underline`, `StrikeOut`, `Squiggly` | → Logseq text-highlight band over `/QuadPoints` (covered text becomes block content) |
| `FreeText`, `Text` | → Logseq text-highlight anchored at `/Rect`; `/Contents` becomes block content |
| `Link` | Skipped (`skipped_links`) — navigation, not markup (§3) |
| `Popup` | Skipped quietly — it's the companion window of a `Text` note, not its own mark |
| `Ink`, `Line`, `Square`, `Circle`, `Polygon`, `Stamp`, `Caret`, … | Skipped with a warning, counted, never crashing |

See [`overview.md`](./overview.md) for the plain-language version and [`architecture.md`](./architecture.md) for the extraction pipeline.

---

## Sources

- ISO 32000-1:2008 (PDF 1.7), §12.5 Annotations — free Adobe copy: <https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf>
- ISO 32000-2 overview — PDF Association: <https://pdfa.org/resource/iso-32000-2/>
- Zotero annotation type constants: `chrome/content/zotero/xpcom/annotations.js`
- "Why does Zotero store PDF annotations in its database?" — Zotero KB: <https://www.zotero.org/support/kb/annotations_in_database>
- Zotero PDF reader (highlight/underline modes): <https://www.zotero.org/support/pdf_reader>
- Logseq's PDF-annotation block schema, the five color closed-values, and the EDN import path — this repo's [`importing-into-logseq.md`](./importing-into-logseq.md) (and the Logseq source it cites, e.g. `logseq.db.frontend.class`, `logseq.property`).
