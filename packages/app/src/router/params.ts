// The page URL is THIS app's contract with the browser, not the package's.
// It happens to spell the source the same way the /api wire form does; that
// is a choice made here, and a host routing by path — or showing two cities
// with no single `?src` to give either — makes a different one.
export const URL_PARAMS = {
  /** Source to render: a git URL or a local path. */
  SRC: 'src',
  /** Optional git branch/ref. */
  BRANCH: 'branch',
  /** When 'true', asks for a fresh server-side scan. */
  NO_CACHE: 'no_cache',
  /** Repeated rel-path this reader hides from the rendered city. */
  EXCLUDE: 'exclude',
} as const;

import { NodeKind } from '@codecity/city';
// router/params.ts — the query params that never leave the browser: what you
// were looking at. Their own vocabulary, so renaming a NodeKind cannot change
// what a link someone is already holding means. The params the server also
// reads are constants/urlParams.

export const VIEW_PARAMS = {
  /** 'timeline' when the city is the union city under the scrubber. Absent is Live. */
  MODE: 'mode',
  /** Sha the scrubber rests on in Timeline. Absent is the present, so a link
   *  that means "now" keeps meaning it as the branch moves. */
  COMMIT: 'commit',
  /** What is selected: `file:<path>`, `dir:<path>` or `commit:<sha>`. One
   *  param, because a selection is one identity. */
  SELECTION: 'sel',
} as const;

/** ?mode's only written value: Live is the absence of the param. */
export const TIMELINE_MODE_PARAM = 'timeline';

export const SELECTION_KIND_PARAMS = {
  [NodeKind.File]: 'file',
  [NodeKind.Directory]: 'dir',
  [NodeKind.Commit]: 'commit',
} as const;
