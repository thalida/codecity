// router/params.ts — the query params that never leave the browser: what you
// were looking at. Their own vocabulary, so renaming a NodeKind cannot change
// what a link someone is already holding means. The params the server also
// reads are constants/urlParams.

import { NodeKind } from '@/types';

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
