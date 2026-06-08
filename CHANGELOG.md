# Changelog

Reference Manager began as a fork of [benjypng/logseq-zoterolocal-plugin](https://github.com/benjypng/logseq-zoterolocal-plugin) and is now an independent plugin that has deviated quite a bit.

## [0.2.0] - 2026-06-08

### Added

- **PDF annotation import:** A PDF's annotations now import as first-class Logseq highlight blocks. The importer prefers annotations . It runs automatically on single and batch import, and on demand via the new `Zotero: Sync annotations` (page menu) and `Zotero: Sync all annotations` commands. Re-running is idempotent, so syncing updates blocks in place instead of duplicating them.
- **Annotations settings:** A new Annotations section in the setup hub lets you control the highlight colors.
- **Tagging w/ batch imports:** You can now add any additional tags when importing a batch of references.
- **Theming Support:** All UI elements of this app now play nice with custom themes. Previously, they just showed a blank background and only worked with the default theme

### Bugfixes

- Already imported files were not being detected when importing single items
- Attachment linking was broken. It now works and imports the assets 'natively', allowing you to open them within Logseq
- Fixed https://github.com/rsomani95/logseq-reference-manager/issues/1 via https://github.com/logseq/marketplace/pull/831

### Removed

- **Old annotation sync:** The previous plain-text annotation sync from Zotero only, and its `zotero-last-sync` timestamp property have been removed. There is no migration: re-run Sync to re-import existing annotations as the new highlight blocks.

## [0.1.0] - 2026-05-26

First release as an independent plugin. This version diverged substantially from the upstream fork; the highlights below are what changed relative to benjypng/logseq-zoterolocal-plugin.

### Added

- **Batch import:** A new command imports many items at once, from search, collections, or saved searches. Results are paginated and streamed in, so large libraries stay responsive.
- **Extended, automated tags:** `Zotero: Edit tag rules` lets you auto-apply tags when an item's metadata matches conditions you define (for example, URL contains "arxiv" applies `#Paper`). Extended tags can build on the base tag or stand alone.
- **Schema presets:** Essentials, Full (roughly 1:1 with the Zotero API), and Custom. Adds a dedicated `authors` field (non-authors go to `creators`), human-readable property names, per-field descriptions, and an opinionated set of top fields you can reorder in the UI.
- **Settings panel:** The logseq settings panel is limited in the UI it surfaces, so I've built a dedicated settings panel for this plugin to reduce complexity for the user. Accessed from the command palette - `Reference Manager: Settings`

### Changed

- **Single-item import:** A richer search experience with caching and native theming. The page now opens only after the import completes, instead of creating it instantly and populating properties in real time. It is also much snappier and shows you the most recent items in your Library before you search for anything.
- **Search:** Defers to Zotero's own API (server-side index) instead of a custom local search.
- **Theming:** The plugin mirrors your active Logseq theme through `--ls-*` CSS variables, so it feels native in light and dark.
- **Reference prefix:** Imported reference pages now use the `@` prefix by default, making them easier to find.

### Fixed

- **Rename-proof "In Graph" detection:** Items are matched by their Zotero key (stored as `zotero-code`), not by page name, so renaming an imported page no longer flips its badge to "not in graph" or creates a duplicate on re-import. The search popup re-checks this each time you reopen it.
- **Error reporting:** Clearer messages overall, including guidance for the recycled/deleted-page case the plugin cannot re-import into automatically.

### Removed

- **Markdown graphs.** Dropped all Markdown-graph support; the plugin targets DB graphs only.
- **Cite command.** Removed `/Zotero: Cite (insert citation)`. Use `[[@...]]` to cite an imported reference instead.
