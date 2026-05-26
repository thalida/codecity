import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const appDir = import.meta.dirname;

export default defineConfig({
  // Mirrors vite.config.js — must stay in sync so tests resolve `@/`
  // imports the same way the dev server does.
  resolve: {
    alias: { '@': resolve(appDir, 'src') },
  },
  test: {
    include: ['tests/**/*.test.{js,ts}'],
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
  },
});
