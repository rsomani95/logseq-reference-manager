# `dev_notes/` — developer documentation

Two kinds of doc live here:

1. **Onboarding** — the high-level framing a new developer needs to navigate the
   codebase. Read these top-to-bottom, in order.
2. **Deep-dives & references** — focused notes for specific areas: the Logseq
   SDK, Zotero internals, the settings subsystem. Reach for these when the topic
   comes up; don't read them cover to cover.

For day-to-day behavioural detail, [`CLAUDE.md`](../CLAUDE.md) (repo root) is the
exhaustive reference. The notes here are the *orientation* and the *war stories*
that `CLAUDE.md` is too dense to be.

---

## Start here (onboarding)

| Doc | Read it to learn… |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | What the project does, the tech stack, the cross-process mental model, the core data model, the four subsystems, and the canonical import flow. **Read first.** |
| [`MODULE_MAP.md`](./MODULE_MAP.md) | Where everything lives in `src/`, and a "I want to change X, where do I look?" table. **Read second.** |

After those two, you'll have the framing to read the code directly — which is the
point. The notes below are for when a specific problem sends you looking.

---

## Deep-dives & references (reach for when relevant)

| Doc | Reach for it when… |
|---|---|
| [`settings.md`](./settings.md) | You're adding or changing a setting, or need the settings ↔ web-clipper contract: every key (type, default, who reads it), the setup-hub structure, the save/dirty model, and the steps to add a setting. |
| [`LOGSEQ_SDK_NOTES.md`](./LOGSEQ_SDK_NOTES.md) | An `@logseq/libs` call misbehaves: property create/delete/type gotchas, the type-lock that *hangs* the SDK, `hide?` deletion traps, theming that won't cross the iframe, the local HTTP API, and **`build-import`** (the only way to write typed annotation blocks). The single most useful reference once you're past onboarding. |
| [`ZOTERO_ATTACHMENT_PATHS.md`](./ZOTERO_ATTACHMENT_PATHS.md) | You need a Zotero attachment's absolute on-disk path: the four `linkMode`s, the `/file` `302`→`file://` route, decoding, and the "is the file actually here?" signal. |
| [`LOGSEQ_FILE_LINKS.md`](./LOGSEQ_FILE_LINKS.md) | You're emitting a Markdown link to a local file and it won't open: which link form Logseq actually resolves (bare path, no `file://`, no `%20`), and the `!`-prefix that switches embedded-PDF-viewer vs. OS-default-app. |
| [`debugging/cors_request.md`](./debugging/cors_request.md) | **Known open issue.** Zotero's local API is CORS-blocked for *marketplace* installs (works unpacked in dev). Root cause is diagnosed; the validated fix (`exper_request` over postMessage) is **not yet implemented**. Read before debugging "connection works in dev, fails when installed." |

> Each deep-dive carries its own "Last verified" date and the source it was
> traced against. They're empirical — "what actually happens," not "what the docs
> say." When one drifts from reality, fix it and bump the date.

---

## Related docs outside this folder

| Path | What it is |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | The exhaustive behavioural reference for the whole plugin. |
| [`../README.md`](../README.md) | The user-facing readme (what it does, install, demos). |
| `../.bruno/` | Bruno HTTP collections for poking the Zotero local API by hand. |
