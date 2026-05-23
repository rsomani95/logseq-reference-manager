# Batch import

Imports many Zotero items into the graph in one pass — the multi-item
counterpart to the `Zotero: Import single item` slash command.

Run **`Zotero: Batch import`** from the slash menu or the command palette. It
opens a modal that moves through three phases: **select → importing → done**.

## How it works

**Pick a source.** One selectable list, fed by a switchable source:

- **Search** — the same recents + fuzzy search as the single-item popup.
- **Collection** / **Saved search** — pick one of your Zotero collections or
  saved searches, shown as inline chips so the common ones are one click away.

A large collection or saved search **streams in** — the first items appear
almost immediately and the rest fill in below, with a quiet *Loading more…*
line marking the tail.

**Select items.** Checkboxes, shift-click for ranges, and a select-all for the
visible list. The selection is keyed by Zotero item key and **persists across
source switches**, so one batch can be assembled from a search plus a
collection plus a saved search. Items already in the graph are shown disabled —
batch import only ever creates new pages, it never updates an existing one.

**Import.** Items are created one at a time, with a progress bar and a
**Cancel** button (cancelling stops after the current item and keeps the rest).
A failure on one item is isolated — it doesn't abort the batch. The final
summary reports **imported / already in graph / failed**, with each failure
listed alongside its reason.

## Limitations

- **One-shot, not a sync.** Re-running is manual; there's no "keep this
  collection in sync" mode.
- Collections larger than `BATCH_FETCH_LIMIT` (1000) are truncated.
- The item list isn't virtualized. The load now streams in chunk by chunk, so
  the first items show up fast — but rendering thousands of rows at once still
  isn't tuned for it.

## Technical

**Entry & shell**

- `src/index.tsx` — registers `Zotero: Batch import` as both a slash command
  and a command palette command (one shared handler).
- `src/BatchContainer.tsx` — mounts `BatchView` into the shared `#app` overlay.
- `src/features/batch-import/index.tsx` — `BatchView`, the orchestrator: owns
  source / selection / phase state and the import flow.

**UI** (`src/features/batch-import/`)

- `SourcePicker.tsx` — inline chip picker for collections / saved searches.
- `SelectableResultCard.tsx` — a checkbox row, wrapping the shared
  `ResultCardBody`.
- `ImportBar.tsx` — phase-aware footer (count + import / progress + cancel /
  done).
- `ImportSummary.tsx` — the post-run breakdown.

**Data**

- `src/hooks/use-batch.ts` — `useBatchSources` (collection + saved-search lists)
  and `useContainerItems` (items for the selected container, streamed in
  chunks — exposes `loading` for the first chunk, `loadingMore` for the rest).
- `src/services/get-zot-items.ts` — Zotero local API calls: `getZotCollections`,
  `getZotSavedSearches`, `getItemsForCollection`, `getItemsForSavedSearch`.
- `src/services/map-items.ts` — the parents + children join. Resolves each
  item's `inGraph` badge in parallel, growing chunks (a per-item Logseq lookup,
  the slow part of a big container), yielding to the browser between chunks so
  each one paints, and streams them back via `onChunk`.
- `src/interfaces.ts` — `ZotCollection`, `ZotSavedSearch`, `BatchSource` types;
  `src/constants.ts` — `BATCH_FETCH_LIMIT`, `MAP_CHUNK_INITIAL` /
  `MAP_CHUNK_MAX` (the streaming chunk sizes).

**Import**

- `src/services/batch-insert-into-graph.ts` — the sequential import loop: skips
  in-graph items, isolates per-item errors, reports progress, supports
  cancellation, and returns the summary.
- `src/services/handle-zot-db.ts` — `handleZotInDb` creates the page (shared
  with single-item import); its `navigate` option suppresses page navigation
  during a batch. Also home to `resolvePageName`.

**Shared with the single-item flow**

- `src/components/ResultCardBody.tsx` — the card body rendered by both
  `ResultCard` and `SelectableResultCard`.
- `src/styles/components.css` — `.batch-*` styles, plus `.zot-backdrop` (the
  modal dim, shared with the search popup).
