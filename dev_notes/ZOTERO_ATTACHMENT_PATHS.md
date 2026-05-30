# Resolving Zotero attachment file paths via the local API

How to get the **absolute on-disk path** of a Zotero attachment's file from
Zotero's **local HTTP API**, for every attachment type. General Zotero-API
reference — not tied to any one consumer.

**Last verified.** Zotero **9.0.4**, `X-Zotero-Connector-API-Version: 3`,
macOS. Traced against a live library on **2026-05-29**.

> **Local API, not the web API.** This all relies on Zotero's *local* server at
> `http://127.0.0.1:23119` (the same process the Connector talks to). The
> hosted web API at `api.zotero.org` **cannot** do this — it has no knowledge of
> your machine's filesystem, so its enclosure/`file` links are HTTPS download
> URLs, never local paths. Path resolution is inherently a local-API technique,
> and assumes the file is actually on this machine (no reliance on Zotero cloud
> download).

---

## TL;DR

Zotero hands you the absolute path; you rarely compute it yourself. Two routes,
both returning a percent-encoded `file://` URL you then decode:

1. **From the item JSON** (free if you already fetched the item):
   - `linked_file` → `data.path` (already an absolute, *literal* path)
   - `imported_file` / `imported_url` → `links.enclosure.href` (a `file://` URL)
   - `linked_url` → no file (it's a web bookmark; `data.url` only)

2. **Universal, one call per attachment** — `GET /items/<KEY>/file`:
   returns **`302`** with a `Location:` header that is a `file://` URL to the
   file. Works identically for linked **and** imported files, so you don't have
   to branch on `linkMode`. Read the header; don't follow the redirect.

Then strip `file://` and percent-decode → literal absolute path.

---

## The local API in one paragraph

Base URL `http://127.0.0.1:23119/api`. Use `users/0` as the user id for the
local library — `0` is accepted as a local alias (responses echo the real
numeric id, e.g. `users/5021238`). It mirrors the Zotero web API's shapes. Item
endpoints used here: `GET /users/0/items/<KEY>`, `…/items/<KEY>/children`,
`…/items/<KEY>/file`.

---

## The four attachment link modes

`data.linkMode` is one of four values (`Zotero.Attachments.LINK_MODE_*` in the
client source). It determines where the bytes live and how you get the path:

| `linkMode`     | Bytes live where                         | Path source                          |
|----------------|------------------------------------------|--------------------------------------|
| `linked_file`  | Anywhere on disk, left in place          | `data.path` — absolute, literal      |
| `imported_file`| Copied into Zotero storage               | `links.enclosure.href` (`file://`)   |
| `imported_url` | Snapshot saved into Zotero storage       | `links.enclosure.href` (`file://`)   |
| `linked_url`   | Nothing on disk — it's a web bookmark    | none (`data.url`)                    |

Notes:
- `imported_url` is "a saved snapshot of a URL." Usually an HTML page, but it
  can also be a downloaded **PDF** — check `data.contentType`, don't assume HTML.
- Only `imported_*` attachments carry a `links.enclosure`. `linked_file` has
  **no** enclosure — its path is in `data.path` and nowhere else.

---

## Storage layout (imported files)

Imported files live under the Zotero **data directory**:

```
<dataDir>/storage/<ATTACHMENT_KEY>/<filename>
```

- `<ATTACHMENT_KEY>` is the attachment **item's own** 8-char key (e.g. an item
  with `data.key = "C3JDPCTE"` stores its file in `storage/C3JDPCTE/`).
- `<filename>` is `data.filename`.
- The folder may also contain Zotero's own sidecars (e.g. `.zotero-ft-cache`).

**Default `dataDir`:** `~/Zotero` on macOS/Linux, `C:\Users\<user>\Zotero` on
Windows; user-configurable (Zotero → Settings → Advanced → Files and Folders →
Data Directory Location).

**The API does not expose `dataDir` directly** (`GET /users/0/settings` returns
`{}`). You don't need it — the enclosure/`Location` `file://` URL already
contains the resolved absolute path. If you ever need the bare dataDir, derive
it by stripping `/storage/<KEY>/<filename>` off any imported attachment's
`file://` URL.

---

## Decoding the `file://` URL

Zotero encodes the path **`encodeURI`-style**: spaces → `%20`, non-ASCII bytes
→ UTF-8 percent-escapes (`'` → `%E2%80%98`), but parentheses and most
punctuation stay **literal**. To recover the on-disk path:

1. Strip the `file://` scheme. `file:///Users/...` → `/Users/...` (the third
   slash is the leading slash of the absolute path; keep it).
2. Percent-decode. Safest is **per segment**, so a stray `%2F` inside a filename
   can't be mistaken for a separator:

```ts
// file:///Users/a/storage/C3JDPCTE/%20%20paper.pdf  ->  /Users/a/storage/C3JDPCTE/  paper.pdf
const fileUrlToPath = (href: string): string =>
  href.replace(/^file:\/\//, '').split('/').map(decodeURIComponent).join('/')
```

```python
import urllib.parse
def file_url_to_path(href: str) -> str:
    return urllib.parse.unquote(href.replace("file://", "", 1))
```

