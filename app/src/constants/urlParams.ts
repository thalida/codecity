// constants/urlParams.ts — Query-param keys shared by the page URL
// (?src=…&branch=…) and the /api/manifest request contract. The backend reads
// these exact names, so the string values are the wire form — don't rename
// without a matching server change.

export const URL_PARAMS = {
  /** Source to render: a git URL or a local path. */
  SRC: 'src',
  /** Optional git branch/ref. */
  BRANCH: 'branch',
  /** When 'true', forces a fresh server-side scan (bypasses the scan cache). */
  NO_CACHE: 'no_cache',
  /** Repeated rel-path the UI hides from the rendered city (client-side pref). */
  EXCLUDE: 'exclude',
  /** Device-pixel-ratio cap override (?dpr=1) — GPU-load diagnostic. */
  DPR: 'dpr',
  /** Pipeline override: 'off' = straight to canvas, 'ldr' = 8-bit targets. */
  FX: 'fx',
  /** Components to blank, e.g. ?hide=gem,fireflies — they still tick, they
   *  just don't render. Bisect knob for device-only glitches. */
  HIDE: 'hide',
  /** Trees-per-chunk override (?chunk=128) — diagnostic knob. */
  CHUNK: 'chunk',
} as const;
