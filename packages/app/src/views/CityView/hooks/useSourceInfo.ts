// views/CityView/hooks/useSourceInfo.ts — what the city on screen IS, named:
// the label the server gave it, the branch it resolved to, and where it came
// from. Off the manifest the CITY published, so two cities give two answers.

import { useCityManifest } from '@codecity/city/preact';
import { srcKind, SourceKind, resolveBranch } from '@codecity/city';

import { CURRENT_SOURCE } from '@/state/source';

export interface SourceInfo {
  label: string;
  branch?: string;
  sourceUrl?: string;
  src?: string;
}

export function useSourceInfo(): SourceInfo {
  const manifest = useCityManifest();
  const cur = CURRENT_SOURCE.value;
  if (!cur || !manifest) {
    return { label: '', branch: undefined, sourceUrl: undefined, src: undefined };
  }
  return {
    label: manifest.tree?.name ?? '',
    branch: resolveBranch(manifest, cur.branch),
    sourceUrl: srcKind(cur.src) === SourceKind.Remote ? cur.src : undefined,
    src: cur.src,
  };
}
