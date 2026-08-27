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
    // One Signal identity across both packages, or an effect on one side never
    // sees a write from the other.
    dedupe: ['@preact/signals', '@preact/signals-core', 'three'],
    // Mirrored in tsconfig.json paths + vitest.config.js so the editor and
    // test runner resolve `@/` identically.
    // Array form: order matters, and '@/city' has to win over '@'.
    alias: [
      { find: /^@\/city\//, replacement: `${resolve(appDir, '../city/src')}/` },
      { find: /^@\//, replacement: `${resolve(appDir, 'src')}/` },
      // @codecity/city ships TypeScript source, not a build, for as long as the
      // extraction is in flight (#208). Vite will not process TS inside
      // node_modules, so resolve the workspace link to the source directly.
      { find: '@codecity/city', replacement: resolve(appDir, '../city/src/index.ts') },
      // three lives in the package now. The app's own tests still import it, so
      // point them at that one copy rather than installing a second.
      // `three/addons/*` is an exports-map alias for examples/jsm; aliasing the
      // package path directly bypasses that map, so make the hop explicit.
      {
        find: /^three\/addons\/(.*)/,
        replacement: `${resolve(appDir, '../city/node_modules/three/examples/jsm')}/$1`,
      },
      { find: /^three\/(.*)/, replacement: `${resolve(appDir, '../city/node_modules/three')}/$1` },
      // The entry file, not the directory: aliasing the directory bypasses
      // three's exports map, and a second entry means a second Vector3.
      {
        find: /^three$/,
        replacement: resolve(appDir, '../city/node_modules/three/build/three.module.js'),
      },
    ],
  },
  build: {
    outDir: resolve(appDir, 'dist'),
    emptyOutDir: true,
  },
  server: {
    fs: {
      // @codecity/city is a sibling directory, outside this root, and it now
      // resolves assets out of its own node_modules.
      allow: [appDir, resolve(appDir, '../city')],
    },
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
