import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';

const appDir = import.meta.dirname;

// Two projects: `unit` runs tests/**, `bench` runs tests/bench/** and is
// excluded from unit, or every run pays its 60s harnesses (see its README).
export default defineConfig({
  // Preact plugin mirrors vite.config.js so vitest can parse JSX/TSX in
  // source modules that tests transitively import.
  plugins: [preact()],
  // Mirrors vite.config.js — must stay in sync so tests resolve `@/`
  // imports the same way the dev server does.
  resolve: {
    alias: {
      '@': resolve(appDir, 'src'),
      // @codecity/city ships TypeScript source, not a build, for as long as the
      // extraction is in flight (#208). Vite will not process TS inside
      // node_modules, so resolve the workspace link to the source directly.
      '@codecity/city': resolve(appDir, '../city/src/index.ts'),
    },
  },
  server: {
    fs: {
      // @codecity/city is a sibling directory, outside this root, and it now
      // resolves assets out of its own node_modules.
      allow: [appDir, resolve(appDir, '../city')],
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['tests/setup.ts'],
          include: ['tests/**/*.test.{js,ts,tsx}'],
          exclude: ['tests/bench/**'],
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
          include: ['tests/bench/**/*.test.{js,ts}'],
          // Perf smoke harnesses are slow by design.
          testTimeout: 60_000,
        },
      },
    ],
    // Random order every run, so a test that only passes after its neighbour ran
    // says so. Top level, not per-project: there vitest ignores it.
    sequence: { shuffle: true },
    // Coverage applies to whichever project is selected via --project=unit.
    // Top-level placement keeps the config in one spot rather than per-project.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**', // type-only files
        'src/three-augment.d.ts',
        'src/vite-env.d.ts',
      ],
      // Floors, not targets: a few points under measured, so ordinary movement
      // passes and a regression fails.
      thresholds: {
        lines: 82,
        statements: 79,
        functions: 80,
        branches: 68,
      },
    },
  },
});
