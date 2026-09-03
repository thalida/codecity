// client/urlParams.ts — the query params the /api wire form uses. The backend
// reads these exact names, so renaming one needs a matching server change.
//
// INTERNAL, and deliberately: these describe a request this client makes, not a
// page. A host's own URL is its own — it may route by path, it may show two
// cities side by side with no single `?src` to give either of them, and it must
// never inherit our wire names as its address bar.

export const API_PARAMS = {
  /** Source to scan: a git URL or a local path. */
  SRC: 'src',
  /** Optional git branch/ref. */
  BRANCH: 'branch',
  /** When 'true', forces a fresh server-side scan (bypasses the scan cache). */
  NO_CACHE: 'no_cache',
  /** Repeated rel-path to leave out of the scan. */
  EXCLUDE: 'exclude',
} as const;
