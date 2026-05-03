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
  build: {
    outDir: resolve(webDir, '..', 'codecity', 'static'),
    emptyOutDir: true,
    rollupOptions: {
      external: [/^three$/, /^three\/addons\//],
    },
  },
  server: {
    port: 5173,
    // strictPort: don't silently shift to 5174 if 5173 is taken — codecity
    // dev mode polls 5173, so a port shift would look like "Vite never came
    // up" instead of the real cause (another process holding the port).
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8765',
    },
  },
});
