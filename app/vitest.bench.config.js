import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const appDir = import.meta.dirname;

// Dedicated config for perf smoke harnesses under bench/. The default
// vitest.config.js excludes bench/ from `npm test`; this config flips it
// the other way so `npm run bench` runs ONLY the bench files.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(appDir, 'src') },
  },
  test: {
    include: ['bench/**/*.test.{js,ts}'],
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
  },
});
