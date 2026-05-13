# Extended Tags

Auto-apply an additional Logseq tag to imported Zotero items based on field-match rules.

## How it works

In `handleZotInDb` (`src/services/handle-zot-db.ts`), after the base `#Zotero` tag is applied, `matchTagRules(zotItem)` walks `TAG_RULES` in `src/extended-tags.ts` and returns a deduped `string[]` of matched tag names. The caller iterates and applies each, skipping any that equal the base `zotTag`. The page ends up with `#Zotero` plus every distinct matched tag.

## Rule shape

```ts
{
  tag: 'MLPaper',
  match: 'any' | 'all',   // combinator across `when`
  when: [
    { field: 'url', op: 'contains', value: 'arxiv.org' },
    { field: 'url', op: 'contains', value: 'openreview.net' },
  ],
}
```

- `field`: a string field on `ZotData`. See `RuleField` for the allowed list — common picks: `url`, `itemType`, `publicationTitle`, `title`, `DOI`, `language`.
- `op`: `contains` | `equals` | `regex`. All case-insensitive (`regex` compiles with the `i` flag).
- `match: 'any'` = OR across `when`, `match: 'all'` = AND.

## Adding a rule

Append to `TAG_RULES` in `src/extended-tags.ts`. The referenced tag must already exist in Logseq and should be configured with `Extends` → `#Zotero` so its property inheritance works.

## Semantics

- **First match wins** across rules (today). `matchTagRules` returns at most one tag, but its shape is `string[]` so flipping to "apply every matching rule" is a one-line change in `matchTagRules` — the caller already iterates and the `Set` already dedupes overlapping `tag` values.
- Any matched tag equal to the base `zotTag` is skipped at the call site.
- The base `#Zotero` tag is always applied, regardless of any rule match.

## Limitations / future work

- **No tag validation**: if the configured tag doesn't exist in Logseq, `addBlockTag` will silently create a bare tag with no `Extends` — defeating the whole point. We want to validate (tag exists AND extends `#Zotero`) before applying, but that's deferred until there's a settings UI to surface the warning.
- **Code-only config**: rules live in source. A real settings UI (JSON textarea, or a dedicated Logseq page parsed at runtime) is the natural next step.
- **String fields only**: array fields like `creators`, Zotero `tags`, and `collections` aren't matchable. Adding them requires per-field matchers (e.g. `op: 'includes'` for arrays).
- **One tag per item** (today): controlled by the `break` inside `matchTagRules`. Remove it to apply every matching rule.
- **No per-tag `pagenameTemplate`**: not planned.
