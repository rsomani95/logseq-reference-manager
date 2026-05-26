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
| `creatorsAsNodes` | boolean | `true` | Authors | `set-logseqdb-schema` (`authors`/`creators` property type), `handle-zot-db` (render); type **inherited by the web tag via `extends`** — see Author formatting |
| `creatorNameTemplate` | string template | `<% firstName %> <% lastName %>` | Authors | `resolveCreatorName` → `applyCreatorTemplate`; **web-clipper extension** (pending — see Author formatting) |
| `creatorSeparator` | string | `, ` | Authors | `handle-zot-db` (joins names in text mode); **web-clipper extension** (pending — see Author formatting) |
| `pagenameTemplate` | string template | `@<% citeKey %>` | Import formats | `resolvePageName` → `applyPageNameTemplate` |
| `pagenamePrefix` | string | empty (migration peels a leading literal like `@` out of the template) | Import formats | `applyPageNameTemplate` (prefix arg) |
| `openAttachmentInline` | boolean | `true` | Import formats | `handle-zot-db` (attachment link) |
| `tagRules` | JSON string (array of `TagRule`) | empty | Tag rules | `getConfiguredTagRules`; watched by `watch-tag-rules` |
| `appliedSchema` | JSON string (`SchemaSnapshot`) | empty | (internal — written by Apply / Set up web tag) | `use-schema-state` for the dirty diff (`schema-snapshot.ts`) |
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

`tagRules` and `appliedSchema` are intentionally **not** in the schema — they're
written by the hub and read directly (undeclared keys survive `useSettingsSchema`
re-registration). `watch-tag-rules.ts` toasts parse errors on `tagRules` as a
safety net for externally hand-edited JSON. `appliedSchema` is internal state, not
user-facing: it records the schema-relevant config as of the last Apply so the hub
can tell a real schema change from a no-op edit (see Save model below).

