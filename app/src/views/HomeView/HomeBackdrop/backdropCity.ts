// views/HomeView/HomeBackdrop/backdropCity.ts — which repo the landing is
// showing behind itself. Landing chrome, not city state: the backdrop's own
// session holds what it loaded; this is what the page says about it.

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
  /** The loaded branch, normalised like a session's: identity includes it, so a
   *  row storing @main only matches when this carries it too. */
  branch?: string;
  kind: BackdropKind;
}

/** Written only once the backdrop has actually painted, so nothing names a repo
 *  you can't see. Null means the hero image is what's showing. */
export const BACKDROP_CITY = signal<BackdropCity | null>(null);
