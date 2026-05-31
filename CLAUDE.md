# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Logseq **reference manager** (DB graphs only). It collects references from two sources that share one schema (the field set is derived from Zotero's API):

- **Zotero** — the plugin imports items directly from a running Zotero 7+ instance via its local HTTP API on `http://127.0.0.1:23119` (no Zotero Cloud sync). This is the bulk of the codebase.
- **Web** — a companion browser extension (separate repo) clips web pages straight into the graph over Logseq's HTTP API. The plugin does **not** clip the web itself; for this source it only (a) owns the shared schema + the tag the extension writes into, and (b) stores the capture config the extension reads back. See **Web references**.

**Schema model.** A base tag (`zotTag`, default `Reference`) carries all shared properties; Zotero imports are tagged with it directly. The web tag (`webTag`, default `Web`) is a class that `extends` the base, inheriting the same property idents — single base, single level of inheritance (the user explicitly does not want multi-inheritance tag trees).

**Branding.** Display name **"Reference Manager"** (`package.json` `logseq.title`) and plugin **id `logseq-reference-manager`** (`logseq.id`, changed from `logseq-zotero` on 2026-05-25). The id namespaces every stored property — `:plugin.property.logseq-reference-manager/*`, single-sourced as `PLUGIN_ID = pkg.logseq.id` in `constants.ts` — and is the key the companion extension reads settings under, so its `LOGSEQ_PLUGIN_ID` must match. The GitHub repo, npm `name`, repo URLs, and release zip are now `logseq-reference-manager` too (the Logseq marketplace listing, in the separate marketplace repo, still needs updating). Zotero *action* commands keep their `Zotero:` prefix; the title, the `Reference Manager: Settings` command, and the load toast use the display name.

## Design context

Grounding for any UI/visual work. Established via the `design-for-ai` skill.

**Purpose.** Pulling a Zotero reference into Logseq should feel instant and native. The generated page is not an archive record — it's the user's note-taking workbench and a link target from across their graph. Design the page, *and the act of importing it*, as the **start** of work, not the end.

**Primary user.** A practitioner-researcher — equal parts academic and PKM user, leaning practical. Reads papers daily; manages references in Zotero but thinks in Logseq. Representative voice: *"My Zotero pages in Logseq are where I actually think — I take all my notes there and link to them from everywhere else."* Needs: near-zero-friction import; a generated page that's a good place to **write**, not a metadata dump; nothing that feels foreign inside Logseq; reliable speed every time.

**Aesthetic direction.** Calm, fast, warm — roughly that order of dominance. Craft level of **Vercel / Arc, expressed with restraint**: flair lives in the details (timing, easing, a confident type scale, considered empty states) — never in decoration (no gradients for their own sake, no motion as ornament). *Not* over-designed or flashy; *not* cold or templatey. Appropriate polish, not maximum polish.

**Medium / constraints.** React 19 inside Logseq's plugin iframe. Mirror Logseq's resolved theme tokens (light + dark) — native feel is a feature, not a limitation. Elevate with shadow, not borders; surface color matches page background. Target **WCAG AA** (contrast, visible focus, keyboard navigation).

**Open design questions** (structure precedes styling):
- **Invocation surface is not settled.** Today: slash command → search popup (single item); command palette → centered modal (batch). Single-as-slash feels right; batch may also become a slash command. The *form* of invocation — popup, modal, inline, palette — is an active design decision per use case, not a fixed constraint.
- **Two use cases, different weights.** (1) Mid-writing single import — near-instant, minimal ceremony. (2) Deliberate batch import from a collection/saved search — can carry more UI. Invocation and layout of each should follow from this difference.

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

## SDK notes

DB-graph Logseq plugin SDK quirks (property API — including the `hide?` deletion/display gotchas — theming, dev workflow, debugging) and the local HTTP API for probing a running graph are collected in [`LOGSEQ_SDK_NOTES.md`](./LOGSEQ_SDK_NOTES.md). Check there first when an `@logseq/libs` call behaves unexpectedly.

## Architecture

### Entry and lifecycle

