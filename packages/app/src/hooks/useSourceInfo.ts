// hooks/useSourceInfo.ts — what the city on screen is, named.
//
// A hook rather than a module signal because the label and branch come off the
// manifest the CITY published: a second city on the page has a different answer,
// and there is nowhere for one of them to win.

import { useCityManifest } from '@codecity/city/preact';

import { sourceInfoFrom, type SourceInfo } from '@/state/stores/source';

export function useSourceInfo(): SourceInfo {
  return sourceInfoFrom(useCityManifest());
}
