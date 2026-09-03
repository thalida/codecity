import { defineConfig } from 'vite';

// The package has no build of its own yet, and no aliases: every import inside
// src/ and tests/ is relative, so this file resolves nothing that node would
// not. That is the point — a path alias in published source resolves only if
// the CONSUMER happens to map the same prefix, which no installed consumer
// does.

export default defineConfig({});
