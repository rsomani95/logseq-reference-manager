# Settings & Setup architecture (dev notes)

How configuration works in this plugin, for contributors. End users never touch
most of this — they configure everything through the in-app **Setup hub**, not
Logseq's native settings panel.

## TL;DR

- **Persistence** is `logseq.settings` (Logseq's per-plugin store) — the single
  source of truth. Read with `logseq.settings?.<key>`, write with
  `logseq.updateSettings({ <key>: value })`.
- **Editing UI** is the **Setup hub** — a custom modal rendered into the
  `showMainUI` overlay, opened via the `Zotero: Settings` command. The native
  settings panel is reduced to a launcher heading + a live connection-status
  line.
- The native panel **still declares every key** (`settings.ts`) but **hides the
  rows** via injected CSS. Those schema entries exist only so Logseq populates
  defaults on a fresh install and the host stays stable — they are not the
  editing surface.

## Why a custom hub instead of the settings panel

Logseq's `SettingSchemaDesc` only supports `string | number | boolean | enum |
object | heading` (+ `inputAs: color | date | datetime-local | range |
textarea`). No validated text input, no per-field validation, no live preview,
no buttons, no layout. Our setup is sequential, interdependent, and needs live
feedback (connection test, schema apply, format preview, a rule builder), none
of which the panel can express — and a plugin can't render React into the panel
anyway (only CSS scoped to `.panel-wrap[data-id="…"]` crosses that boundary). So
all real configuration lives in the plugin's own modal.

## Settings reference

| key | type | default | edited in | read by |
|-----|------|---------|-----------|---------|
| `zotTag` | string | `Reference` | Library | `set-logseqdb-schema`, `handle-zot-db` (page tag) |
| `propertyPreset` | enum `Essentials\|Full\|Custom` | `Essentials` | Library | `set-logseqdb-schema`, `handle-zot-db` |
| `pageProps` | `string[]` (`formatPagePropChoice` labels) | essentials | Library → `PropertyPicker` (Custom only) | both, via `parsePagePropChoice` |
| `creatorsAsNodes` | boolean | `true` | Library | `set-logseqdb-schema` (property type), `handle-zot-db` (render) |
| `creatorNameTemplate` | string template | `<% firstName %> <% lastName %>` | Import formats | `resolveCreatorName` → `applyCreatorTemplate` |
| `pagenameTemplate` | string template | `@<% citeKey %>` | Import formats | `resolvePageName` → `applyPageNameTemplate` |
| `openAttachmentInline` | boolean | `true` | Import formats | `handle-zot-db` (attachment link) |
| `tagRules` | JSON string (array of `TagRule`) | empty | Tag rules | `getConfiguredTagRules`; watched by `watch-tag-rules` |
| `testConnection` | heading | — | — | display-only (native panel status line) |
| `openSetup` | heading | — | — | launcher copy (native panel) |

`tagRules` is intentionally **not** in the schema — it's written by the hub and
read directly; `watch-tag-rules.ts` toasts parse errors as a safety net for
externally hand-edited JSON.

## Setup hub

```
Zotero: Settings ─┐                    Zotero: Edit tag rules ─┐
                  ▼                                            ▼
src/SetupContainer.tsx   (backdrop + CSS imports, mirrors BatchContainer)
  └─ src/features/setup/index.tsx → SetupApp (shell: header · nav rail · panel)
       sections (src/features/setup/):
         ConnectSection.tsx   — live connection test (testZotConnection)
         LibrarySection.tsx   — tag, preset, PropertyPicker, Apply schema
           └─ PropertyPicker.tsx — searchable custom-property selector
         FormatsSection.tsx   — page/author dropdowns + live preview
         TagRulesSection.tsx  — rule builder (reuses ../tag-rules/RuleCard)
```

- **Section model.** Each section renders a `setup-section-head` /
  `setup-section-body` / `setup-section-footer` trio (CSS in `components.css`,
  `--zot-*` tokens). The shell (`SetupApp`) owns the window chrome — title,
  close, nav rail.
- **Landing & completion.** `SetupApp` probes `testZotConnection()` +
  `isSchemaAdded()` once on open, ticks the nav, and lands on the first
  incomplete *gating* section (`GATING = ['connect', 'library']`; Formats and
  Tag rules are never "incomplete"). A "Next: …" cue points at the next gating
  gap. A deep-link (`initialSection`) skips the wait.
- **Deep-link.** `SetupContainer` takes `initialSection?: SetupSection`;
  `Zotero: Edit tag rules` opens the hub on `'tagRules'`.
- **Save model.**
  - Simple controls **autosave** on change (`updateSettings`) — the
    Logseq-native feel.
  - Two heavy ops are **explicit**: Library's **Apply schema** (runs
    `setLogseqDbSchema`, then re-checks `isSchemaAdded`) and Tag rules' **Save
    rules** (validates the draft, then writes `tagRules`). Both sit next to what
    they affect — which is why there's no longer a "you changed a schema
    setting, go re-run a command" nag (the old `watch-schema-settings.ts`).

## Adding or changing a setting

1. **Declare it (hidden) in `settings.ts`** — add a `SettingSchemaDesc` entry
   with the right `default`, and add its key to `HIDDEN_KEYS` so the row is
   CSS-hidden. This is what gives fresh installs a default and keeps the host
   stable. The registration must stay **before `logseq.ready`** (see the note
   in `index.tsx`).
2. **Add a control** in the relevant `src/features/setup/` section. Read the
   current value from `logseq.settings?.<key>`; on change call
   `logseq.updateSettings({ <key>: value })` (autosave), or gate it behind an
   explicit button if it's heavy or has invalid intermediate states.
3. **Read it** wherever it's consumed via `logseq.settings?.<key>`.

There's no separate "register the default" step beyond (1) — Logseq folds schema
defaults into the store during the ready-init pass.

## Templates (`services/resolve-templates.ts`)

`pagenameTemplate` / `creatorNameTemplate` are filled by pure functions
(`applyPageNameTemplate`, `applyCreatorTemplate`) — no `@logseq/libs` import, so
they're unit-tested (`resolve-templates.test.ts`) and the Formats preview
renders through the **same** functions (preview === import output). They
tolerate placeholder case/whitespace, strip unknown `<% … %>`, and fall back to
a collision-safe per-item name (citeKey, else title) when a template carries no
usable placeholder. `handle-zot-db.ts` wraps them, supplying the template from
settings.

## Schema application

Properties and the tag only reach the graph when **Apply schema** runs
`services/set-logseqdb-schema.ts`, which reads `zotTag` / `propertyPreset` /
`pageProps` / `creatorsAsNodes` from `logseq.settings`. `LibrarySection` flushes
its own values via `updateSettings` *before* calling it (the change handlers are
fire-and-forget). The legacy palette command `Zotero: Setup schema` still calls
the same function.

## Gotchas

- **Dev build clobbers `dist/index.html`.** After any `bun run build`, restart
  `bun run dev` and reload the plugin, or source edits won't reach Logseq.
- **Keys must be registered pre-`ready`** for defaults to populate (see
  `handleSettings({ msg: '' })` above `logseq.ready` in `index.tsx`).
- **Don't try to style or set `readonly` on the native panel from JS** — the
  plugin iframe can't reach that DOM. Use `provideStyle` scoped to
  `.panel-wrap[data-id="${PLUGIN_ID}"]` (that's how the `HIDDEN_KEYS` rows are
  hidden).
