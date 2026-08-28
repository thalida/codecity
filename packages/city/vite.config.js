import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The package has no build of its own yet. This config exists for the `@/`
// alias below, so anything run from this directory (a lib build, a
// package-local vitest) resolves it the same way tsconfig.json does.

const packageDir = import.meta.dirname;

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json paths: `@/city/*` is this package's own src.
    alias: { '@/city': resolve(packageDir, 'src') },
  },
});
