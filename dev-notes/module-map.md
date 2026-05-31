# Module map — where everything lives

A directory-by-directory guide to `src/`, built to **structure your
exploration**, not to explain implementations. Read [`architecture.md`](./architecture.md)
first for the mental model; this is the companion that tells you which file to
open.

> Reflects `main` as of **2026-05-31**.

---

## How `src/` is organised

Five conventions, learned once:

- **`src/*.ts(x)` at the root** — the entry point, the three top-level React
  *containers*, and cross-cutting modules (settings, constants, interfaces,
  queries, keyboard).
- **`features/`** — one folder per UI surface. Each owns its components and
  feature-local hooks. This is the "screens" layer.
- **`services/`** — the logic layer. Pure-ish functions and side-effecting
  calls to Zotero, Logseq, and the filesystem. **No JSX** (one exception:
  `item-type-icon.tsx`). If it talks to an API or transforms data, it's here.
- **`hooks/`** — React hooks shared across more than one feature.
- **`components/`** — React components shared across more than one feature.
- **`styles/`** — global CSS (theme tokens + backdrop).

Containers vs. features: a *Container* (`ZotContainer`, `BatchContainer`,
`SetupContainer`) is the thin shell that mounts a feature into `#app`, syncs the
theme, and handles the iframe lifecycle. The *feature* is the actual UI.

---

## The tree, annotated

```
src/
├── index.tsx                  ⭐ ENTRY. Registers every command on logseq.ready;
│                                 wires slash/palette/page-menu → the containers.
├── handle-popup.ts               Global Escape → hideMainUI handler.
├── settings.ts                   Native settings schema + the hidden-keys CSS trick.
├── constants.ts                  PLUGIN_ID, API URLs, presets, prop display
│                                 names/descriptions, the Zotero field master list.
├── interfaces.ts                 The data model: ZotItem (raw Zotero) → ZotData
│                                 (plugin shape) + all the supporting types.
├── queries.ts                    Datascript queries (e.g. "all pages with zotTag").
├── keyboard.ts                   Shared list-navigation intent (↑/↓, Ctrl-N/P).
├── extended-tags.ts              Tag-rule storage format + matching engine.
├── web-sections.ts               The web-clip section contract (names/fold/order).
├── global.d.ts                   Ambient types.
│
├── ZotContainer.tsx           ── mounts → features/search-item   (single import)
├── BatchContainer.tsx         ── mounts → features/batch-import   (batch import)
├── SetupContainer.tsx         ── mounts → features/setup          (the config hub)
│
├── components/
│   ├── ResultCard.tsx            A search result row (single-import popup).
│   └── ResultCardBody.tsx        The shared visual body of a result card
│                                 (reused by SelectableResultCard in batch).
│
├── hooks/
│   ├── use-items.ts              useSearchItems — backs the search popup AND the
│   │                             batch "Search" source (recents + server search).
│   └── use-batch.ts              Collection / saved-search sources + chunked load.
│
├── features/
│   ├── search-item/              Single-import search popup (cursor-anchored).
│   ├── batch-import/             Batch modal: source picker → selectable list →
│   │                             import progress → summary.
│   ├── setup/                    ⭐ The setup hub. One section component per nav
│   │                             item (Schema, Authors, Connect, Formats,
│   │                             Attachments, Annotations, TagRules, Web) + the
│   │                             schema-state and format-preview hooks.
│   └── tag-rules/                The rule-builder UI (used inside setup's
│                                 TagRulesSection): RuleCard → ConditionRow.
│
├── styles/
│   ├── components.css            ⭐ The token system (--zot-* type/color/motion)
│   │                             + all component styles. Read its :root block
│   │                             before styling anything.
│   └── bg.css                    The showMainUI backdrop.
│
└── services/                  ── the logic layer; grouped by concern below
```

---

## `services/` by concern

There are ~30 service files. Grouped by what they touch:

### Read from Zotero
| File | Responsibility |
|---|---|
| `get-zot-items.ts` | All Zotero local-API calls (`wretch`); also `testZotConnection`. |
| `map-items.ts` | `ZotItem[]` → `ZotData[]`: join children, compute `inGraph`, build `citeKey`/`libraryLink`. The Zotero→plugin boundary. |
| `parse-html.ts` | Zotero note HTML → Logseq block tree. |

### In-graph state / lookups
| File | Responsibility |
|---|---|
| `zotero-code-index.ts` | Zotero-key → page index; the `inGraph` badge (rename-proof). |
| `find-pdf-asset.ts` | Find a page's PDF asset block(s) for annotation sync. |
| `is-schema-added.ts` | Does the plugin's schema exist in this graph? |
| `is-recycled-page.ts` | Detect Logseq's 30-day soft-deleted pages (else stale hits). |

### Write pages (import)
| File | Responsibility |
|---|---|
| `insert-zot-into-graph.ts` | Single-import orchestration (calls `handle-zot-db`). |
| `handle-zot-db.ts` | ⭐ **The heart of import.** Page creation, typed property writes, attachment blocks, tag-rule application, then annotation import. |
| `batch-insert-into-graph.ts` | Batch loop: sequential, cancellable, skips in-graph, isolates per-item errors. |

### Schema setup
| File | Responsibility |
|---|---|
| `set-logseqdb-schema.ts` | ⭐ **Apply schema:** create base tag, upsert each property with its type, associate, wire the web tag. |
| `delete-zotero-schema.ts` | Danger-zone schema teardown (the `hide?`/settle dance — see SDK notes). |
| `set-web-schema.ts` | `ensureWebTagExtendsBase` — make the web class `extends` the base. |
| `convert-prop-to-kebab.ts` | kebab-case property names (except ISSN/ISBN/DOI). |
| `page-props-choice.ts` | Format/parse the custom property-picker choices. |
| `schema-snapshot.ts` | The "applied schema" snapshot → drives the Apply-button enable/disable diff. |

