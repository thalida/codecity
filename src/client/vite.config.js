import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The package has no build of its own yet. This config exists for the `@/`
// alias below, so anything run from this directory (a lib build, a
// package-local vitest) resolves it the same way tsconfig.json does.

const packageDir = import.meta.dirname;

export default defineConfig({
  resolve: {
    // Temporary, mirrors tsconfig.json paths. Deleted with it (#208).
    alias: { '@': resolve(packageDir, '../app/src') },
  },
});
