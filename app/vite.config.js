import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import preact from '@preact/preset-vite';

// Vite root is this directory; ./dist/ is what the Dockerfile copies into
// the runtime image for api/server.py to serve.

const appDir = import.meta.dirname;

// Dev-only sink for deviceDebugLog: phones over a tunnel have no reachable
// console, so telemetry POSTs here and lands in a tailable NDJSON file.
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
