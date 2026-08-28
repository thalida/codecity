import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const packageDir = import.meta.dirname;

// Two projects, matching the app's split: `unit` runs tests/**, `bench` runs
// tests/bench/** and is excluded from unit, or every run pays its 60s
// harnesses (see tests/bench/README.md).
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json paths and vite.config.js.
    alias: { '@/city': resolve(packageDir, 'src') },
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/three-augment.d.ts'],
      // Floors, not targets: a few points under measured, so ordinary movement
      // passes and a regression fails.
      thresholds: {
        lines: 82,
        statements: 80,
        functions: 76,
        branches: 66,
      },
    },
  },
});
