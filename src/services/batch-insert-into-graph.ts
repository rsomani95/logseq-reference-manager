import { ZotData } from '../interfaces'
import { handleZotInDb, resolvePageName } from './handle-zot-db'
import { isSchemaAdded } from './is-schema-added'

export interface BatchProgress {
  /** Items fully processed so far (imported, skipped, or failed). */
  done: number
  total: number
  /** Title of the item currently being processed, for display. */
  currentTitle: string
}

export interface BatchFailure {
  item: ZotData
  message: string
}

export interface BatchResult {
  imported: ZotData[]
  /** Items skipped because they were already in the graph. */
  skipped: ZotData[]
  failed: BatchFailure[]
  /** True if the run was stopped early by the caller. */
  cancelled: boolean
}

interface BatchCallbacks {
  onProgress: (progress: BatchProgress) => void
  isCancelled: () => boolean
}

/**
 * Imports a list of Zotero items into the graph one at a time. Items already
 * in the graph are skipped; a failure on one item is recorded and the run
 * continues with the next. Progress is reported after each item, and the
 * caller can stop the run between items via `isCancelled` (work already done
 * is kept and returned).
 *
 * Throws only on a pre-flight failure — schema not set up — i.e. when nothing
 * could be imported at all. Per-item errors land in the returned `failed` list.
 */
export const batchInsertIntoGraph = async (
  items: ZotData[],
  callbacks: BatchCallbacks,
): Promise<BatchResult> => {
  const { onProgress, isCancelled } = callbacks

  if (!(await isSchemaAdded())) {
    throw new Error(
      'Add the Zotero schema first — run "logseq-zoterolocal-plugin: Add Zotero schema to Logseq" from the command palette, then try again.',
    )
  }

  const result: BatchResult = {
    imported: [],
    skipped: [],
    failed: [],
    cancelled: false,
  }

  for (const [index, item] of items.entries()) {
    if (isCancelled()) {
      result.cancelled = true
      break
    }
    onProgress({ done: index, total: items.length, currentTitle: item.title })

    // Defensive: the UI pre-filters in-graph items out of the selection, but
    // skip-and-report here too so a stale `inGraph` flag can't create dupes.
    if (item.inGraph) {
      result.skipped.push(item)
      continue
    }

    try {
      await handleZotInDb(item, resolvePageName(item), { navigate: false })
      result.imported.push(item)
    } catch (e) {
      result.failed.push({
        item,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  onProgress({ done: items.length, total: items.length, currentTitle: '' })
  return result
}