This is the exact inverse of building a `file://` URL by `encodeURIComponent`-ing
each path segment. Decoded paths can legitimately contain leading/trailing
spaces, Unicode, and parens — keep them literal; don't re-normalize.

---

## Is the file actually on disk?

The `file://` URL is the **canonical computed path** — where the file *should*
be. Zotero returns it from the database record and **does not guarantee the file
is present** (e.g. an attachment whose bytes were never synced to this machine
still yields a valid-looking `file://` URL pointing at a missing folder).

Reliable presence signal for `imported_*`: **`links.enclosure.length`**.

- File present → `enclosure.length` is set and equals the on-disk byte count.
- File missing → no `length` (the enclosure object may still exist with `href`
  + `type` + `title`, but no `length`).
- `data.md5` / `data.mtime` are **not** reliable presence signals — they're
  typically `null` unless Zotero has hashed the file for sync, so present-on-disk
  files routinely show `md5: null`.
- `data.lastRead` is only set once the file has been *opened*, so absence
  doesn't imply the file is missing.

For `linked_file` there is no enclosure; the only way to confirm existence is to
`stat` `data.path` yourself (not possible from a sandboxed HTTP client — see
caveats).

The parent (regular) item also exposes a `links.attachment` pointer to its
"best" attachment with `attachmentType` + `attachmentSize` — handy as a quick
"does this item have a primary file, and how big" check. But its `href` is an
**API URL** (`…/items/<KEY>`), not a file path; follow it to that attachment and
read the enclosure (or call `/file`).

---

## Wiring it up

Framework-agnostic resolver. Given an attachment item's JSON, return an absolute
path (or `null` when there's no local file):

```ts
function resolveAttachmentPath(att): string | null {
  const d = att.data
  if (d.linkMode === 'linked_file') {
    return d.path ?? null                       // already absolute + literal
  }
  if (d.linkMode === 'imported_file' || d.linkMode === 'imported_url') {
    const enc = att.links?.enclosure
    if (!enc?.href) return null
    // Optional presence guard: treat a missing `length` as "not on disk".
    if (enc.length == null) return null
    return fileUrlToPath(enc.href)
  }
  return null                                   // linked_url: no file
}
```

If you only hold a key (no item JSON), the **universal** route avoids the
linkMode branch entirely — one request, read the redirect header, don't follow
it:

```
GET http://127.0.0.1:23119/api/users/0/items/<KEY>/file   ->   302
Location: file:///Users/.../storage/<KEY>/%20%20paper.pdf
```

```ts
const res = await fetch(url, { method: 'GET', redirect: 'manual' })
const path = res.status === 302
  ? fileUrlToPath(res.headers.get('Location') ?? '')
  : null
```

(`redirect: 'manual'` matters — the `Location` is a `file://` URL; actually
following it from an HTTP origin will fail or be blocked. You only want the
header string.)

---

## Caveats & gotchas

- **Sandboxed consumers can't `stat`.** A browser/iframe HTTP client can't check
  whether a path exists on disk — it can only emit the string and let the OS
  handler deal with a missing target. Use `enclosure.length` as the presence
  proxy instead of a filesystem check.
- **Linked Attachment Base Directory.** If the user configured a base directory,
  Zotero stores `linked_file` paths *relative* and may serialize `data.path`
  with an `attachments:` prefix instead of an absolute path; the API does not
  expose the base directory needed to resolve it. (Not seen in testing — every
  observed `linked_file` returned an absolute path — but handle the
  `attachments:` prefix defensively if you support base directories. The `/file`
  redirect route sidesteps this: it returns a fully-resolved `file://` path.)
- **Don't fetch the `file://` `Location`.** It's there to read, not to follow.
- **`imported_url` ≠ HTML.** Branch on `data.contentType`, not on link mode, when
  deciding how to treat the file (e.g. PDF-viewer vs. web snapshot).
- **Web API vs local API.** Re-stated because it bites: only the local API
  yields local paths. The same item over `api.zotero.org` gives a download URL.

---

## Worked example

Item with citation key `cheng_2025_sycophantic_ai_decreases` → key `LRLP3HD2`,
two `imported_url` attachments, both resolved and confirmed on disk:

| Attachment | `contentType`      | Resolved path                                                              | `enclosure.length` |
|------------|--------------------|----------------------------------------------------------------------------|--------------------|
| `C3JDPCTE` | `application/pdf`  | `/Users/me/Zotero/storage/C3JDPCTE/  cheng…dependence.pdf` (2 leading sp.) | 5,416,796 = size   |
| `XH7VLP2C` | `text/html`        | `/Users/me/Zotero/storage/XH7VLP2C/2510.html`                              | 112,441 = size     |

`enclosure.href` for the PDF, before decoding:
`file:///Users/me/Zotero/storage/C3JDPCTE/%20%20cheng…dependence.pdf`
(the `%20%20` is two real leading spaces in the filename, preserved on disk).

---

## Sources

- Live Zotero local API, v9.0.4 (endpoints `/items/<key>`, `/children`, `/file`).
- `Zotero.Attachments.LINK_MODE_*` and the `storage/<key>/` layout —
  Zotero client source (`chrome/content/zotero/xpcom/attachments.js`),
  stable across Zotero 7–9.
