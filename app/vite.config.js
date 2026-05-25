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
    // Bind in container (0.0.0.0) so the host can reach the dev server
    // via the published port. Was '::1' which is host-only.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Accept any Host header — required for worktree subdomains like
    // `feature-x.localhost:5174`. Vite 5+ rejects unknown hosts by default.
    allowedHosts: true,
    proxy: {
      // VITE_API_PROXY is set by docker-compose.dev.yml to point at the
      // api service over the compose-internal network. Fallback covers
      // non-container dev (unlikely now).
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8000',
    },
  },
});
