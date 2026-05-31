# `pdf-annotation/` — the annotation subsystem

Deep-dive notes on importing a PDF's annotations into Logseq as first-class
`:logseq.class/Pdf-annotation` highlight blocks. The code lives in
`src/services/pdf-annot/` (the conversion core) and its sibling glue in
`src/services/` (`import-annotations.ts`, `logseq-transit.ts`,
`logseq-import-edn.ts`, `read-pdf-bytes.ts`, `find-pdf-asset.ts`).

> **Provenance.** These docs were adapted from the `pdf-annot-logseq` prototype — the
> lab where the coordinate math was worked out and validated. They've been rewritten
> to describe **this repo's** first-party implementation (TypeScript + mupdf; the write
> path is Transit-JSON over Logseq's HTTP API, not the prototype's `logseq import-edn`
> CLI). Where a doc cites the Python origin, it's because the math was copied verbatim
> and the prototype's golden output is still the test oracle — see
> [`typescript-port.md`](./typescript-port.md).

---

## Read in this order

| Doc | What it covers |
|---|---|
| [`overview.md`](./overview.md) | Plain-language tour: what annotation import does, the highlight-type mapping, Logseq's limits as a destination. Start here. |
| [`architecture.md`](./architecture.md) | The end-to-end pipeline, the tech stack, the **coordinate transform (§4)**, the write path (§5), the subsystem layout, and known gaps (§7). The spine. |

## Reach for these when relevant

| Doc | Reach for it when… |
|---|---|
| [`importing-into-logseq.md`](./importing-into-logseq.md) | You're touching the **write path**: the `build-import` payload, the `Pdf-annotation` block schema + `hl-value` sub-shape, the asset attach-trick, and the Transit-over-HTTP-API delivery (§4). Why the plugin Editor API can't do this is §5. |
| [`zotero-annotations.md`](./zotero-annotations.md) | You're touching the **Zotero-database fallback**: the annotation `data` shape, the `annotationPosition` geometry, type→Logseq mapping, deterministic uuids, and the PDF-first ingestion policy (§9). |
| [`pdf-annotations-across-platforms.md`](./pdf-annotations-across-platforms.md) | You need the **PDF/ISO-32000 taxonomy**: what the annotation subtypes are, why each app's list differs, and how Zotero/Logseq (the two database-backed outliers) map onto the standard. Evergreen platform knowledge. |
| [`typescript-port.md`](./typescript-port.md) | You need the **engine & lineage**: why mupdf, the module map, the covered-text reconstruction, the two benign precision diffs, and exactly what the test suite proves (and the in-repo coverage gaps). |

---

## Concept → where it lives

| Concept | File(s) |
|---|---|
| Picking rule (PDF-native first → Zotero fallback) | `src/services/import-annotations.ts` |
| Read a PDF's bytes off its `file://` path | `src/services/read-pdf-bytes.ts` |
| Find a page's PDF asset block(s) for Sync | `src/services/find-pdf-asset.ts` |
| Fetch Zotero-DB annotations for an attachment | `src/services/get-zot-items.ts` (`getRawAnnotationsForAttachment`) |
| Extract embedded `/Annots` (mupdf) | `src/services/pdf-annot/extract.ts` |
| Convert → Logseq `hl-value` records | `src/services/pdf-annot/convert.ts` |
| Convert Zotero-DB annotations | `src/services/pdf-annot/zotero.ts` |
| The coordinate transform | `src/services/pdf-annot/geometry.ts` |
| Color → nearest pastel | `src/services/pdf-annot/colors.ts` |
| Deterministic uuids (Zotero idempotency) | `src/services/pdf-annot/uuid.ts` |
| All-page geometry (Zotero path) | `src/services/pdf-annot/pdf-pages.ts` |
| Build-DSL EDN serializers (canonical byte-shape) | `src/services/pdf-annot/edn.ts` |
| Build map → Transit-JSON | `src/services/logseq-transit.ts` |
| POST to Logseq's HTTP API | `src/services/logseq-import-edn.ts` |
| At-import wiring | `src/services/handle-zot-db.ts` |
| `Sync annotations` / `Sync all annotations` commands | `src/index.tsx`, `src/queries.ts` (`QUERY_ALL_ZOT_PAGES`) |
| Golden tests + fixtures | `src/services/pdf-annot/*.test.ts`, `.../__fixtures__/` |

---

## Related docs outside this folder

| Path | What it is |
|---|---|
| [`../logseq-sdk-notes.md`](../logseq-sdk-notes.md) | The `build-import` write path, the closed-value-property gotcha, and the HTTP-API behavior — the SDK-level companion to `importing-into-logseq.md`. |
| [`../zotero-attachment-paths.md`](../zotero-attachment-paths.md) | Resolving an attachment's absolute on-disk path from Zotero's local API (every `linkMode`) — what `read-pdf-bytes.ts` consumes. |
| [`../../CLAUDE.md`](../../CLAUDE.md) | The repo's behavioural reference; its **Annotation import** section is the dense summary these docs expand on. |
