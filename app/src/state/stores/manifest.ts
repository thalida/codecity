// state/stores/manifest.ts — the manifest of one open project, at HEAD. Its
// session's fetch layer writes it and everything in that session reads it. Two
// neighbours answer the same question differently: `timeline.ts` for what a
// scrub position implies, `progress.ts` for how far its build has got.

import { signal, type Signal } from '@preact/signals';
import type { Manifest, DirNode } from '@/types';

// The union spans a final Manifest, a bare DirNode, and the loose skeleton the
// stream emits before it is fully typed.
export type ManifestValue = Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null;

export interface ManifestStore {
  /** What this project is, as last fetched. */
  readonly current: Signal<ManifestValue>;
  /** Set it: skeleton, final, live-update or a rollback. The fetch layer is the
   *  single writer; everything else reads. */
  set(m: ManifestValue): void;
}

export function createManifestStore(): ManifestStore {
  const current = signal<ManifestValue>(null);
  return {
    current,
    set: (m) => {
      current.value = m ?? null;
    },
  };
}