`src/index.tsx` is the Logseq plugin entry. On `logseq.ready` it:
1. Tests the connection to Zotero (`testZotConnection` in `services/get-zot-items.ts`).
2. Registers settings via `settings.ts` (`handleSettings`).
3. Registers the commands:
   - Slash `Zotero: Import single item` → opens the cursor-anchored search popup; on pick creates a new Logseq page for the item and links it into the current block. Slash-only — it needs an active block to link into.
   - Slash + command palette `Zotero: Batch import` → opens the batch import view to import many items at once (see **Batch import** below). Both surfaces share one handler; the modal is cursor-independent, so it works from either.
   - Page menu `Zotero: Sync annotations` + command palette `Zotero: Sync all annotations` → (re-)import a PDF's annotations as first-class Logseq highlight blocks (see **Annotation import** below). `Sync all` runs the importer over every page carrying the configured base tag (`QUERY_ALL_ZOT_PAGES`, parameterized on `zotTag`), isolating per-page failures and aggregating one summary toast.
   - Command palette `Reference Manager: Settings` → opens the setup hub (see **Setup hub** below), the single home for all configuration — General (shared schema + author formatting), Zotero (connection, import formats, tag rules), and Web references. (The Zotero *action* commands above keep their `Zotero:` prefix since they genuinely act on Zotero.)

All UIs render into the `#app` div and toggle via `logseq.showMainUI()` / `hideMainUI()`: the search popup is `ZotContainer` → `SearchItem` → `ResultCard`, the batch view is `BatchContainer` → `BatchView`, the setup hub is `SetupContainer` → `SetupApp` → its section components. `ResultCard` and the batch view's `SelectableResultCard` share their visual body via `components/ResultCardBody.tsx`.

### Setup hub

`Reference Manager: Settings` opens `SetupContainer` → `SetupApp` (`src/features/setup/`), the single surface for all configuration. The native settings panel is reduced to a launcher heading + a live connection-status line; its real keys stay in the schema (their rows hidden via injected CSS — see `HIDDEN_KEYS` in `settings.ts`) only so Logseq populates defaults on a fresh install. The left-nav is **grouped into three top-level sections** — General (shared), Zotero, Web references (`NAV` in `features/setup/index.tsx` carries a `group` per item; a group label renders when the group changes). "General" holds what both sources share — the schema and the creator formatting:
- **General → Schema** (`SchemaSection`) — the shared property schema both sources inherit: the base tag name (`zotTag`), `propertyPreset` (with a read-only `PresetFieldList` disclosure of what Essentials/Full include), the searchable custom-property `PropertyPicker` (Custom only), an explicit **Apply schema** button (`setLogseqDbSchema`), and a **Danger zone** that deletes the created schema (`services/delete-zotero-schema.ts`). Presets live here, not under Zotero, because both Zotero and Web inherit them.
- **General → Authors** (`AuthorsSection`) — the shared creator formatting, lifted out of Import formats because it applies to every source: `creatorNameTemplate` / `creatorSeparator` (dropdown + input) with a live preview, and `creatorsAsNodes` ("store creators as page references"; authors shown as `[[links]]` in the preview when on). `creatorsAsNodes` sets the creators property *type* (node/default), which the Web tag inherits via `extends`, so it's owned by the lifted schema state and shows the same **Re-apply schema** footer as the Schema section. The name format / separator are self-persisted and (for now) shape Zotero imports only — the web clipper doesn't read them yet (see **Web references**). The page-name and author previews both render from a real library item via the shared `useFmtSample` hook (`features/setup/use-fmt-sample.ts`, falling back to a built-in sample).
- **Zotero → Connection** (`ConnectSection`) — live connection test (`testZotConnection`).
- **Zotero → Import formats** (`FormatsSection`) — Zotero-only page naming: `pagenameTemplate` / `pagenamePrefix` (dropdown + prefix input) with a live page-name preview (shared `useFmtSample`). Author formatting moved to **General → Authors**, attachment behavior moved to **Zotero → Attachments**; nothing left here touches the schema, so there's no re-apply footer.
- **Zotero → Attachments** (`AttachmentsSection`) — how Zotero attachments come into the page. `attachmentImportMode` (`PDFs only` (default) / `All attachments`) gates the filter; `attachmentsBlockName` (default `Attachments`) renames the wrapping block; `openAttachmentInline` lives here now (it only affects non-PDF markdown links — PDFs always go through the asset-block path); `attachmentShowExternalLinks` toggles an extra "open externally" links block, and reveals `attachmentExternalPdfLabel` (default `Open PDF Outside Logseq`) when on. See **Attachments** under the data-flow section for the shape it emits.
- **Zotero → Annotations** (`AnnotationsSection`) — PDF-annotation import config: the **Logseq API token** (with a "Test connection" button → `testLogseqApi`) the write path needs, the highlight color (`annotationColor`: `auto` nearest-pastel, or a forced color), and an advanced API base URL (`logseqApiBaseUrl`). See **Annotation import**.
- **Zotero → Tag rules** (`TagRulesSection`) — the rule builder (see **Extended tags**).
- **Web references** (`WebSection`) — `webTag` + the five capture keys the companion extension reads (see **Web references**), plus a **Set up web tag** button (`ensureWebTagExtendsBase`) that makes the web class `extends` the base tag. Gated on the base schema already being applied.

