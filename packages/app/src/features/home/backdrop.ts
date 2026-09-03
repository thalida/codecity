// features/home/backdrop.ts — which repo is showing behind the landing. Only
// this view has a wallpaper, so only this view knows about it.

import { signal, computed } from '@preact/signals';

import { CURRENT_SOURCE } from '@/state/source';

// ── The city behind the landing ───────────────────────────────────────

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

/** What the landing marks as current: the project you opened, or the featured
 *  repo showing behind it. Rows mark against this, so one repo marks the same */
export const ACTIVE_SOURCE = computed<{ src: string; branch?: string } | null>(() => {
  const current = CURRENT_SOURCE.value;
  if (current) return current;
  const backdrop = BACKDROP_CITY.value;
  return backdrop ? { src: backdrop.src, branch: backdrop.branch } : null;
});
