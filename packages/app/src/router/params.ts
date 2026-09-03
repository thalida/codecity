// router/params.ts — the query params, and what they mean. THIS app's contract
// with the browser, not the package's: a host routing by path, or showing two
// cities with no single ?src to give either, spells it otherwise.

import { NodeKind } from '@codecity/city';

/** What to load. The server reads these too, under the same names. */
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

/** Where you are in what was loaded. Their own vocabulary, so renaming a
 *  NodeKind cannot change what a link someone is holding means. */
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
