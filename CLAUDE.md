# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Logseq plugin that connects directly to a running Zotero 7+ instance (via its local HTTP API on `http://127.0.0.1:23119`) and imports items into a Logseq graph without needing Zotero Cloud sync. The plugin targets **Logseq-DB only**.

## Commands

Package manager is **bun**. Husky pre-commit runs `npm run lint:precommit` (Biome check + `tsc --noEmit`).

- `bun install` — install deps
- `bunx vite` (alias: `bun run dev`) — dev server with HMR; loaded into Logseq via the Logseq vite plugin (`vite-plugin-logseq`). The plugin's `package.json` points Logseq at `dist/index.html` for production loads.
- `bun run build` — production build into `dist/`
- `bun run lint:precommit` — `biome check . --write && tsc --noEmit`
- `bunx biome check <path>` — lint a single file/dir
- `bunx tsc --noEmit` — typecheck only (no emit; project is `noEmit: true` always)
- `bun test` — run the test suite (`*.test.ts` files; pure-function coverage only)

The `.bruno/` directory contains Bruno HTTP request collections for ad-hoc exploration of the Zotero local API (items, collections, query, notes/attachments by parent). Useful when debugging what Zotero is returning.

## Architecture

### Entry and lifecycle

`src/index.tsx` is the Logseq plugin entry. On `logseq.ready` it:
1. Tests the connection to Zotero (`testZotConnection` in `services/get-zot-items.ts`).
2. Registers settings via `settings.ts` (`handleSettings`).
3. Registers admin commands via `services/register-admin-commands.ts` (schema setup, schema removal, settings reset).
4. Registers the user-facing commands:
   - Slash `Zotero: Insert full item` → opens the search popup, on pick creates a new Logseq page for the item and links it into the current block.
   - Command palette `Batch import` → opens the batch import view to import many items at once (see **Batch import** below).
   - Page menu `Zotero: Sync annotations` + command palette `Sync all annotations` → fetches new annotations from Zotero and appends them under the matching attachment block.

Both UIs render into the `#app` div and toggle via `logseq.showMainUI()` / `hideMainUI()`: the search popup is `ZotContainer` → `SearchItem` → `ResultCard`, the batch view is `BatchContainer` → `BatchView`. `ResultCard` and the batch view's `SelectableResultCard` share their visual body via `components/ResultCardBody.tsx`.

### Data flow for "Insert full item"

1. `services/get-zot-items.ts` calls Zotero's local API (`/items/top` for parent items, `/items?itemType=note||attachment||annotation` for children) via `wretch`.
2. `services/map-items.ts` transforms raw `ZotItem[]` into the plugin's `ZotData[]`:
   - Adds `attachments` (with their annotations attached), `notes`, `citeKey`, `inGraph`, `libraryLink` (a `zotero://select/library/items?itemKey=…` URI), and `zotero-code` (the Zotero item key).
   - `inGraph` is computed by interpolating `pagenameTemplate` against title/citeKey and checking if a Logseq page with that name exists.
3. User picks a result → `services/insert-zot-into-graph.ts` calls `handle-zot-db.ts`.
4. `handle-zot-db.ts` creates the page, tags it with the configured `zotTag` (default `Zotero`), then iterates the resolved property list (`PROP_PRESETS[preset]` or the custom list from settings) and writes properties with `logseq.Editor.upsertBlockProperty`. Special-cased properties:
   - `creators`, `tags` — each value becomes its own Logseq page; the property gets the page id.
   - `accessDate`, `dateAdded`, `dateModified` — written as Logseq journal page references.
   - `inGraph`, `annotations`, `attachments`, `abstractNote`, `notes`, `version`, `collections`, `pages`, `parentItem`, empty values — skipped.
   - Anything else → string value via `upsertBlockProperty`.
5. Always writes `zotero-code` and `zotero-last-sync` (current ISO timestamp) properties.
6. Attachments + annotations get inserted as a `## Attachments and Annotations` block. Each attachment block gets a `zotero-attachment-key` property so the sync flow can match against it. Annotations are sorted by `annotationSortIndex`.

### Property presets and schema setup

