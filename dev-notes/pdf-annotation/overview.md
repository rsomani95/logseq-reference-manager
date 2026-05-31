# PDF Annotation Import — Overview

A plain-language guide to what the plugin's annotation import does and what to expect from it. No code, minimal jargon.

> **See also:** [`architecture.md`](./architecture.md) for how the pipeline works under the hood — the coordinate transform (§4) and the write path + block schema (§5).

> **Logseq terms used here**
> - **Graph** — your personal Logseq knowledge base (your collection of notes).
> - **Block** — the basic unit of content in Logseq: a single bullet point. Everything you write lives in a block, and any block can be linked to, searched, and referenced from anywhere else.
> - **Highlight** — in Logseq's built-in PDF viewer, a colored mark you draw on a PDF. Logseq turns each one into its own block, so a highlight is a piece of your knowledge graph, not just a mark on a page.
> - **Backlink** — an automatic "what links here" list. If block A references block B, then B shows A as a backlink. This is how ideas connect in Logseq.

---

## 1. What it does and why it exists

When you read a PDF, you often mark it up — yellow highlights, underlines, little typed notes in the margin. Those marks can live in one of two places:

- **Inside the PDF file itself**, if you made them in a tool like Apple Preview, Adobe Acrobat, PDF Expert, or Skim. They are called *native* PDF annotations and travel with the file.
- **In Zotero's own database**, if you made them in Zotero's built-in PDF reader. Zotero deliberately keeps annotations *out* of the file (so it can sync them without rewriting PDFs), so the file carries nothing — the marks live only in Zotero.

Logseq has a built-in PDF viewer, and it will happily **show** native marks when you open the file — it draws them on screen. But that is all it can do. Logseq has no awareness of them as *data*: you cannot click one to jump to it, you cannot link to it from another note, and you cannot search or query it. They are pictures on a page, disconnected from your knowledge graph. Logseq also has **no feature to import** them. So all the thinking you captured while reading stays trapped.

This plugin closes that gap. It reads the annotations you already made and **re-creates each one as a real, first-class Logseq highlight** — an actual block that lives in your graph. It reads them from **whichever place they live**: it looks inside the PDF file first, and if the file has no marks, it falls back to reading Zotero's database directly (no "Export PDF" step needed). Once imported, every highlight behaves like any other piece of content you wrote yourself: you can link to it, see its backlinks, query it, and attach your own commentary underneath it.

This all happens **inside Logseq, as part of the plugin** — there is no separate tool to run. Annotations are imported automatically when you bring a reference in from Zotero (single or batch import), and you can re-import them at any time with the **Sync annotations** commands.

---

## 2. How it works, in plain terms

When the plugin imports a reference that has a PDF, or when you run *Sync annotations* on a page, it runs a short, automatic sequence for that PDF:

1. **Read the source.** It looks inside the PDF file and finds every annotation baked into it — highlights, underlines, notes — recording each one's kind, its color, its position on the page, and (for marks over text) the words it covers. If the file has no such marks, it instead asks Zotero for that PDF's annotations from Zotero's database.
2. **Translate into Logseq's language.** PDFs (and Zotero) describe a mark's position differently than Logseq does. The plugin converts each annotation's location so it lands on exactly the right spot when Logseq later draws it. It also translates the color (see the limits in Section 4) and decides how each kind of mark should appear.
3. **Attach the annotations to your PDF.** It writes the new highlights so they belong to that file's entry in your graph. From then on, opening the PDF in Logseq shows them as living highlights.

The process is **additive and safe**: it only adds new blocks and never edits or deletes anything that was already there. Each imported highlight carries a stable identity, so re-running it (via *Sync annotations*) **updates** the existing highlights instead of creating duplicates. If you ever want to undo an import, you simply delete the imported highlight blocks.

> The coordinate math that step 2 relies on — placing a band on exactly the right glyphs at any zoom level — was validated during development down to a vanishingly small margin of error, and is locked in by a golden test suite. See [`architecture.md`](./architecture.md) §4.

---

## 3. Highlight types in the source → how they show up in Logseq

This is the heart of the feature. A PDF (or Zotero) can contain many *kinds* of annotation, but Logseq offers only two building blocks to represent them: a **colored highlight band** over some text, and an **area highlight** (a rectangular screenshot of a region, saved as an image). Everything coming in has to be expressed using one of those two. The table below shows how each annotation kind is handled.

