import { defineConfig } from 'vitest/config';

const webDir = import.meta.dirname;

export default defineConfig({
  // Mirrors vite.config.js — must stay in sync so tests resolve `@/`
  // imports the same way the dev server does.
  resolve: {
    alias: { '@': webDir },
  },
  test: {
    include: ['tests/**/*.test.{js,ts}'],
    environment: 'jsdom',
  },
});