The `web*` keys are a **contract** with the companion web-clipper extension: it
reads them over the HTTP API (`getStateFromStore`) but can't write them, so this
hub is the only editing surface. As of the shared-**Authors** change, the
creator-formatting keys **`creatorNameTemplate`** and **`creatorSeparator`** join
that contract too (see [Author formatting](#author-formatting-shared)). The
keys/types/defaults must match the extension's `logseq-remote-settings.ts`
mapping — coordinate before renaming any. The extension repo's
`LOGSEQ_SETTINGS_INTEGRATION.md` is the full handoff.

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

### Author formatting (shared)

Creator formatting (the **General → Authors** panel) applies to **every source**,
so a clipped web page should render authors the way a Zotero import does. Three
keys govern it; the Logseq properties they shape are **`authors`** and
**`creators`**, both inherited by the web tag via `extends`.

- **`creatorsAsNodes`** (boolean, default `true`) — sets the **type** of the
  `authors` / `creators` properties: `node` / cardinality-`many` (each creator is
  its own linked page) when true, `default` (one plain-text value) when false
  (`set-logseqdb-schema.ts` → `desiredSchemaFor`). **The extension does not need
  to read this key.** Because the web tag `extends` the base, the property the
  extension discovers when walking `webTag`'s inherited schema *already carries
  the right type* — so honor that discovered type: write page-reference values
  for a `node` property, a single joined string for a `default` one.
- **`creatorNameTemplate`** (string template, default `<% firstName %> <% lastName %>`)
  — how each creator's name is rendered. Same placeholder grammar as page names:
  `<% firstName %>` / `<% lastName %>`, case- and whitespace-tolerant inside the
  `<% %>`; unrecognised tokens are stripped; a template with no usable token falls
  back to `<% firstName %> <% lastName %>`; double spaces (one part missing) are
  collapsed. A single-field creator (institutional author, "Various", …) that has
  a `name` but no first/last bypasses the template and is used verbatim. The
  reference implementation is `applyCreatorTemplate` in
  `services/resolve-templates.ts` (pure, unit-tested) — mirror its rules so the
  web output matches Zotero's character-for-character.
- **`creatorSeparator`** (string, default `, `) — joins the formatted names into
  one string **only when creators are plain text** (`creatorsAsNodes` false →
  `default` type). When creators are nodes each name is a separate page reference
  and the separator is irrelevant.

Like the new Page-template keys above, **`creatorNameTemplate` and
`creatorSeparator` are new to the contract** — the clipper must add them to its
`logseq-remote-settings.ts` mapping with matching fallbacks (`<% firstName %> <% lastName %>`
and `, `) for them to take effect; until then they're written but ignored.
`creatorsAsNodes` needs no mapping — its effect arrives through the inherited
property type. **Plugin status:** the Authors panel presents these as shared, but
the plugin only applies the format to its own Zotero imports until the extension
wires the two keys; nothing breaks in the meantime.

## Setup hub

```
Reference Manager: Settings ─┐
                             ▼
src/SetupContainer.tsx   (backdrop + CSS imports, mirrors BatchContainer)
  └─ src/features/setup/index.tsx → SetupApp (shell: header · grouped nav · panel)
       nav groups → sections (src/features/setup/):
         General:
           SchemaSection.tsx  — base tag, preset, Apply schema, Danger zone
                                (deleteZoteroSchema); shared by both sources
             ├─ PropertyPicker.tsx  — searchable custom-property selector (Custom)
             └─ PresetFieldList.tsx — read-only Essentials / Full field list
           AuthorsSection.tsx — creator name/separator + live preview,
                                creatorsAsNodes (+ its own Apply-schema footer,
                                gated on baseDirty); shared by both sources
         Zotero:
           ConnectSection.tsx — live connection test (testZotConnection)
           FormatsSection.tsx — page-name dropdown + prefix + live preview from
                                a real library item (useFmtSample);
                                openAttachmentInline (no schema footer)
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

Schema state spans the sections (base tag/preset/list in Schema, `creatorsAsNodes`
in Authors, `webTag` in Web references) yet shares one Apply and one notion
of "dirty", so it's all owned by **`useSchemaState`** (`features/setup/use-schema-state.ts`)
in `SetupApp` and threaded down; the diff logic is in `services/schema-snapshot.ts`.
The sections render the controls as controlled inputs and delegate Apply / Delete /
Set-up upward (see Save model).

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
  - **Dirty = a real diff, not a sticky flag.** All schema state is lifted into
    `useSchemaState` (in `SetupApp`): it persists a snapshot of the last-*applied*
    schema-relevant config (`appliedSchema`) and compares the live config against
    it (`services/schema-snapshot.ts`, **trim-insensitive**). The schema-relevant
    set is fully enumerated — base tag, preset, custom property list (Custom only,
    order-insensitive), `creatorsAsNodes`, and `webTag`; everything else in the hub
    is cosmetic. **Apply schema** and **Set up web tag** are enabled *only* when
    their side of that diff is non-empty (`baseDirty` / `webDirty`), so re-typing a
    value back to what's applied — or reordering a custom list — re-disables the
    button. Schema's footer status reads off the same diff.
  - Because `creatorsAsNodes` is schema-relevant but lives in **Authors**,
    that section shows its **own** Apply-schema footer (same `baseDirty` gate;
    hidden until a schema exists) so a creators change can be applied without
    bouncing back to Schema. `applySchema` itself lives in `useSchemaState`, shared
    by both footers. This also consolidated the three separate `isSchemaAdded`
    probes the sections used to each run into one.
  - **Snapshot is global; "applied" is per-graph.** `appliedSchema` lives in the
    one global settings file (`~/.logseq/settings/<plugin-id>.json`, shared by
    every graph), but whether the schema *exists* is per-graph — so the open-time
    probe trusts the snapshot only when `isSchemaAdded()` confirms the schema is in
    **this** graph. In a graph where nothing was applied, the snapshot is ignored
    (treated as `null` → `baseDirty` true), so the **first Apply is enabled even at
    the defaults** — without this gate, a snapshot left by another graph matches the
    default config and wrongly disables Apply.
  - **Migration:** a pre-snapshot install (schema applied here by an older version,
    snapshot present + `isSchemaAdded()` true) seeds `appliedSchema` from current
    settings on open — base fields assumed already-applied (button starts disabled),
    but `webTag` seeded empty (the base probe can't confirm the web tag was actually
    wired, so the idempotent "Set up web tag" is offered once). Both self-heal on
    the next Apply.

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
they're unit-tested (`resolve-templates.test.ts`) and the setup previews (page
name in Import formats, author name in Authors) render through the **same**
functions (preview === import output). They
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
`creatorsAsNodes` are autosaved by the `PropertyPicker` and the Authors
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
