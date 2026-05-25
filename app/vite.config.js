import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite root is this directory. Build output lands in ./dist/ — the
// Dockerfile copies app/dist/ into the runtime image's static dir, and
// the api server (api/server.py) serves from there at runtime.
//
// Three.js is bundled into the output via the standard `three` npm
// dependency — no importmap, no CDN runtime fetch.

const appDir = import.meta.dirname;

export default defineConfig({
  root: appDir,
  base: './',
  resolve: {
    // `@/` maps to app/src so cross-directory imports stay short and
    // survive file moves. Mirrored in tsconfig.json paths and
    // vitest.config.js so the editor + test runner resolve identically.
    alias: { '@': resolve(appDir, 'src') },
  },
  build: {
    outDir: resolve(appDir, 'dist'),
    emptyOutDir: true,
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
