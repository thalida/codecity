// state/stores/backdrop.ts — the city behind the switcher. Not a project you
// opened: MANIFEST and CURRENT_SOURCE stay empty while one of these paints, so
// nothing in the chrome starts naming a repo you cannot interact with.

import { signal } from '@preact/signals';

/** Which repo the backdrop came from. */
export enum BackdropKind {
  /** The most recent project, from whatever the server had cached for it. */
  Recent = 'recent',
  /** The server's featured repo. */
  Featured = 'featured',
}

export interface BackdropCity {
  src: string;
  label: string;
  /** The loaded branch, normalised like CURRENT_SOURCE's: identity includes it,
   *  so a row storing @main only matches when this carries it too. */
  branch?: string;
  kind: BackdropKind;
}

/** Written only once the backdrop has actually painted, so nothing names a repo
 *  you can't see. Null means the hero image is what's showing. */
export const BACKDROP_CITY = signal<BackdropCity | null>(null);
