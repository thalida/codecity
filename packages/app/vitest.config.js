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
    // One Signal identity across both packages, or an effect on one side never
    // sees a write from the other.
    dedupe: ['@preact/signals', '@preact/signals-core', 'three'],
    // Array form: order matters, and '@/city' has to win over '@'.
    alias: [
      { find: /^@\/city\//, replacement: `${resolve(appDir, '../city/src')}/` },
      { find: /^@\//, replacement: `${resolve(appDir, 'src')}/` },
      // @codecity/city ships TypeScript source, not a build, for as long as the
      // extraction is in flight (#208). Vite will not process TS inside
      // node_modules, so resolve the workspace link to the source directly.
      // Anchored: a bare string find is a prefix match, and would rewrite the
      // /testing subpath into a path under index.ts.
      // The renderer stubs resolve on their own, ahead of the barrel: a
      // vi.mock('three') factory awaiting the barrel would wait on three.
      {
        find: /^@codecity\/city\/testing\/three$/,
        replacement: resolve(appDir, '../city/tests/_helpers/threeMock.ts'),
      },
      {
        find: /^@codecity\/city\/testing$/,
        replacement: resolve(appDir, '../city/tests/index.ts'),
      },
      { find: /^@codecity\/city$/, replacement: resolve(appDir, '../city/src/index.ts') },
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
