export const QUERY_ALL_ZOT_PAGES = `
 [:find (pull ?b [*])
   :where
   [?b :block/tags ?t]
   [?t :block/title "Zotero"]]
`
