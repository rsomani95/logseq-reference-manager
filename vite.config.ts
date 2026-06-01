import { defineConfig } from 'vite'
import logseqDevPlugin from 'vite-plugin-logseq'

export default defineConfig({
  plugins: [logseqDevPlugin()],
  // mupdf ships a 10 MB sidecar `mupdf-wasm.wasm` that `mupdf-wasm.js` locates at
  // runtime via `new URL("mupdf-wasm.wasm", import.meta.url)`. The production
  // build rewrites that to a hashed same-origin asset (so annotations work in
  // `dist/`), but the dev server's dep pre-bundler (esbuild) does NOT — it bundles
  // mupdf into `.vite/deps/` WITHOUT the sibling wasm, so at runtime the fetch
  // resolves to `/node_modules/.vite/deps/mupdf-wasm.wasm` (missing) and falls
  // through to the SPA HTML, which WebAssembly.compile rejects ("expected magic
  // word 00 61 73 6d, found 3c 21 44 4f" = `<!DO…`). Excluding mupdf from
  // optimization makes Vite serve it unbundled from node_modules, so
  // `import.meta.url` points at the real dir and the sibling wasm resolves and is
  // served as `application/wasm`. Dev-only; the build path is unaffected.
  optimizeDeps: {
    exclude: ['mupdf'],
  },
})
