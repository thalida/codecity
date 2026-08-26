// constants/urlParams.ts — the query params the page URL and the /api wire form
// share: the backend reads these exact names, so renaming one needs a matching
// server change. The browser-only half is router/params.

export const URL_PARAMS = {
  /** Source to render: a git URL or a local path. */
  SRC: 'src',
  /** Optional git branch/ref. */
  BRANCH: 'branch',
  /** When 'true', forces a fresh server-side scan (bypasses the scan cache). */
  NO_CACHE: 'no_cache',
  /** Repeated rel-path the UI hides from the rendered city (client-side pref). */
  EXCLUDE: 'exclude',
} as const;
