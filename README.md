# Logseq Reference Manager

This plugin is meant to help bring references in from various sources into Logseq in a structured manner. It uses the Zotero schema as the foundation, and helps you bring in references from Zotero and/or the Web (using a companion [web clipper chrome extension](https://github.com/rsomani95/logseq-web-clipper/)).

![](./docs/main-demo.gif)

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

## Importing From Zotero

### `/Zotero: Import single item`

Imports a single reference from Zotero, and adds a wiki-link to the citation from where you imported this. By default, you see your most recent items, and can search to drill down and find exactly what you need. This was shown above in the demo.

### `/Zotero: Batch import`

Imports multiple Zotero items at once - supports searching, importing Zotero collections and/or saved searches. Relies on Zotero's search and paginates queries to keep things snappy with larger libraries. Also accessible from the Command Palette.

![](./docs/batch-import.gif)

## Importing From The Web

- Setup the web clipper tag in the settings panel
- Download and setup the chrome extension from https://github.com/rsomani95/logseq-web-clipper
- Clip

![](./docs/web-clipper.gif)

## Rough Edges

- Re-syncing annotations has not been tested extensively
- Changing schemas and back-applying changes to already tagged content has not been given much thought and will be bumpy / impossible. Highly suggest you try this out in a test graph and get a feel for how you want to use it before bringing into your main graph
- Currently doesn't work when installed from the marketplace. Ongoing issue about this: https://github.com/logseq/logseq/issues/12736
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