Simple controls autosave (`updateSettings`); the heavy ops — Apply schema, schema delete, Tag rules' Save, and Set up web tag — are explicit. `SetupApp` probes connection + `isSchemaAdded` on open, ticks the completed gating sections (`GATING = ['connect', 'schema']`), and lands on the first incomplete one. The dev-facing reference (every settings key, how to add a setting, the hidden-keys mechanism) lives in [`settings.md`](./settings.md).

### Data flow for "Import single item"

1. `services/get-zot-items.ts` calls Zotero's local API (`/items/top` for parent items, `/items?itemType=note||attachment||annotation` for children) via `wretch`.
2. `services/map-items.ts` transforms raw `ZotItem[]` into the plugin's `ZotData[]`:
   - Adds `attachments` (with their annotations attached), `notes`, `citeKey`, `inGraph`, `libraryLink` (a `zotero://select/library/items?itemKey=…` URI), and `zotero-code` (the Zotero item key).
   - `inGraph` is computed by `buildZoteroCodeIndex` (`services/zotero-code-index.ts`): a Logseq page is in-graph when it carries a `zotero-code` property matching the item's Zotero key. Matching the key — not a name rebuilt from `pagenameTemplate` — means renaming an imported page in Logseq doesn't flip its badge back to "not in graph". The search popup's cached snapshot can't see graph changes made after it was fetched, so `useSearchItems` re-runs the index (`refreshInGraphFlags`) over the cached items each time the popup reopens (keyed off an `openedAt` prop threaded from `index.tsx`).
3. User picks a result → `services/insert-zot-into-graph.ts` calls `handle-zot-db.ts`. If the item is already in the graph (matched by `zotero-code`, so rename-proof), no page is created — the existing page is linked into the current block instead.
4. `handle-zot-db.ts` creates the page, tags it with the configured `zotTag` (default `Reference`), then iterates the resolved property list (`PROP_PRESETS[preset]` or the custom list from settings) and writes properties with `logseq.Editor.upsertBlockProperty`. Special-cased properties:
   - `creators`, `tags` — each value becomes its own Logseq page; the property gets the page id.
   - `accessDate`, `dateAdded`, `dateModified` — written as Logseq journal page references.
   - `inGraph`, `annotations`, `attachments`, `abstractNote`, `notes`, `version`, `collections`, `pages`, `parentItem`, empty values — skipped.
   - Anything else → string value via `upsertBlockProperty`.
   `handleZotInDb` returns `{ status: 'created' | 'exists', pageName }` — `'exists'` (no page created) when the `zotero-code` index already has the item; `pageName` is then the existing page's current title.
