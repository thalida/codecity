// state/stores/manifest.ts — the manifest of one open city, at HEAD. Its
// session's fetch layer writes it and everything in that session reads it. Two
// neighbours answer the same question differently: `timeline.ts` for what a
// scrub position implies, `progress.ts` for how far its build has got.

import { signal } from '@preact/signals';
import type { Manifest, DirNode } from '@/types';

// The union spans a final Manifest, a bare DirNode, and the loose skeleton the
// stream emits before it is fully typed.
export type ManifestValue = Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null;

export class ManifestStore {
  /** What this city is, as last fetched. */
  readonly current = signal<ManifestValue>(null);

  /** Skeleton, final, live-update or a rollback. The fetch layer is the single
   *  writer; everything else reads. */
  set = (m: ManifestValue): void => {
    this.current.value = m ?? null;
  };
}
