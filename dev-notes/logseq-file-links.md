# Local file links in Logseq — what actually clicks

What Logseq does when a user (or a plugin block-write) puts a Markdown link
to a file on disk into a block, and which forms reliably open it. The renderer
treats hand-typed and plugin-written links identically, so the rules below
apply to both.

**Last verified.** `logseq/logseq` `master` + `logseq/mldoc` traced on
**2026-05-28**, against a running DB graph (Electron desktop, macOS).

> Scope: **macOS, Electron desktop**. The link-click code path is not gated on
> graph type — file graphs and DB graphs share it. Linux/Windows differ below
> `shell.openPath` (the OS handler), not above; the parser and ClojureScript
> are the same.

---

## TL;DR

Emit a **bare absolute path with literal characters** as the URL part of the
Markdown link:

```
[label](/Users/foo/Library/Mobile Documents/com~apple~CloudDocs/x.pdf)
```

No `file://` prefix. No `%20` / `%2C` encoding. Spaces, commas, tildes,
hashes — all literal. Logseq hands the path unmodified to Electron's
`shell.openPath`, which routes it to whatever the OS has registered as the
default opener for that file type.

The form that looks natural but silently fails:

```
[label](file:///abs/path%20with%20spaces.pdf)
```

Logseq strips `file://` but **never decodes the percent-escapes**, so
`shell.openPath` is called with literal `%20`s in the path. The file doesn't
exist at that string; `shell.openPath` returns an error string; Logseq's
preload discards it; the click looks dead. Tracked upstream as
[logseq/logseq#9017](https://github.com/logseq/logseq/issues/9017) (still open).

---

## Full data flow for `[label](file:///path.pdf)` on click

Traced end-to-end through the source:

1. **mldoc parses the link** ([`mldoc/lib/syntax/inline.ml:822-890`](https://github.com/logseq/mldoc/blob/master/lib/syntax/inline.ml)).
   `url_part` splits on `://` and emits
   `Complex { protocol = "file"; link = "/path" }`. `link` is the substring
   **after** `file://` — **no transformation**, any `%20`/`%2C` is preserved
   verbatim. mldoc itself flags this as unfinished: see the
   `(* TODO: URI encode *)` comment at [`inline.ml:821`](https://github.com/logseq/mldoc/blob/master/lib/syntax/inline.ml#L821).

2. **`link-cp` handles the click** ([`block.cljs:1487-1508`](https://github.com/logseq/logseq/blob/master/src/main/frontend/components/block.cljs#L1487)).
   For `protocol = "file"` it calls `string-of-url`
   ([`block.cljs:148-158`](https://github.com/logseq/logseq/blob/master/src/main/frontend/components/block.cljs#L148-L158)),
   which returns just `link` — a **bare path with no `file://` prefix**.

3. **`file-link-path->open-path`** ([`block.cljs:1344-1355`](https://github.com/logseq/logseq/blob/master/src/main/frontend/components/block.cljs#L1344-L1355))
   calls `path/file-url-or-path->path` ([`common/path.cljs:230-235`](https://github.com/logseq/logseq/blob/master/deps/common/src/logseq/common/path.cljs#L230)),
   which checks `is-file-url?` (does the string still start with `file://` /
   `assets://` / `memory://`?). The prefix was already stripped one step
   earlier → returns the input unchanged. **No decode runs.**

   (`url-to-path` in the same file *does* decode, but it's only reached when
   `is-file-url?` is true — never, on this code path. And when it *is* reached
   elsewhere, `new URL(...).pathname` re-percent-encodes spaces back to `%20`,
   so it fails anyway. That's [#9017](https://github.com/logseq/logseq/issues/9017).)

4. **`js/window.apis.openPath`** ([`preload.js:90-95`](https://github.com/logseq/logseq/blob/master/resources/js/preload.js#L90-L95))
   does only `path.resolve` (expands `~`) and forwards to Electron's
   `shell.openPath`. **No decode. No error surfacing** — `shell.openPath`
   returns an error string on failure, but the preload discards the return
   value, so a bad path looks like a dead click.

So the path you put in the link is, byte-for-byte, the path `shell.openPath`
gets. macOS wants literal characters in the path it opens.

---

## The four link forms — what works

| Form | mldoc parse | `shell.openPath` arg | Opens? |
|---|---|---|---|
| `[n](file:///abs/Mobile%20Documents/x.pdf)` | `Complex{file, /abs/Mobile%20Documents/x.pdf}` | `/abs/Mobile%20Documents/x.pdf` | **No** — literal `%20` in name |
| `[n](file:///abs/Mobile Documents/x.pdf)` (literal space) | `url_part` stops at the space; falls back to `url_text` for the whole link; scanf reparses → `Complex{file, /abs/Mobile Documents/x.pdf}` | `/abs/Mobile Documents/x.pdf` | **Yes** — but by parser quirk |
| `[n](</abs/Mobile Documents/x.pdf>)` (CommonMark angle-bracket form) | `Other_link1` consumes `<...>` verbatim → `Complex{file, /abs/Mobile Documents/x.pdf}` | `/abs/Mobile Documents/x.pdf` | **Yes** — robust |
| `[n](/abs/Mobile Documents/x.pdf)` (bare) | No `://`, leading `/` → `Search "/abs/Mobile Documents/x.pdf"`; handled by `search-link-cp` ([`block.cljs:1437-1456`](https://github.com/logseq/logseq/blob/master/src/main/frontend/components/block.cljs#L1437)) | `/abs/Mobile Documents/x.pdf` | **Yes** — canonical |

The bare path takes the fewest code paths in Logseq — no scheme stripping, no
URL parsing, no decode attempt, no Win32 drive-letter dance — and dodges
[#9017](https://github.com/logseq/logseq/issues/9017) entirely. Prefer it.

---

## The `!` prefix splits the viewer choice

The *same* path renders and clicks very differently depending on whether the
Markdown link is prefixed with `!` (image-embed syntax):

- `![label](/abs/x.pdf)` → routes through `asset-link` → `open-pdf-file` →
  `state/set-current-pdf!` → **Logseq's built-in PDF viewer** (an embedded
  viewer with its own annotation tooling).
- `[label](/abs/x.pdf)` → routes through `shell.openPath` → **OS default
  app** (Preview / Skim / whatever's set as the default for `.pdf`).

This is the only switch. There is **no `:pdf-viewer` / "prefer external"
config key** in either file graphs or DB graphs (verified against the
`config.edn` template and the DB-graph version's removed-keys list). The
choice is made at write time by including or omitting `!`.

One-off escape hatch if a link was written with the wrong prefix: focus the
link and hit **`Ctrl-D Ctrl-A`** — Logseq's "Open with default app" action
([forum #2742](https://discuss.logseq.com/t/keyboard-shortcut-to-open-with-default-app/2742)).

---

## Edge case: parens in filenames

Markdown link URLs terminate at the first unbalanced `)`. A bare-path link
to `paper (2024).pdf` mis-parses:

```
[paper](/abs/paper (2024).pdf)
                       ^ URL ends here; ".pdf)" leaks out as text
```

Wrap in `<...>` for paths like that — mldoc has CommonMark-style angle-bracket
support ([`inline.ml:778-781`](https://github.com/logseq/mldoc/blob/master/lib/syntax/inline.ml#L778-L781)):

```
[paper](</abs/paper (2024).pdf>)
```

The angle-bracket form handles every other special character a path might
carry too, so it's a strict superset of the bare form. We default to bare for
the cleaner rendering; switch to angle-brackets per-link only when the path
needs it.

---

## Where this lives in this plugin

`src/services/handle-zot-db.ts` — the attachment-link emitter for the import
flow. Branching by Zotero's `linkMode`:

- **`linked_file`** → emit `attachment.path` as a **bare** Markdown URL. The
  path comes from Zotero's API and is already absolute on disk (e.g. for
  ZotMoov-managed libraries). No `file://`, no encoding. ZotMoov users live
  here.
- **`imported_file`** → Zotero's `links.enclosure.href` is a **`file://` URL
  that already carries the absolute on-disk path**
  (`file://<dataDir>/storage/<key>/<filename>`, percent-encoded) — *not* an
  `http://127.0.0.1:23119/...` URL, and **no "Zotero data directory" setting is
  needed**. Decode it (strip `file://`, percent-decode) to get the bare path.
  Verified on Zotero 9.0.4 — full details in
  [`zotero-attachment-paths.md`](./zotero-attachment-paths.md).
- **`imported_url`** → a saved snapshot, kept in Zotero storage like an
  `imported_file` and reached through the same `file://` enclosure. Usually
  HTML, but **can be a downloaded PDF** — decide by `contentType`, not by the
  link mode.
- **`linked_url`** → the original web URL, as-is.

Current behavior: the emitter passes the enclosure through `decodeURI` and keeps
the `file://` prefix, so imported attachments render as a `file://` Markdown
link (the fragile parser-quirk form in the table above) rather than a bare path,
and never take the asset-block route. Since a real on-disk path *is* in fact
available, an `imported_file` / `imported_url` **PDF could use the same
bare-path + asset-block viewer route as `linked_file`** (embedded viewer +
annotation tooling) — gated on the file being present (`links.enclosure.length`
is set). That's an available improvement, not today's behavior.

The `openAttachmentInline` setting (`Reference Manager: Settings → Zotero →
Import formats`) toggles the `!` prefix and so the viewer choice — see
the section above. It does not change the URL form.

---

## Sources

- [logseq/logseq#9017](https://github.com/logseq/logseq/issues/9017) — open
  upstream bug, "%20 URL-encoded asset paths not resolving." Same root cause
  as the Markdown-link case here; workaround in both is to avoid
  percent-encoded forms.
- [logseq/logseq#11779](https://github.com/logseq/logseq/issues/11779) —
  closed "not planned". Symptoms overlap; the bare-path form does work on
  macOS regardless.
- [forum #4156](https://discuss.logseq.com/t/pdf-option-to-open-pdf-in-directory-or-in-default-viewer/4156)
  — feature request for a "prefer external viewer" config; confirms the
  `!`-toggle is the only switch.
- [forum #2742](https://discuss.logseq.com/t/keyboard-shortcut-to-open-with-default-app/2742)
  — `Ctrl-D Ctrl-A` shortcut.
- mldoc author's own `(* TODO: URI encode *)` comment at
  [`inline.ml:821`](https://github.com/logseq/mldoc/blob/master/lib/syntax/inline.ml#L821).
