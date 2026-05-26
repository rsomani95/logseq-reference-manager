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
| `zotTag` | string | `Reference` | Schema | `set-logseqdb-schema` (base tag), `handle-zot-db` (page tag), `set-web-schema` (extends target), `index.tsx` (sync-all query) |
| `propertyPreset` | enum `Essentials\|Full\|Custom` | `Essentials` | Schema | `set-logseqdb-schema`, `handle-zot-db` |
| `pageProps` | `string[]` (`formatPagePropChoice` labels) | essentials | Schema → `PropertyPicker` (Custom only) | both, via `parsePagePropChoice` |
| `creatorsAsNodes` | boolean | `true` | Import formats | `set-logseqdb-schema` (property type), `handle-zot-db` (render) |
| `creatorNameTemplate` | string template | `<% firstName %> <% lastName %>` | Import formats | `resolveCreatorName` → `applyCreatorTemplate` |
| `pagenameTemplate` | string template | `@<% citeKey %>` | Import formats | `resolvePageName` → `applyPageNameTemplate` |
| `openAttachmentInline` | boolean | `true` | Import formats | `handle-zot-db` (attachment link) |
| `tagRules` | JSON string (array of `TagRule`) | empty | Tag rules | `getConfiguredTagRules`; watched by `watch-tag-rules` |
| `webTag` | string | `Web` | Web references | `set-web-schema` (extends base); **web-clipper extension** (clip tag) |
| `webCapturePageContent` | boolean | `true` | Web references | **web-clipper extension** |
| `webPageContentBlockName` | string | `Page Content` | Web references → Page template | **web-clipper extension** |
| `webHighlightsBlockName` | string | `Highlights` | Web references → Page template | **web-clipper extension** |
| `webAbstractBlockName` | string | `Abstract` | Web references → Page template | **web-clipper extension** |
| `webCaptureAbstract` | boolean | `true` | Web references → Page template | **web-clipper extension** |
| `webFoldAbstract` | boolean | `false` | Web references → Page template | **web-clipper extension** |
| `webFoldHighlights` | boolean | `false` | Web references → Page template | **web-clipper extension** |
| `webFoldPageContent` | boolean | `true` | Web references → Page template | **web-clipper extension** |
| `webSectionOrder` | string — CSV of section ids | `abstract,highlights,pageContent` | Web references → Page template | **web-clipper extension** |
| `webUseHeadingMarkers` | boolean | `false` | Web references | **web-clipper extension** |
| `webPopulatePageTags` | boolean | `false` | Web references | **web-clipper extension** |
| `testConnection` | heading | — | — | display-only (native panel status line) |
| `openSetup` | heading | — | — | launcher copy (native panel) |

`tagRules` is intentionally **not** in the schema — it's written by the hub and
read directly; `watch-tag-rules.ts` toasts parse errors as a safety net for
externally hand-edited JSON.

The `web*` keys are a **contract** with the companion web-clipper extension: it
reads them over the HTTP API (`getStateFromStore`) but can't write them, so this
hub is the only editing surface. The keys/types/defaults must match the
extension's `logseq-remote-settings.ts` mapping — coordinate before renaming
any. The extension repo's `LOGSEQ_SETTINGS_INTEGRATION.md` is the full handoff.

### Page template

The clipper writes up to three top-level section blocks onto each clipped page —
**Abstract**, **Highlights**, **Page Content** (ids `abstract` / `highlights` /
`pageContent`). The plugin owns how they're templated; `src/web-sections.ts` is
the single source for the section model (`WEB_SECTIONS` — each section's
`web*BlockName` / `webFold*` / optional `webCapture*` keys + defaults — and
`WEB_SECTION_DEFAULT_ORDER`). The seed defaults in `settings.ts` and the UI
fallbacks in `WebSection.tsx` both mirror it; all three (plus the extension's
own fallbacks) must agree.

- **Per-section knobs.** Each section has a heading name (`web*BlockName`) and a
  fold-on-import flag (`webFold*`, default folded only for Page Content).
- **Enable toggles.** Abstract and Page Content are optional (`webCaptureAbstract`
  / `webCapturePageContent`); **Highlights is always imported** and has no
  capture key. A disabled section keeps its slot in the order.
- **Order.** `webSectionOrder` is a comma-separated id list (a plain string seeds
  reliably and the extension just splits on `,`). `parseSectionOrder` is
  defensive — dedupes, drops unknown ids, appends any missing section in
  canonical order — so a stale/partial value never strands a section.

`webAbstractBlockName`, `webCaptureAbstract`, `webSectionOrder`, and the three
`webFold*` keys are **new** to this contract — the clipper must add them to its
`logseq-remote-settings.ts` mapping (with matching fallbacks) for them to take
effect. Until then they're written but ignored, and clipping is unaffected.

## Setup hub

