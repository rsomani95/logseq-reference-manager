# Logseq Plugin SDK — Notes

Practical notes from building a Logseq plugin against `@logseq/libs`. Scope: **DB graphs**. The official docs cover the API surface — this page covers what's documented wrong, undocumented, or only discoverable by trial and error.

## Properties

### `getProperty(name)` resolves to your plugin's namespace

Don't qualify property names with your plugin's ident prefix. The bare name is enough:

```ts
// ✓
const prop = await logseq.Editor.getProperty('tags')

// Unnecessary
const prop = await logseq.Editor.getProperty(':plugin.property.<your-id>/tags')
```

Even for names that look like they'd collide with built-ins (`tags`, `title`, `url`, `date`), the bare lookup returns *your* plugin's property — Logseq's built-ins for those concepts live under different idents (`:block/tags`, `:block/title`, …), not `:logseq.property/<name>`. Verified by upserting each name from a plugin and round-tripping the lookup.

> This is about looking up the property *schema*. When reading a property *value* off a page or block, the key on the block IS qualified (`:plugin.property.<id>/<name>`), so value reads do need the full ident.

### `upsertProperty`'s `name` opt is a no-op

The display-name override is silently ignored:

```ts
// `{ name: 'Tags' }` does nothing — display name stays as the kebab ident
await logseq.Editor.upsertProperty('tags', schema, { name: 'Tags' })
```

The display name is the property block's `title`. Set it directly:

```ts
const prop = await logseq.Editor.upsertProperty('tags', schema)
if (prop?.uuid) {
  await logseq.Editor.updateBlock(prop.uuid, 'Tags')
}
```

### `schema.hide` is a no-op for the UI's "Hide by default"

The SDK rewrites `schema.hide: true` to the unqualified attribute `:hide?`, but the UI reads the qualified `:logseq.property/hide?`. The schema flag is dead. Set the qualified attribute on the property block directly:

```ts
await logseq.Editor.upsertBlockProperty(
  prop.uuid,
  'logseq.property/hide?',
  true,
)
```

Same pattern for **hide-empty-value** and **description** — both live as qualified attributes on the property block, not in the schema:

```ts
await logseq.Editor.upsertBlockProperty(
  prop.uuid,
  'logseq.property/hide-empty-value',
  true,
)

await logseq.Editor.upsertBlockProperty(
  prop.uuid,
  'logseq.property/description',
  'A short description',
)
```

### `upsertBlockProperty` ignores empty strings

You can't clear a value by setting it to `''`. To unset a previously-set description (or any string property), **remove** it instead:

```ts
await logseq.Editor.removeBlockProperty(prop.uuid, 'logseq.property/description')
```

## SDK versioning

`@logseq/libs` on npm has a misleading `latest` tag. As of 2026-05-18:

| Tag | Version | What it is |
|---|---|---|
| `latest` | 0.0.17 | The **old** file-graph SDK — do not use for DB-graph plugins |
| `next` | 0.3.3 | Current DB-graph line |

```bash
npm install @logseq/libs@next
```

Check published tags directly before pinning a version: <https://www.npmjs.com/package/@logseq/libs?activeTab=versions>

## Theming

`--ls-*` CSS variables live on Logseq's host DOM and **don't cascade into the plugin iframe**. To use them, resolve and mirror onto your own `:root`:

```ts
const vars = await logseq.UI.resolveThemeCssPropsVals([
  '--ls-primary-text-color',
  '--ls-primary-background-color',
  '--ls-border-color',
])
for (const [k, v] of Object.entries(vars ?? {})) {
  document.documentElement.style.setProperty(k, v)
}
```

Re-run on `logseq.App.onThemeModeChanged` to track light/dark switches.

## Dev workflow

### Prod build clobbers the dev-server `dist/index.html`

The dev server (e.g. `vite` via `vite-plugin-logseq`) and the prod build both write to `dist/index.html`. Running a prod build while the dev server is also active overwrites the dev HTML with the static prod bundle — subsequent source edits stop reaching Logseq because Logseq is reading the static file the build wrote, not the dev server.

Fix: restart the dev server and reload the plugin in Logseq (Settings → Plugins → reload).

## Debugging

### Slash-command callbacks swallow errors

`registerSlashCommand` doesn't attach an error sink. A throw inside the handler vanishes — nothing shows up in the console. Wrap risky calls in `try/catch` so failures surface:

```ts
logseq.Editor.registerSlashCommand('My command', async () => {
  try {
    await doRiskyThing()
  } catch (e) {
    console.error('My command failed:', e)
    await logseq.UI.showMsg(`Error: ${(e as Error).message}`, 'error')
  }
})
```

### Plugin logs may live in the iframe console

Plugin UI runs in an iframe; logs from it may not surface in the main DevTools console. Right-click any plugin UI element → *Inspect*, or use the DevTools frame selector to pick the plugin iframe.
