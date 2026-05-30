/**
 * Live write path for PDF annotations.
 *
 * POSTs a Transit-encoded `logseq.db.sqlite.build` payload to Logseq's desktop
 * HTTP API (`logseq.cli.import_edn` → build-import → transact). This is the only
 * route that can write `Pdf-annotation` blocks with their closed-value
 * `hl-color` ref and `hl-value` EDN map — the `@logseq/libs` Editor API
 * sanitizes to scalar user-properties and cannot (see
 * `../../dev_notes/LOGSEQ_SDK_NOTES.md` and the prototype's
 * importing-into-logseq.md §5). Verified end-to-end against a live graph.
 *
 * Requires Logseq's "HTTP APIs Server" enabled and its auth token saved in
 * plugin settings (`logseqApiToken`); the base URL defaults to
 * `LOGSEQ_API_BASE_DEFAULT` and is overridable via `logseqApiBaseUrl`.
 */
import { LOGSEQ_API_BASE_DEFAULT } from '../constants'
import { buildLiveImportMap, transitWrite } from './logseq-transit'
import type { ConvertedRecord } from './pdf-annot/types'

/** Thrown for any failure on the live import path (config, transport, or build). */
export class LogseqApiError extends Error {}

const readApiConfig = (): { base: string; token: string } => {
  const base =
    (logseq.settings?.logseqApiBaseUrl as string | undefined)?.trim() ||
    LOGSEQ_API_BASE_DEFAULT
  const token =
    (logseq.settings?.logseqApiToken as string | undefined)?.trim() || ''
  return { base, token }
}

/** True when an API token is configured, i.e. the write path can run. */
export const hasLogseqApiToken = (): boolean => readApiConfig().token.length > 0

/**
 * Attach `records` as `Pdf-annotation` children of the PDF asset block (by
 * uuid), declared under the host reference page (by title). Idempotent:
 * re-running upserts by block uuid (`:build/keep-uuid?`), so it never
 * duplicates. A no-op when `records` is empty.
 */
export const importAnnotationRecords = async (
  records: ConvertedRecord[],
  assetUuid: string,
  pageTitle: string,
): Promise<void> => {
  if (records.length === 0) return

  const { base, token } = readApiConfig()
  if (!token) {
    throw new LogseqApiError(
      "No Logseq API token set. In Logseq, enable Settings → Features → HTTP APIs Server, then paste its auth token into Reference Manager's Annotations settings.",
    )
  }

  const transit = transitWrite(
    buildLiveImportMap(records, assetUuid, pageTitle),
  )

  let res: Response
  try {
    res = await fetch(`${base}/api`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'logseq.cli.import_edn',
        args: [transit],
      }),
    })
  } catch (e) {
    throw new LogseqApiError(
      `Couldn't reach Logseq's HTTP API at ${base}. Is the HTTP APIs Server enabled? (${(e as Error).message})`,
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new LogseqApiError(
      `Logseq rejected the annotation import (HTTP ${res.status}). ${body.slice(0, 400)}`,
    )
  }
}