```
Reference Manager: Settings ─┐
                             ▼
src/SetupContainer.tsx   (backdrop + CSS imports, mirrors BatchContainer)
  └─ src/features/setup/index.tsx → SetupApp (shell: header · grouped nav · panel)
       nav groups → sections (src/features/setup/):
         Schema:
           SchemaSection.tsx  — base tag, preset, Apply schema, Danger zone
                                (deleteZoteroSchema); shared by both sources
             ├─ PropertyPicker.tsx  — searchable custom-property selector (Custom)
             └─ PresetFieldList.tsx — read-only Essentials / Full field list
         Zotero:
           ConnectSection.tsx — live connection test (testZotConnection)
           FormatsSection.tsx — page/author dropdowns + live preview from a
                                real library item, creatorsAsNodes
           TagRulesSection.tsx — rule builder (reuses ../tag-rules/RuleCard)
         Web references:
           WebSection.tsx     — webTag + Page template (a @dnd-kit reorderable
                                list of the Abstract/Highlights/Page Content
                                section cards: name, fold, enable) + heading
                                markers / page tags (all read by the extension)
                                + Set up web tag (ensureWebTagExtendsBase)
```

The nav is grouped: `NAV` in `index.tsx` tags each item with a `group`, and a
`.setup-nav-group` label renders whenever the group changes.

- **Section model.** Each section renders a `setup-section-head` /
  `setup-section-body` / `setup-section-footer` trio (CSS in `components.css`,
  `--zot-*` tokens). The shell (`SetupApp`) owns the window chrome — title,
  close, nav rail.
- **Landing & completion.** `SetupApp` probes `testZotConnection()` +
  `isSchemaAdded()` once on open, ticks the nav, and lands on the first
  incomplete *gating* section (`GATING = ['connect', 'schema']`; Formats, Tag
  rules, and Web references are never "incomplete"). A "Next: …" cue points at
  the next gating gap. A deep-link (`initialSection`) skips the wait.
- **Deep-link (capability).** `SetupContainer` / `SetupApp` accept an optional
  `initialSection` to open straight to a section. No command passes it today —
  the former `Zotero: Edit tag rules` deep-link was retired with that command —
  but the extension point is there.
- **Save model.**
  - Simple controls **autosave** on change (`updateSettings`) — the
    Logseq-native feel.
  - Three heavy ops are **explicit**: Schema's **Apply schema** (runs
    `setLogseqDbSchema`, then re-checks `isSchemaAdded`), Tag rules' **Save
    rules** (validates the draft, then writes `tagRules`), and Web references'
    **Set up web tag** (`ensureWebTagExtendsBase`). Each sits next to what it
    affects — which is why there's no longer a "you changed a schema setting, go
    re-run a command" nag (the old `watch-schema-settings.ts`).
  - A schema-affecting change (base tag, preset, custom properties, or Import
    formats' `creatorsAsNodes`) sets a `schemaDirty` flag — lifted to `SetupApp`
    so it's shared across sections and survives section navigation — surfacing a
    quiet "re-apply to update your graph" line in Schema's footer until the next
    Apply. (Editing `webTag` is tracked separately, in the Web references
    section's own local dirty state, not this flag.)

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
`pageProps` / `creatorsAsNodes` from `logseq.settings`. `SchemaSection` flushes
its own values (`zotTag`, `propertyPreset`) via `updateSettings` *before* calling
it, since its change handlers are fire-and-forget; `pageProps` and
`creatorsAsNodes` are autosaved by the `PropertyPicker` and the Import-formats
section respectively, so they're already persisted by then.

After the base tag + properties, `setLogseqDbSchema` wires the web tag —
`ensureWebTagExtendsBase` (`services/set-web-schema.ts`), reading `webTag` — so
the Web class `extends` the base and inherits the same property idents (no
per-property re-association). The Web references section runs the same wiring
from its own **Set up web tag** button, gated on `isSchemaAdded`.

**Per-property visibility.** Every created property gets
`:logseq.property/hide-empty-value` (a nil value collapses).
`:logseq.property/hide?` ("hide by default") is set on all properties *except*
the `VISIBLE_BY_DEFAULT_PROPS` allowlist (`constants.ts` — currently
authors/title/url/date/date-added), which show inline, so an imported page reads
as notes rather than a metadata dump. This is an opinionated hardcoded default —
**TODO: surface it as a setting** so users choose their visible fields. Caveats
that drive the design: Logseq only hides `nil`, never `""` (so `handle-zot-db`
drops blank values at import); expanding "Hidden properties" reveals *all* hidden
props, empties included (the expand path skips the empty-value check); and
`hide?`=true also blocks property deletion (which `delete-zotero-schema` works
around by stripping it first).

The Schema **Danger zone** (`services/delete-zotero-schema.ts`)
removes every property in the `ZOTERO_PROP` ident namespace via `removeProperty`
(never the user's own). The tag/class pages (base + web) are deliberately left
intact — deleting them would clear their backlinks, so that's a manual op. Note
`removeProperty`, not `deletePage(title)`, which silently no-ops on a property
entity (the bug behind the old command's false-success).

## Gotchas

- **Dev build clobbers `dist/index.html`.** After any `bun run build`, restart
  `bun run dev` and reload the plugin, or source edits won't reach Logseq.
- **Keys must be registered pre-`ready`** for defaults to populate (see
  `handleSettings({ msg: '' })` above `logseq.ready` in `index.tsx`).
- **Don't try to style or set `readonly` on the native panel from JS** — the
  plugin iframe can't reach that DOM. Use `provideStyle` scoped to
  `.panel-wrap[data-id="${PLUGIN_ID}"]` (that's how the `HIDDEN_KEYS` rows are
  hidden).
