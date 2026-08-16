import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';

const appDir = import.meta.dirname;

// Two projects share the same `@/` alias and jsdom setup:
//   - `unit`  → tests/**/*.test.{js,ts}       (run by `npm test`)
//   - `bench` → tests/bench/**/*.test.{js,ts} (run by `npm run bench`, and
//               excluded from unit, or every run would pay their 60s harnesses)
// `extends: true` inherits the root resolve.alias so we don't duplicate it.
//
// tests/bench/ holds timing harnesses only. The bit-identical golden guards sit
// with the unit tests because they assert correctness, not speed: parked in
// bench they ran in neither CI nor the pre-push gate.
export default defineConfig({
  // Preact plugin mirrors vite.config.js so vitest can parse JSX/TSX in
  // source modules that tests transitively import.
  plugins: [preact()],
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
