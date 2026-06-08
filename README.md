# Logseq Reference Manager

This plugin is meant to help bring references in from various sources into Logseq in a structured manner. It uses the Zotero schema as the foundation, and helps you bring in references from Zotero and/or the Web (using a companion [web clipper chrome extension](https://github.com/rsomani95/logseq-web-clipper/)).

<video src="https://github.com/rsomani95/logseq-reference-manager/raw/main/docs/Ref-Mngr-Main-Demo.mp4" controls width="100%"></video>

## Installation

Download from the plugin marketplace from within Logseq

## Features

- Schema:
  - A ~1:1 mapping with Zotero's API. One key change: Unlike Zotero, we add a dedicated `authors` field (all non-authors go into the _native_ `creators` field)
  - Two presets out of the box: `Essentials`, which should serve most folks, and `Full`. You can pick `Custom` if you want to pick and choose which properties you want with more specificity
- Zotero:
  - Bring in references from Zotero (tested with Zotero 9, should work with 7+)
  - Single / Batch import
  - (Advanced) Set up rules to add specific tags to references when conditions you define are met — e.g. tag anything with `arxiv.org` in its URL as `#Paper`
- Web:
  - This plugin is a pre-requisite + configurator to bring in sources from the web using [`logseq-web-clipper`](https://github.com/rsomani95/logseq-web-clipper/)
- A dedicated settings panel for ease of setup and customisation
- Plays nice with Logseq's theming system

PS: This plugin only works with Logseq **DB graphs** (not file graphs), on **desktop** — it reaches Zotero and Logseq over local HTTP APIs that the mobile and web builds don't expose.

## Setup & Customisation

I **strongly recommend** you try this in a standalone graph first to get a feel for it, and setup the properties to your liking. It's messy to change schemas afterwards, especially if you want to change whether _Authors_ are imported as plaintext names or page references.

- `Cmd+Shift+P` to open the command palette in Logseq
- Type `Reference Manager: Settings` > hit Enter
- Follow steps in the panel

Here's a quick preview of the different settings:

<video src="https://github.com/rsomani95/logseq-reference-manager/raw/main/docs/Ref-Mngr-Settings.mp4" controls width="100%"></video>

## Importing From Zotero

- `/Zotero: Import single item`: Imports a single reference from Zotero, and adds a wiki-link to the citation from where you imported this. By default, you see your most recent items, and can search to drill down and find exactly what you need. This was shown above in the demo
- `/Zotero: Batch import`
  - Imports multiple Zotero items at once
  - Supports searching, importing Zotero collections and/or saved searches. Relies on Zotero's search and paginates queries to keep things snappy with larger libraries
  - Also accessible from the Command Palette
  - Lets you add any additional tags when importing

<video src="https://github.com/rsomani95/logseq-reference-manager/raw/main/docs/Ref-Mngr-Batch-Import.mp4" controls width="100%"></video>

### PDF Annotation Sync

When importing from Zotero, we first scan the actual PDF file for annotations. If found there, we import those into Logseq. If there are none, then we look inside Zotero. We **never** look in both or attempt to combine both as Zotero itself attempts to import the PDF file's annotations into it's own format, but has limitations. Read [this doc](./dev-notes/pdf-annotation/zotero-annotations.md#8-what-zotero-imports-from-an-externally-annotated-pdf-and-whats-lost) for a deeper dive.

If you continue doing any additional annotations in your PDF file using a PDF reader, then you can use the `Sync Annotations` functionality for a page (from the `...` on the top right) to bring those back into Logseq. This is a one way sync: annotations made inside Logseq do not make it back to the PDF file.

<video src="https://github.com/rsomani95/logseq-reference-manager/raw/main/docs/Ref-Mngr-PDF-Annotation.mp4" controls width="100%"></video>

## Importing From The Web

- Setup the web clipper tag in the settings panel
- Download and setup the chrome extension from https://github.com/rsomani95/logseq-web-clipper
- Clip

![](./docs/web-clipper.gif)

## Rough Edges

- Re-syncing annotations has not been tested extensively
- Changing schemas and back-applying changes to already tagged content has not been given much thought and will be bumpy / impossible. Highly suggest you try this out in a test graph and get a feel for how you want to use it before bringing into your main graph
- Import speed is slower and batch import is especially slow. It is however, _correct_. I plan to work on optimising this in the near future

All my testing has been done on MacOS with Zotero 9+ and Logseq version `2.0.1-alpha+nightly.20260505`

## Credits

Originally forked from [logseq-zoterolocal-plugin](https://github.com/benjypng/logseq-zoterolocal-plugin), created by benjypng. Go [buy him a coffee](https://buymeacoffee.com/hkgnp.dev) for laying strong foundations to build on top of!

## Contributing

As is glaringly obvious from the commit log, this has been developed with the help of Claude while I've been testing it for all of my use-cases. Two reasons for this:
- I wanted to get the shape of this right first
- I'm no TypeScript expert and iterating with Claude while I test everything has been a much faster route for now

As a result, the code has been tested quite a bit, but not reviewed thoroughly, so I'm not taking PRs right now. I plan on doing this once the dust settles a bit. For now, feel free to open issues if you experience rough edges

If you want to understand the codebase, the developer docs in [`dev-notes/`](./dev-notes/) are the place to start: [`architecture.md`](./dev-notes/architecture.md) for the high-level framing and tech stack, [`module-map.md`](./dev-notes/module-map.md) for where everything lives, plus deeper notes on the Logseq SDK and Zotero internals.

---

## TODOs

- Show PDF annotation import
  - Open Zotero. Click an item to open in PDF Expert. Then:
    - Highlight some text
    - Underline some text
    - Make a sticky note
    - Write some text
  - Import that item into Logseq
  - Show the imported highlights
