import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const appDir = import.meta.dirname;

// Two projects share the same `@/` alias and jsdom setup:
//   - `unit`  → tests/**/*.test.{js,ts}   (run by `npm test`)
//   - `bench` → bench/**/*.test.{js,ts}   (run by `npm run bench`)
// `extends: true` inherits the root resolve.alias so we don't duplicate it.
export default defineConfig({
  // Mirrors vite.config.js — must stay in sync so tests resolve `@/`
  // imports the same way the dev server does.
  resolve: {
    alias: { '@': resolve(appDir, 'src') },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['tests/setup.ts'],
          include: ['tests/**/*.test.{js,ts}'],
          // jsdom + canvas tests can spike past the 5s default under parallel load.
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'bench',
          environment: 'jsdom',
          setupFiles: ['tests/setup.ts'],
          include: ['bench/**/*.test.{js,ts}'],
          // Perf smoke harnesses are slow by design.
          testTimeout: 60_000,
        },
      },
    ],
  },
});
