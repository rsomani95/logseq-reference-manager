// Pages carrying the base reference tag — i.e. Zotero imports. Parameterized on
// the tag title (`:in $ ?tag`) so it tracks the configured `zotTag` instead of a
// hardcoded name; pass `JSON.stringify(zotTag)` as the input. Web clips (tagged
// `webTag`, which only *extends* the base) aren't matched here — they carry no
// Zotero annotations to sync.
export const QUERY_ALL_ZOT_PAGES = `
 [:find (pull ?b [*])
   :in $ ?tag
   :where
   [?b :block/tags ?t]
   [?t :block/title ?tag]]
`
