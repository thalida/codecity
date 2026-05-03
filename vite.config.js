import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite root is `web/` (frontend source). Build output lands in
// `codecity/static/` so the Python package can serve it directly via the
// http server in codecity/server.py — that committed `codecity/static/`
// is what `pip install codecity` ships.
//
// Three.js is loaded from a CDN via the importmap in index.html; rollup
// treats it as external.

const repoRoot = import.meta.dirname;

export default defineConfig({
  root: resolve(repoRoot, 'web'),
  base: './',
  build: {
    outDir: resolve(repoRoot, 'codecity/static'),
    emptyOutDir: true,
    rollupOptions: {
      external: [/^three$/, /^three\/addons\//],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8765',
    },
  },
});
