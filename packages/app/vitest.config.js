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
    // One identity each: two preacts means two hook dispatchers, and the
    // package's adapter renders against a null one.
    dedupe: ['preact', 'preact/hooks', '@preact/signals', '@preact/signals-core', 'three'],
    // Array form: order matters, and the /testing subpath has to win over the
    // bare package name.
    alias: [
      { find: /^@\//, replacement: `${resolve(appDir, 'src')}/` },
      // React-facing libraries onto preact/compat: vitest resolves modules
      // itself, so without this a query provider finds no hooks.
      { find: /^react-dom\/test-utils$/, replacement: 'preact/test-utils' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react$/, replacement: 'preact/compat' },
      // The package ships TS source, not a build, and vite will not process TS
      // inside node_modules: resolve the workspace link to the source itself.
      {
        find: /^@codecity\/city\/preact$/,
        replacement: resolve(appDir, '../city/src/preact/index.ts'),
      },
      {
        find: /^@codecity\/city\/testing\/three$/,
        replacement: resolve(appDir, '../city/tests/_helpers/threeMock.ts'),
      },
      {
        find: /^@codecity\/city\/testing$/,
        replacement: resolve(appDir, '../city/tests/index.ts'),
      },
      { find: /^@codecity\/city$/, replacement: resolve(appDir, '../city/src/index.ts') },
      // three lives in the package; the app's tests import that one copy.
      // addons/* is an exports-map alias, which a path alias bypasses.
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
    // An aliased dependency has to be transformed by vite to see the alias:
    // externalised, TanStack Query resolves the real react and finds no hooks.
    server: { deps: { inline: [/@tanstack\/react-query/] } },
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