| Annotation kind | What it is | How it appears in Logseq | Fidelity notes |
|---|---|---|---|
| **Highlight** | A colored band painted over text | A colored highlight band over the same text | Direct match. The covered text becomes the block's content. The closest thing to lossless. |
| **Underline** | A line drawn under text | A colored highlight band over that text | The *underline look* is lost (Logseq has no underline style), but the words and the location are preserved. Not reversible back into a real underline. |
| **Strikeout / Squiggly** | A line through, or a wavy line under, text | A colored highlight band over that text | Same as underline: the distinctive look is lost; text and position are kept. |
| **FreeText note** (Zotero "text") | Text you typed directly onto the page | A colored highlight band at the note's spot, whose block text **is the note you typed** | The note's words are preserved and become searchable/linkable. The band is anchored where the note sits on the page. |
| **Text / sticky note** (Zotero "note") | A small clickable note icon with hidden text | A colored highlight band at the icon's spot, with the hidden text as the block content | Treated like a FreeText note. |
| **Area / figure region** (Zotero "image") | A rectangle capturing part of a figure or page | (Not produced yet) Would become an area highlight — a saved image crop of the region | Planned future work. The current code does not create these, because there is no portable equivalent in the sources it reads. |
| **Freehand ink** | Pen/marker strokes drawn by hand | (Not supported) | Logseq has no freehand equivalent, so these cannot be re-created. |
| **Link** | A clickable hyperlink (e.g. a citation jump) | (Skipped) | These are part of the document's plumbing, not reading notes, so they are intentionally ignored. |

> **One extra nicety on the Zotero path:** a comment you attach to a highlight or underline in Zotero becomes a **child block** underneath the imported highlight — Logseq's idiom for "my note about this passage."

### The validated sample

The golden test fixture (a PDF Expert copy of a real paper — the *Qwen3-Omni* technical report) contains **10 annotations** the code handles: **5 underlines, 3 typed (FreeText) notes, 1 highlight, and 1 sticky note**, plus ~249 citation links that are skipped. Most marks were drawn in orange (`#FF8000`) and snap to **yellow**; two pale marks — a cream sticky note and a peach highlight — land on **red**, their nearest available pastel (see Section 4). After import:

- An **underline** over a sentence like *"we fine-tuned Qwen3-Omni-30B-A3B …"* becomes a yellow band over those exact words; where it wraps across lines it correctly becomes several connected bands.
- A **typed note** arrives as a highlight whose block text **is the note you typed** — e.g. *"Timestamps? (See below)"* — so it is searchable and linkable, carrying that exact sentence as its content.

(Why yellow and red, when the marks were orange and cream? See the next section.)

---

## 4. Limitations of Logseq as the destination

These are not bugs — they are honest limits of what Logseq, as the receiving end, is able to represent. Knowing them up front sets the right expectations.

| Limitation | What it means in practice |
|---|---|
| **Only 5 fixed colors** | Logseq highlights come in exactly five pastel colors: yellow, red, green, blue, and purple. There is **no orange, no custom color, and no opacity/transparency**. By default every imported mark is snapped to its nearest available color (in the sample, the orange marks became **yellow** and the two pale marks **red** — each its closest match); alternatively you can force *all* marks to a single color of your choice (the **Annotations** setting). |
| **Only two kinds of highlight** | Logseq can express a mark only as a colored text band or as an area (image) capture. It has **no underline, strikethrough, squiggly, freehand, or typed-text annotation type**. So those richer kinds get flattened into a plain colored band, and their distinctive appearance is lost. |
| **Highlights are anchored to coordinates, not to text** | Each highlight remembers a *position on the page* (a box at certain page coordinates), not the sentence it sits on. This is fragile: if the PDF is later **replaced, re-paginated, or re-flowed** (different fonts, margins, or page sizes), the highlights can drift off their original words, because the coordinates no longer point where they used to. |
| **No native import** | Logseq cannot import a PDF's existing annotations on its own — which is the entire reason this feature exists. |
| **One-way trip (no standard export back)** | Imported highlights live in Logseq's own format. There is **no clean way to export them back into the PDF** as standard annotations. So an underline that came in as a highlight does not turn back into an underline; the import is a one-way conversion. |
| **The viewer can show, but not act** | Logseq's PDF viewer can *display* a PDF's original built-in annotations, but it cannot click, link, query, or otherwise *act* on them. Only the highlights this feature re-creates as real blocks gain those abilities. |

There are also a couple of page-layout situations (rotated pages, and pages with an unusual content offset) that the code handles cautiously but has not been fully proven against, since the validated sample didn't have them. These are flagged as known risks rather than guarantees (see [`architecture.md`](./architecture.md) §7).

---

## 5. What you get in the end

After an import, each annotation from your PDF is a genuine Logseq block — a real citizen of your knowledge graph rather than a picture locked inside a file. For every imported highlight you can:

- **Reference it** from any other note, so an idea you marked while reading can be woven into your wider thinking.
- **See its backlinks** — every place in your graph that points back to that highlight.
- **Query it**, so highlights can surface in searches and dynamic lists alongside the rest of your notes.
- **Click it to reopen the PDF at that exact spot**, jumping straight back to the page and location where you made the mark.
- **Write commentary under it**, because it is an ordinary block that can have its own child notes.

In short: the reading you already did inside Preview, Acrobat, Skim, or Zotero stops being trapped and becomes a connected, searchable, linkable part of your Logseq graph.
