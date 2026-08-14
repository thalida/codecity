// constants/urlParams.ts — the page URL's query-param keys, in two families.
// URL_PARAMS are also the /api/manifest wire form: the backend reads these
// exact names, so don't rename one without a matching server change.
// VIEW_PARAMS never leave the browser — they say what you were looking at.

import { NodeKind } from '@/types';

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

export const VIEW_PARAMS = {
  /** 'timeline' when the city is the union city under the scrubber. Absent is Live. */
  MODE: 'mode',
  /** Sha the scrubber rests on in Timeline. Absent is the present, so a link
   *  that means "now" keeps meaning it as the branch moves. */
  COMMIT: 'commit',
  /** What is selected: `file:<path>`, `dir:<path>` or `commit:<sha>`. One
   *  param, because a selection is one identity (state/viewUrl encodes it). */
  SELECTION: 'sel',
} as const;

/** ?mode's only written value: Live is the absence of the param. */
export const TIMELINE_MODE_PARAM = 'timeline';

// ?sel's kind tokens: their own vocabulary, so renaming a NodeKind can't change
// what a link someone is already holding means.
export const SELECTION_KIND_PARAMS = {
  [NodeKind.File]: 'file',
  [NodeKind.Directory]: 'dir',
  [NodeKind.Commit]: 'commit',
} as const;