5. Always writes the `zotero-code` property (the Zotero item key — the in-graph match key).
6. Attachments + annotations get inserted under a wrapping block whose name is the `attachmentsBlockName` setting (default `Attachments`). Per attachment, the emitted block depends on its Zotero `linkMode`:
   - **`linked_file` PDF** (real on-disk path + PDF MIME or `.pdf` extension) — emitted as a first-class Logseq asset block: block content is the title, and `:logseq.property.asset/type|external-url|checksum|size` + the `logseq.class/Asset` tag together make the block an asset entity. That's what activates the embedded PDF viewer's annotation tooling without popping the "Create asset" modal on first highlight. The `file://` URL is **percent-encoded per segment** (PDF.js consumes the URL directly, so this branch wants a real encoded URL — different from the markdown-link branch). Helpers: `pathToFileUrl`, `extensionFromPath`, `sha256Hex` in `handle-zot-db.ts`.
   - **Everything else** (non-PDF `linked_file`, `imported_file` including PDFs there, `linked_url`) — emitted as a plain markdown link. `openAttachmentInline`'s `!` prefix toggles embed vs. external open. URL form per mode follows the rules in [`dev_notes/LOGSEQ_FILE_LINKS.md`](./dev_notes/LOGSEQ_FILE_LINKS.md) — bare absolute path with literal characters for `linked_file`, Zotero's enclosure URL for `imported_file`, the web URL for `linked_url`.
   Each per-attachment block carries the `zotero-attachment-key` property (so annotation sync can match it). Annotations are **not** inlined here as plain text — after the page is built, `handle-zot-db.ts` runs the annotation importer for each on-disk PDF asset, so highlights arrive as first-class `Pdf-annotation` blocks (see **Annotation import**).
   In `PDFs only` mode (the default), non-PDF attachments are skipped entirely before any of the above runs. When `attachmentShowExternalLinks` is on, a single trailing block is appended at the bottom of the wrapper with `[Open PDF Outside Logseq](bare/path) · [Open in Zotero](library_link)` — each link drops out individually if its target isn't available (no on-disk PDF found, etc.). The split is intentionally not 1:1 (an item may have several attachments; the Zotero link goes to the whole item) — the practitioner-researcher case assumes a single "PDF of interest".

### Property presets and schema setup

Before importing items the user clicks **Apply schema** in the setup hub's Schema section (`Reference Manager: Settings`). This calls `services/set-logseqdb-schema.ts`, which:
- Creates the base tag (`zotTag`, default `Reference`).
- For each property in the resolved preset (plus always `zotero-code`, `zotero-attachment-key`), calls `logseq.Editor.upsertProperty` with the correct type:
  - `creators` → `node` cardinality many
  - `tags` → `node` cardinality many
  - `access-date`, `date-added`, `date-modified` → `date` cardinality one
  - `url`, `libraryLink` → `url` cardinality one
  - everything else → `default`
  - The type is only set when the property is **first created** — re-apply checks `getProperty` first and skips the `upsertProperty` for any property that already exists (Logseq won't change a property's type once it has values, and the refused call *hangs* the SDK; see [`LOGSEQ_SDK_NOTES.md`](./LOGSEQ_SDK_NOTES.md)). The per-property display attributes below still re-run every time. Each property is isolated so one failure can't abort the rest, and a wanted-but-blocked type change is surfaced to the user (delete schema + re-apply to change a type).
- Associates every property with the base tag (`addTagProperty`).
- Finally, if `webTag` is set, ensures the web tag exists and `extends` the base tag — `ensureWebTagExtendsBase` (`services/set-web-schema.ts`) — so web clips inherit the same property idents *without* re-associating each property onto the web class. The Web references section can run the same step on its own. `addTagExtends` is idempotent; a `webTag` equal to the base is a no-op.

