import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite root is this directory. Build output lands in ../codecity/static/
// so the Python package can serve it directly via the http server in
// codecity/server.py — that committed `codecity/static/` is what
// `pip install codecity` ships.
//
// Three.js is loaded from a CDN via the importmap in index.html; rollup
// treats it as external.

const webDir = import.meta.dirname;

export default defineConfig({
  root: webDir,
  base: './',
  resolve: {
    // `@/` maps to web/src so cross-directory imports stay short and
    // survive file moves. Mirrored in tsconfig.json paths and
    // vitest.config.js so the editor + test runner resolve identically.
    alias: { '@': resolve(webDir, 'src') },
  },
  build: {
    outDir: resolve(webDir, '..', 'codecity', 'static'),
    emptyOutDir: true,
    rollupOptions: {
      external: [/^three$/, /^three\/addons\//],
    },
  },
  server: {
    // Bind explicitly to IPv4. Vite's default `localhost` resolves to ::1
    // first on many Node setups (macOS especially), but the codecity CLI
    // polls 127.0.0.1 — the resulting v6/v4 mismatch shows up as "Vite did
    // not become ready" while the browser still works (since the browser
    // tries both families).
    host: '127.0.0.1',
    port: 5173,
    // strictPort: don't silently shift to 5174 if 5173 is taken — codecity
    // dev mode polls 5173, so a port shift would look like "Vite never came
    // up" instead of the real cause (another process holding the port).
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VITE_API_PORT ?? 8765}`,
    },
  },
});
