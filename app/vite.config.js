import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import preact from '@preact/preset-vite';

// Vite root is this directory. Build output lands in ./dist/ — the
// Dockerfile copies app/dist/ into the runtime image's static dir, and
// the api server (api/server.py) serves from there at runtime.
//
// Three.js is bundled into the output via the standard `three` npm
// dependency — no importmap, no CDN runtime fetch.

const appDir = import.meta.dirname;

// Dev-only sink for src/utils/deviceDebugLog.ts: phones over a tunnel have no
// reachable console, so the page POSTs telemetry here and it lands in a local
// NDJSON file the developer can tail.
const deviceDebugLogPlugin = {
  name: 'device-debug-log',
  configureServer(server) {
    const logFile = resolve(appDir, '.local-debuglog.ndjson');
    server.middlewares.use('/__debuglog', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          appendFileSync(logFile, body.endsWith('\n') ? body : `${body}\n`);
        } catch {
          // Diagnostic sink only — never fail a request over it.
        }
        res.statusCode = 204;
        res.end();
      });
    });
  },
};

export default defineConfig({
  root: appDir,
  base: './',
  plugins: [preact(), deviceDebugLogPlugin],
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
      // VITE_API_PROXY is set by docker-compose.dev.yml (Task 13) to point at
      // the api service over the compose-internal network. Fallback matches
      // `python -m api`'s default port for ad-hoc "vite alone, api alone" dev.
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8080',
    },
  },
});