Property names are kebab-cased everywhere they touch Logseq (`convert-prop-to-kebab.ts`), **except** `ISSN`/`ISBN`/`DOI` which stay uppercase. The active preset is the `propertyPreset` setting: `Essentials` (the curated `PROP_PRESET_ESSENTIALS` in `src/constants.ts`), `Full` (everything in the master key list `ZOT_DATA_KEY_MAP`), or `Custom` (the `pageProps` list chosen via the hub's `PropertyPicker`). The Schema section's **Danger zone** (`services/delete-zotero-schema.ts`) removes every property the plugin created (via `removeProperty`, matched by the `ZOTERO_PROP` ident namespace so the user's own are never touched). It deliberately leaves the tag/class pages (base + web) intact — deleting them would clear their backlinks, so that's a manual op. Properties use `removeProperty`, not `deletePage(title)`, which silently no-ops on a property entity (the bug behind the old command's false-success).

### Web references

The plugin doesn't clip the web — a companion browser extension (separate repo, `logseq-web-clipper`) does, writing pages into the graph over Logseq's HTTP API. The extension **reads** the plugin's live `logseq.settings` over that API (`getStateFromStore(['plugin/installed-plugins', 'logseq-reference-manager', 'settings'])`, kebab id) but **cannot write** them, so the setup hub is the only editing surface. That makes six keys a **contract** — registered in `settings.ts` (hidden in the native panel), edited in `WebSection`:

| key | default | meaning (how the extension uses it) |
|---|---|---|
| `webTag` | `Web` | tag every clipped page carries; the extension's clip tag + schema-discovery target + URL-dedupe key |
| `webCapturePageContent` | `true` | capture the article body as a block |
| `webPageContentBlockName` | `Page Content` | heading the article body nests under |
| `webHighlightsBlockName` | `Highlights` | heading highlights nest under |
| `webUseHeadingMarkers` | `false` | keep Markdown `#` markers on headings (off → nest by indentation) |
| `webPopulatePageTags` | `false` | pre-fill the page's tags from its own keywords |

The extension discovers the schema by walking `webTag`'s **inherited** properties, so the web class must `extends` the base tag — `ensureWebTagExtendsBase` (`services/set-web-schema.ts`, run by Apply schema and by the Web section's button) guarantees this; without it the extension aborts the clip ("schema not set up"). **Renaming any key — or the plugin id — breaks the extension** unless its mapping (`logseq-remote-settings.ts`) / its single-sourced `LOGSEQ_PLUGIN_ID` is updated in lockstep. Full handoff context lives in the extension repo's `LOGSEQ_SETTINGS_INTEGRATION.md`.

### Annotation import

Imports a PDF's annotations as **first-class `:logseq.class/Pdf-annotation` highlight blocks** — clickable, queryable, linkable, rendered by Logseq's PDF viewer — replacing the old plain-text-under-the-attachment insertion + timestamp-delta sync. Runs automatically at import (single + batch) and on demand via the Sync commands.

**The vendored core** (`src/services/pdf-annot/`) is a faithful, golden-tested port of [`pdf-annot-logseq`](../pdf-annot-logseq)'s stage 1 — `extract` (native PDF `/Annots` → records), `convert` (→ the Logseq `hl-value` geometry shape), `zotero` (Zotero-DB annotations → the same shape), `geometry`/`colors`/`pdf-pages`/`uuid`/`edn`/`validate`. The PDF engine is **mupdf** (WASM); `extract.ts` / `pdf-pages.ts` are the only modules that touch it. Treat this dir as a vendored port — its coordinate transform is validated to ~1e-13; don't edit its math (re-sync from the prototype instead). Tests + golden fixtures live alongside under `__fixtures__/`.

**The picking rule** (`services/import-annotations.ts`, `importAnnotationsForAsset`): read the PDF's bytes → `convert(extract(bytes))`. If that yields **any record**, the file was annotated externally (Preview / PDF Expert / …) → use it and **ignore Zotero** (the file is the better source; it even recovers FreeText notes Zotero drops). Otherwise fall back to **Zotero's database** annotations for that attachment (`convertZoteroAnnotations` + page geometry from the file). The decision keys off *converted records*, not the bare presence of an `/Annots` entry — a file whose only marks are ink/stamps/form-field widgets converts to zero records and correctly falls through rather than silently importing nothing. mupdf is loaded via a dynamic `import('./pdf-annot')` so its ~10 MB WASM only loads when annotations are actually imported.

**The write path** (`services/logseq-transit.ts` + `logseq-import-edn.ts`): `@logseq/libs` can't set the closed-value `:logseq.property.pdf/hl-color` ref or the `hl-value` EDN map, so records are written through Logseq's own **`build-import`**, reached over the desktop **HTTP API** (`logseq.cli.import_edn`). `logseq-transit.ts` builds the `sqlite.build` payload (mirroring `pdf-annot/edn.ts` `emitLiveEdn` — annotation blocks parented under the asset by uuid, declared under the host page by title) and hand-encodes it as **Transit-JSON** (the arg shape that method expects — *not* raw EDN); `logseq-import-edn.ts` POSTs it with the API token, treating an HTTP-200-with-`{error}`-body as a failure. Idempotent: every block keeps a stable `:block/uuid` with `:build/keep-uuid?` (the PDF path reuses each annotation's `/NM`; the Zotero path derives a deterministic v5 uuid from `(libraryID, key)`), so re-running upserts instead of duplicating. The full write-path rationale + the Transit/`file://`/mupdf-in-iframe findings are in [`dev_notes/LOGSEQ_SDK_NOTES.md`](./dev_notes/LOGSEQ_SDK_NOTES.md).

**Reading bytes** (`services/read-pdf-bytes.ts`): Zotero's local API only `302`-redirects `/items/<key>/file` to a `file://` URL, so the plugin reads the file itself (`fetch` → `XMLHttpRequest` fallback) — confirmed permitted in the plugin iframe.

**Where it runs:**
- **At import** — `handle-zot-db.ts` collects each on-disk PDF it turned into an asset block and, after the page is built, runs `importAnnotationsForAsset` per asset. Best-effort and isolated (a failure never fails the item import); skipped with a one-time hint when no API token is set (single import only — quiet during batch).
- **Sync** — `Zotero: Sync annotations` (page menu) → `syncAnnotationsForPage`, which finds the page's PDF asset block(s) via `services/find-pdf-asset.ts` (matching `:logseq.property.asset/external-url` + `zotero-attachment-key` on the page's blocks) and re-imports each, isolating per-target failures. `Zotero: Sync all annotations` runs that across every page carrying the base tag (`src/queries.ts:QUERY_ALL_ZOT_PAGES`, parameterized on `zotTag`), pre-checking the token and aggregating one summary toast.

**Setup:** needs Logseq's **HTTP APIs Server** enabled + its token saved as `logseqApiToken` (set in the hub's **Annotations** section, `AnnotationsSection`). `annotationColor` (`auto` = nearest-pastel, or a forced color) and `logseqApiBaseUrl` live there too.

### Batch import

`Zotero: Batch import` (slash or command palette) opens `BatchContainer` → `BatchView`, a centered modal for importing many items at once. A source switcher drives one selectable list:
- **Search** — reuses `useSearchItems` (same recents + fuzzy search as the single-item popup).
- **Collection** / **Saved search** — `hooks/use-batch.ts`: `useBatchSources` populates the pickers from `/collections` and `/searches`; `useContainerItems` fetches the chosen container via `getItemsForCollection` (2 calls — `/collections/{key}/items/top` plus its scoped note/attachment/annotation children) or `getItemsForSavedSearch` (1 call to `/searches/{key}/items`, partitioned into parents/children client-side). Both feed the same `mapItems` join used by the search flow — which resolves each item's `inGraph` badge (`buildZoteroCodeIndex` builds a Zotero-key → page index once, then each badge is an instant Map lookup), walks the list in growing chunks, and streams them back via an `onChunk` callback, so the list paints progressively rather than in one jump. `useContainerItems` surfaces this as `loading` (first chunk) and `loadingMore` (the rest).

The list is `SelectableResultCard`s; selection is a `Map` keyed by Zotero item key that persists across source switches. `services/batch-insert-into-graph.ts` runs the import: sequential, skips `inGraph` items, isolates per-item errors, reports progress, is cancellable between items, and returns `{imported, skipped, failed, cancelled}`. It builds the `zotero-code` index once and passes it to each `handleZotInDb(item, …, { navigate: false, zoteroCodeIndex })` call; the `navigate` opt (default `true`) gates the single-insert page-navigation side effects, and an `'exists'` return (item already in graph) counts as skipped. The view morphs select → importing (progress bar) → done (`ImportSummary`).

### Extended tags

`src/extended-tags.ts` lets the user apply extra Logseq tags to imported items that match rules. The storage format is a JSON array of `TagRule`s in the `tagRules` setting: `{ tag, match: 'any' | 'all', when: [{ field, op: 'contains' | 'equals' | 'regex', value }] }`. `parseTagRules` validates raw input into the well-formed subset (lenient on field names — any string is accepted, unknown fields just never match, so future Zotero fields work without parser changes). At import, `handle-zot-db.ts` calls `getConfiguredTagRules` + `matchTagRules(item, rules)` and adds every matched tag on top of the base `zotTag`.

Rules are edited in the setup hub's **Tag rules** section (`features/setup/TagRulesSection.tsx`, reusing `features/tag-rules/`: `RuleCard` → `ConditionRow`/`FieldSelect`) — reached via `Reference Manager: Settings`, not by hand-writing JSON. It works on a *draft* model (`DraftRule`/`DraftCondition` with client ids); `validateDraftRules` is the bridge back to the strict format (stricter than `parseTagRules` on one point — it rejects an empty `value`, since a blank `contains` would match everything), and `serializeRules` writes the result back to `tagRules` via `logseq.updateSettings`. Errors stay hidden until the first Save attempt, then validate live. `FieldSelect` offers curated common fields (`services/tag-rule-fields.ts`) first, the rest below, and a custom-entry escape hatch for the parser's any-string forward-compat.

`tagRules` isn't shown in the native settings panel at all — every editable row is hidden there (see `HIDDEN_KEYS` / `applySettingsStyles` in `settings.ts`, the inject-scoped-CSS trick the iframe needs because it can't reach the panel DOM). `services/watch-tag-rules.ts` still toasts parse errors as a safety net for externally-edited JSON.