### Templates & tag rules
| File | Responsibility |
|---|---|
| `resolve-templates.ts` | `<% … %>` substitution for page-name + creator templates (pure, tested). |
| `tag-rule-fields.ts` | Curated field list for the rule builder's FieldSelect. |
| `watch-tag-rules.ts` | Toasts parse errors for externally-edited rule JSON. |
| (`../extended-tags.ts`) | Rule storage format + `matchTagRules` (at `src/` root). |

### Annotation import
| File | Responsibility |
|---|---|
| `import-annotations.ts` | ⭐ The picking rule (native PDF first, Zotero fallback) + `syncAnnotationsForPage`. |
| `read-pdf-bytes.ts` | Read a PDF's bytes off disk (`fetch`/XHR on a `file://` path). |
| `logseq-transit.ts` | Build the `build-import` payload + hand-encode it as Transit-JSON. |
| `logseq-import-edn.ts` | POST that payload to Logseq's HTTP API (`:12315`); token handling. |
| `pdf-annot/` | ⭐ **Self-contained, golden-tested extraction core** (see below). |

### UI glue
| File | Responsibility |
|---|---|
| `sync-theme.ts` | Mirror Logseq's `--ls-*` theme vars onto the iframe `:root` (+ re-sync on theme change). |
| `item-type-icon.tsx` | Map a Zotero item type → a lucide icon (the only JSX in `services/`). |

---

## The `pdf-annot/` extraction core

A self-contained, golden-tested module — originally ported from the
[`pdf-annot-logseq`](../../pdf-annot-logseq) prototype's stage 1, now
**first-party** (develop here; the prototype was the lab for the math, not an
upstream to sync from — nothing in this dir imports it). Its coordinate
transform is delicate (validated to ~1e-13), so the **golden tests are the
guardrail**: change the math deliberately and keep `bun test` green rather than
casually refactoring.

```
services/pdf-annot/
├── index.ts          Barrel; the dynamic import() target (lazy-loads mupdf).
├── extract.ts        Native PDF /Annots → records.        ┐ the only two
├── pdf-pages.ts      Page geometry from the PDF.          ┘ modules touching mupdf
├── convert.ts        Records → the Logseq `hl-value` shape.
├── zotero.ts         Zotero-DB annotations → the same shape (the fallback path).
├── geometry.ts       Coordinate transforms.
├── colors.ts         Annotation colour → nearest Logseq pastel.
├── uuid.ts           Deterministic v5 uuids (idempotent re-import).
├── edn.ts            Emit the EDN/build-import block shape.
├── validate.ts       Shape validation.
├── types.ts          Shared types for the above.
└── __fixtures__/     Golden fixtures (real PDFs + expected output) for the tests.
```

Tests sit alongside as `*.test.ts` and run under `bun test`.

---

## "I want to change X — where do I look?"

| If you're touching… | Start in… |
|---|---|
| What properties an imported page gets | `constants.ts` (presets, display names) → `set-logseqdb-schema.ts` |
| How a page is built / what a page looks like after import | `services/handle-zot-db.ts` |
| How attachments / PDFs are emitted | `services/handle-zot-db.ts` + [`logseq-file-links.md`](./logseq-file-links.md) |
| The search popup (single import) | `features/search-item/` + `hooks/use-items.ts` |
| The batch modal | `features/batch-import/` + `hooks/use-batch.ts` + `services/batch-insert-into-graph.ts` |
| Any settings UI | `features/setup/` (find the matching `*Section.tsx`) |
| Adding/renaming a setting key | `settings.ts` + [`settings.md`](./settings.md) |
| Annotation extraction / coordinates | `services/pdf-annot/` (golden-tested; change the math deliberately, keep the fixtures green) |
| Annotation native-vs-Zotero picking, or sync | `services/import-annotations.ts` |
| The annotation write path / HTTP API | `services/logseq-transit.ts` + `logseq-import-edn.ts` + [`logseq-sdk-notes.md`](./logseq-sdk-notes.md) |
| Tag rules (matching or the builder UI) | `extended-tags.ts` + `features/tag-rules/` |
| The web-clip contract (keys the extension reads) | `web-sections.ts` + `features/setup/WebSection.tsx` + `set-web-schema.ts` |
| Zotero API calls / what Zotero returns | `services/get-zot-items.ts` + `interfaces.ts` + the `.bruno/` collections |
| The in-graph badge / dedupe | `services/zotero-code-index.ts` |
| Theme / colors / typography / motion | `src/styles/components.css` (the `:root` token block) + `services/sync-theme.ts` |
| Keyboard navigation in lists | `keyboard.ts` |
| Commands / what's registered at startup | `index.tsx` |
| An `@logseq/libs` call behaving oddly | [`logseq-sdk-notes.md`](./logseq-sdk-notes.md) **first** |

---

## Supporting material outside `src/`

| Path | What it is |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | The exhaustive behavioural reference (read alongside the code). |
| [`settings.md`](./settings.md) | Every settings key; how to add one; the hidden-keys mechanism. |
| `dev-notes/` | These docs + the deep-dive notes — see [`README.md`](./README.md). |
| `.bruno/` | Bruno HTTP collections for poking the Zotero local API by hand. |
| `scripts/seed-test-collection.js` | Seeds a "Logseq Plugin Test" collection in Zotero (idempotent) for testing. |
| `docs/` | The `*.gif` demos used by the README. |
