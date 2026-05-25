import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite root is this directory. Build output lands in ../api/static/
// so the Python package can serve it directly via the http server in
// api/server.py — that committed `api/static/` is what
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
    outDir: resolve(webDir, '..', 'api', 'static'),
    emptyOutDir: true,
    rollupOptions: {
      external: [/^three$/, /^three\/addons\//],
    },
  },
  server: {
    // Bind to IPv6 loopback. The codecity CLI opens
    // `http://<label>.localhost:<port>/` so worktrees are identifiable in
    // the URL bar; macOS resolves *.localhost to [::1, 127.0.0.1] and
    // Chrome tries ::1 first. If we bound to 127.0.0.1, the initial doc
    // load would fall back but parallel subresource fetches race the
    // refused IPv6 attempt and intermittently fail with
    // ERR_CONNECTION_REFUSED. Binding to ::1 keeps loopback-only and
    // matches the address browsers actually try first.
    host: '::1',
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
