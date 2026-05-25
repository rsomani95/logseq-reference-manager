## Key Features

### Search

- Defer to Zotero's API for search instead of implementing our own

### Single Item Import

- Replace `/Zotero: insert full item`'s search implementation with a more informative one: No blank slate, more results with better formatting. Some caching
- Native UI theming for the search bar
- Finishes an import before opening the new page (earlier, page was created instantly and you'd see the properties populate in realtime)

### Batch Import

- New command to batch import items -- you can either search, or import from collections or saved searches within your library
- Has pagination built in, so if you have a ton of items, we fetch a few first and display them, and load more items in the background. Feels fairly snappy

### Extended Tags

`Zotero: Edit tag rules`

You can setup rules to automatically add specific tags when certain conditions match against the metadata of what's being imported. This can help you build a more sophisticated tagging system where you may want references from certain sources / URLs to be tagged in a specific way.

This enables use cases like: If the imported item has "arxiv" in it's `URL`, tag it with `#Paper`. The tags you choose to extend them might be extending the base Zotero tag, or could be standalone tags - depends on your use case.

## Schema
- Simplified presets - `Essentials`, `Full` (~1:1 match with the Zotero API), and `Custom` where you can pick and choose what properties you want
- Dedicated `authors` field (all non-authors go into the `creators` field)
- All properties are hidden by default
- Display property names in a more human readable format ('Archive ID' vs 'archive-i-d')
- Opinionated set of fields that appear on top of any imported item. This can be re-ordered in the UI per your preferences
- Add descriptions for most fields (barring the obvious ones, like 'Title', etc)

## Aesthetics

- Plugin feels native to whatever theme you're using, as it uses `--ls-*` CSS variables for styling

## Other
- Updated prefix to be `@` to more easily find imported references

## Bugfixes
- 'In Graph' / 'Not In Graph' detection is now rename-proof. Items are matched by their Zotero key (stored as the `zotero-code` property) rather than by page name, so renaming an imported page no longer makes it show up as 'not in graph'. Re-importing a renamed item links the existing page instead of creating a duplicate, and the search popup re-checks this each time you reopen it — so imports, renames, and deletions show up without reloading the app.
- Fixed bugs with error msg reporting. I forget specifics, but it works much better now. If you've deleted a page (it isn't deleted but recycled), the plugin can't handle re-importing for you due to plugin limitations and recycle mechanism, but gives you a clear message on what to do
- Fix last-sync name

## Deleted
- Removed `/Zotero: Cite (insert citation)` - I didn't find it useful to cite something that isnt imported. To cite, use `[[@...]]`. In the future, maybe add a subset of the new searchbar while filtering for "In Graph"
- Simplify and remove all MD related stuff
