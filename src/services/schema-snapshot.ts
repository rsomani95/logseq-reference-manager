import type { PropertyPreset } from '../interfaces'

/**
 * The subset of settings that actually change the Logseq *schema* when applied —
 * as opposed to the cosmetic settings (name/separator templates, the page-name
 * prefix, attachment-open mode, every web block-name/fold/order/heading-marker
 * key) which only shape how values get filled in. These are applied together by
 * one "Apply schema", in two groups:
 *   • base schema — the tag, which properties exist, and the creators/authors
 *     property *type* (`setLogseqDbSchema`)
 *   • web wiring — the web tag that `extends` the base (`ensureWebTagExtendsBase`)
 *
 * We persist a snapshot of this config every time it's applied. The "Apply
 * schema" / "Set up web tag" buttons are enabled only when the *live* config
 * differs from that snapshot — so re-typing a value back to what's applied (or
 * merely reordering a custom list) correctly leaves the button disabled. The
 * snapshot is the "actual schema" side of the diff; live settings are the "local
 * edits" side. Strings are compared trim-insensitively (see `baseSchemaDiffers`).
 */
export interface SchemaSnapshot {
  zotTag: string
  propertyPreset: PropertyPreset
  pageProps: string[]
  creatorsAsNodes: boolean
  webTag: string
}

// Undeclared settings key — same approach as `tagRules`: persisted via
// updateSettings, never registered in the schema, so it shows no native settings
// row and isn't part of the web-clipper contract. (Undeclared keys survive
// `useSettingsSchema` re-registration; `tagRules` proves it.)
const SNAPSHOT_KEY = 'appliedSchema'

/** Live schema-relevant config, read raw (untrimmed) from the settings store. */
export const currentSchemaConfig = (): SchemaSnapshot => {
  const s = (logseq.settings ?? {}) as Record<string, unknown>
  return {
    zotTag: (s.zotTag as string) ?? 'Reference',
    propertyPreset: (s.propertyPreset as PropertyPreset) ?? 'Essentials',
    pageProps: Array.isArray(s.pageProps) ? [...(s.pageProps as string[])] : [],
    creatorsAsNodes: (s.creatorsAsNodes as boolean) ?? true,
    webTag: (s.webTag as string) ?? 'Web',
  }
}

/** The last-applied snapshot, or null when none is stored / it's malformed. */
export const readAppliedSnapshot = (): SchemaSnapshot | null => {
  const raw = (logseq.settings as Record<string, unknown> | undefined)?.[
    SNAPSHOT_KEY
  ]
  if (typeof raw !== 'string' || !raw) return null
  try {
    const o = JSON.parse(raw) as Partial<SchemaSnapshot>
    if (typeof o.zotTag !== 'string') return null
    return {
      zotTag: o.zotTag,
      propertyPreset: (o.propertyPreset as PropertyPreset) ?? 'Essentials',
      pageProps: Array.isArray(o.pageProps) ? o.pageProps : [],
      creatorsAsNodes: o.creatorsAsNodes ?? true,
      webTag: typeof o.webTag === 'string' ? o.webTag : '',
    }
  } catch {
    return null
  }
}

export const writeAppliedSnapshot = (snap: SchemaSnapshot): void => {
  void logseq.updateSettings({ [SNAPSHOT_KEY]: JSON.stringify(snap) })
}

export const clearAppliedSnapshot = (): void => {
  void logseq.updateSettings({ [SNAPSHOT_KEY]: '' })
}

const trimEq = (a: string, b: string): boolean => a.trim() === b.trim()

// Order-insensitive set equality. The picker persists in canonical order so the
// list is normally stable, but a set compare means a reorder never reads as a
// schema change.
const samePagePropsSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((x) => set.has(x))
}

/**
 * Does the live base-schema config differ from what was last applied? The full,
 * crisp rule (nothing else touches the base schema):
 *   • base tag name changed (trim-insensitive), OR
 *   • preset changed (Essentials / Full / Custom), OR
 *   • "store creators as page references" changed, OR
 *   • the custom property *set* changed while Custom is selected (order-insensitive;
 *     the list is irrelevant under Essentials/Full, so it's ignored there).
 */
export const baseSchemaDiffers = (
  applied: SchemaSnapshot,
  current: SchemaSnapshot,
): boolean => {
  if (!trimEq(applied.zotTag, current.zotTag)) return true
  if (applied.propertyPreset !== current.propertyPreset) return true
  if (applied.creatorsAsNodes !== current.creatorsAsNodes) return true
  if (
    current.propertyPreset === 'Custom' &&
    !samePagePropsSet(applied.pageProps, current.pageProps)
  ) {
    return true
  }
  return false
}

/** Does the live web tag differ from the one last wired to extend the base? */
export const webTagDiffers = (
  applied: SchemaSnapshot,
  current: SchemaSnapshot,
): boolean => !trimEq(applied.webTag, current.webTag)