### Backward compatibility

**Don't ship backward-compat shims for stored data shapes.** When renaming or restructuring something the user has already written into their graph — block headings, setting keys, property names, on-disk formats — write the new shape only. Do **not** accept multiple values for a field, keep a legacy-names constant, layer migration code that reads the prior shape, or preserve old keys "for safety". The user re-imports / re-applies trivially and prefers a clean codebase to a forgiving one. Flag the breaking change explicitly in the response so they can run whatever migration they want manually.

Past example: the annotation flow was rewritten from plain-text blocks under the attachment (plus a `zotero-last-sync` timestamp delta) to first-class `Pdf-annotation` highlight blocks via `build-import` (see **Annotation import**). The old `sync-annotations.ts`, its timestamp dedup, and the inline insertion were deleted outright — no shim reads or migrates the old plain-text annotations; re-running Sync re-imports them in the new shape.

### Key constants

`src/constants.ts`:
- `ZOT_URL` — `http://127.0.0.1:23119/api/users/0` (Zotero connector API).
- `LOGSEQ_API_BASE_DEFAULT` — `http://127.0.0.1:12315` (Logseq's desktop HTTP API; the annotation write path POSTs here — see **Annotation import**).
- `ZOTERO_LIBRARY_ITEM` — `zotero://select/library/items?itemKey=` (used to build `libraryLink`).
- `ZOTERO_PROP` / `ZOTERO_CODE_PROP` / `ZOTERO_ATTACHMENT_KEY_PROP` — Logseq full property identifiers used when reading existing page properties (`zotero-code` for the in-graph index, `zotero-attachment-key` for annotation-asset lookup). (The old `zotero-last-sync` property + its `ZOTERO_LAST_SYNC_PROP` constant were removed once the annotation flow became uuid-idempotent — nothing read the timestamp anymore.)

### Template placeholders

`<% placeholder %>` strings fill `pagenameTemplate` (`<% citeKey %>`, `<% title %>`) and `creatorNameTemplate` (`<% firstName %>`, `<% lastName %>`). Substitution lives in pure, tested functions in `services/resolve-templates.ts` (`applyPageNameTemplate` / `applyCreatorTemplate`) — tolerant of placeholder case/whitespace, stripping unknown tokens, and falling back to a collision-safe name when a template carries no usable placeholder. `handle-zot-db.ts`'s `resolvePageName` / `resolveCreatorName` wrap them with the value from settings, and the Formats preview renders through the same functions, so preview == import output. The `inGraph` badge doesn't use templates — detection matches the `zotero-code` property, not a templated page name.

## Style and tooling

- TypeScript strict mode with `noUncheckedIndexedAccess`. Path alias `../*` → `src/*` (see `tsconfig.json`).
- Biome handles both lint and format. Single quotes, no semicolons, spaces. Import groups: node → packages → aliases → relative paths.
- **Typography tokens.** `src/styles/components.css` opens with a `:root` block of `--zot-*` tokens — type scale, weights, leading, tracking. Use them; don't hardcode `font-size`/`font-weight`/`line-height`/`letter-spacing`. Font families inherit from Logseq's theme via `--zot-font` / `--zot-font-mono` (the plugin ships no face of its own).
- **Color tokens.** Same `:root` block, plus an `html[data-theme="dark"]` override. Three layers: Layer 1 (`--zot-color-bg`/`-text`/`-border`/`-hover`/…) mirrors Logseq's theme through the synced `--ls-*` vars — never override the host's surfaces or text; Layer 2 is the plugin's own functional palette (`--zot-color-success`/`-danger` with their `*-fill` variants for solid buttons, `--zot-color-mark-*` for the warm search highlight), theme-split via the dark block; Layer 3 is elevation (`--zot-shadow-modal`, `--zot-color-backdrop`). `--zot-color-accent-host` tracks Logseq's accent (`--ls-active-primary-color`) and is the plugin's host-matching hue — `:focus-visible` rings, selection tints, **and** links + the primary action. `--zot-color-info` is **not** a plugin blue: it aliases the accent, so links read as the host's. The primary button *tints* with the accent (accent text/border on a faint wash) rather than filling with it — white-on-accent can fail WCAG AA when the host accent is light (even Logseq's default is ~4.2:1). Use the tokens; don't hardcode hex/rgba.
- **Motion tokens.** Same `:root` block: `--zot-ease-out` / `--zot-ease-in-out` and `--zot-duration-micro` (100ms) / `--zot-duration-standard` (280ms). Use them — don't hardcode timings or `cubic-bezier`s. Arrivals are the only motion the plugin owns: there is **no exit curve** — dismissal is an instant `logseq.hideMainUI()` cut. Entries (backdrop fade, batch modal scale-in, the whisper-fast cursor-anchored popup) and phase morphs animate only `transform`/`opacity`; a global `@media (prefers-reduced-motion: reduce)` block collapses them. The search popup persists across slash invocations, so `SearchItem` restarts its entry animation imperatively per `openedAt` (the CSS animation alone fires once) and clamps its cursor-anchored position to the viewport. Result lists are keyboard-navigable via one shared model — both are `aria-activedescendant` listboxes that track a single active row (`.result-card-active`); cards never take DOM focus. `↑/↓` and the emacs bindings `Ctrl-N`/`Ctrl-P` move the active row (mapped by `listNavIntent` in `src/keyboard.ts`). The search popup's combobox `input` keeps focus and `Enter` picks. The batch view attaches its keydown handler to the `.batch-container` root (not the listbox) so arrows reach the list no matter which control holds focus (search input, source chip, select-all, the list); `Enter` toggles from the search input or the list, `Space` toggles only from within the list (so it doesn't eat a query space or hijack the select-all checkbox / buttons). Container sources (Collection/Saved search) have no text input, so `BatchView` makes `.batch-results` focusable and hands it focus once the first items load — its active row then shows a `:focus-visible` ring on top of the fill.
- React 19, react-hook-form for the search form, fuse.js for fuzzy search (`hooks/use-items.ts` filters a locally-cached library snapshot, with a debounced `q=` server fallback), date-fns for dates, wretch for HTTP, lucide-react for icons.
- Release uses **manual versioning**: `package.json` `version` is the single source of truth. Bump it and push to `main`; `.github/workflows/publish.yml` reads the version, and if `v<version>` isn't already tagged, builds + zips `dist + README + package.json + icon.svg` as `logseq-reference-manager.zip`, then creates a GitHub release `v<version>` (tag included) with auto-generated notes and that zip. Pushing without a version bump is a no-op, so it's safe. (Was semantic-release; dropped 2026-05-26 because the marketplace doesn't require it and it forced a 1.x line — we want to stay in 0.x.)