Before importing items the user must run **`Add Zotero schema to Logseq`** from the command palette. This calls `services/set-logseqdb-schema.ts`, which:
- Creates the Zotero tag.
- For each property in the resolved preset (plus always `zotero-code`, `zotero-last-sync`, `zotero-attachment-key`), calls `logseq.Editor.upsertProperty` with the correct type:
  - `creators` → `node` cardinality many
  - `tags` → `node` cardinality many
  - `zotero-last-sync` → `datetime` cardinality one
  - `access-date`, `date-added`, `date-modified` → `date` cardinality one
  - `url`, `libraryLink` → `url` cardinality one
  - everything else → `default`
- Associates every property with the Zotero tag (`addTagProperty`).

Property names are kebab-cased everywhere they touch Logseq (`convert-prop-to-kebab.ts`), **except** `ISSN`/`ISBN`/`DOI` which stay uppercase. Preset definitions live in `src/constants.ts` (`PROP_PRESET_MINIMAL`, `PROP_PRESET_CORE`, `PROP_PRESET_ACADEMIC`) and the master key list is `ZOT_DATA_KEY_MAP`. The `PropertyPreset` setting in `settings.ts` is what selects which preset is active.

### Annotation sync

`services/sync-annotations.ts` reads `zotero-code` and `zotero-last-sync` from the page properties, fetches annotations from Zotero added after `zotero-last-sync` (via `getAnnotationsByItemKey` — note: annotations in Zotero are grandchildren, parent → attachment → annotation), finds the right attachment block by matching its `zotero-attachment-key`, and appends new annotation blocks. After success, `zotero-last-sync` is updated.

The "Sync all annotations" command uses a datascript query (`src/queries.ts:QUERY_ALL_ZOT_PAGES`) to find every page tagged `Zotero`.

### Batch import

`Batch import` (command palette) opens `BatchContainer` → `BatchView`, a centered modal for importing many items at once. A source switcher drives one selectable list:
- **Search** — reuses `useSearchItems` (same recents + fuzzy search as the single-item popup).
- **Collection** / **Saved search** — `hooks/use-batch.ts`: `useBatchSources` populates the pickers from `/collections` and `/searches`; `useContainerItems` fetches the chosen container via `getItemsForCollection` (2 calls — `/collections/{key}/items/top` plus its scoped note/attachment/annotation children) or `getItemsForSavedSearch` (1 call to `/searches/{key}/items`, partitioned into parents/children client-side). Both feed the same `mapItems` join used by the search flow.

The list is `SelectableResultCard`s; selection is a `Map` keyed by Zotero item key that persists across source switches. `services/batch-insert-into-graph.ts` runs the import: sequential, skips `inGraph` items, isolates per-item errors, reports progress, is cancellable between items, and returns `{imported, skipped, failed, cancelled}`. It calls `handleZotInDb(item, pageName, { navigate: false })` — the `navigate` opt (default `true`) gates the page-navigation side effects that suit a single insert but not a batch. The view morphs select → importing (progress bar) → done (`ImportSummary`).

### Key constants

`src/constants.ts`:
- `ZOT_URL` — `http://127.0.0.1:23119/api/users/0` (Zotero connector API).
- `ZOTERO_LIBRARY_ITEM` — `zotero://select/library/items?itemKey=` (used to build `libraryLink`).
- `ZOTERO_PROP` / `ZOTERO_CODE_PROP` / `ZOTERO_LAST_SYNC_PROP` / `ZOTERO_ATTACHMENT_KEY_PROP` — Logseq full property identifiers used when reading existing page properties.

### Template placeholders

`<% placeholder %>` strings are used in `pagenameTemplate` — only `<% citeKey %>` and `<% title %>` are supported. Substitution lives in `resolvePageName` (`services/handle-zot-db.ts`), shared by the single-item and batch paths (and is duplicated in `services/map-items.ts` for the `inGraph` badge).

## Style and tooling

- TypeScript strict mode with `noUncheckedIndexedAccess`. Path alias `../*` → `src/*` (see `tsconfig.json`).
- Biome handles both lint and format. Single quotes, no semicolons, spaces. Import groups: node → packages → aliases → relative paths.
- React 19, react-hook-form for the search form, fuse.js for fuzzy search (`hooks/use-items.ts` filters a locally-cached library snapshot, with a debounced `q=` server fallback), date-fns for dates, wretch for HTTP, lucide-react for icons.
- Release is automated via semantic-release on push to `main` (`.github/workflows/publish.yml`); the workflow builds, zips `dist + README + package.json + icon.svg` as `logseq-zoterolocal-plugin.zip`, and uploads it as a GitHub release asset.
