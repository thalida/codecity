// hooks/useSourceInfo.ts — what the city on screen is, named. A hook rather
// than a module signal because the label and branch come off the manifest the
// CITY published, and a second city on the page has a different answer.

import { useCityManifest } from '@codecity/city/preact';

import { sourceInfoFrom, type SourceInfo } from '@/state/source';

export function useSourceInfo(): SourceInfo {
  return sourceInfoFrom(useCityManifest());
}
