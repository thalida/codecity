import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';

// Vite root is this directory; ./dist/ is what the Dockerfile copies into
// the runtime image for packages/api to serve.

const appDir = import.meta.dirname;

export default defineConfig({
  root: appDir,
  base: './',
  plugins: [preact()],
  resolve: {
    // Mirrored in tsconfig.json paths + vitest.config.js so the editor and
    // test runner resolve `@/` identically.
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
      // docker-compose.dev.yml sets VITE_API_PROXY to the compose-internal
      // api; the fallback matches `python -m api`'s default port.
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8080',
    },
  },
});
