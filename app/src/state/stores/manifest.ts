// state/stores/manifest.ts — the manifest of the project you opened, at HEAD.
// The one the fetch layer writes and everything else reads. Two neighbours
// answer the same question differently: `scrub.ts` for what a Timeline position
// implies, `progress.ts` for how far the world built from this has got.

import { signal } from '@preact/signals';
import type { Manifest, DirNode } from '@/types';

// The union spans a final Manifest, a bare DirNode, and the loose skeleton the
// stream emits before it is fully typed.
export type ManifestValue = Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null;

export const MANIFEST = signal<ManifestValue>(null);

/** Set the current manifest: skeleton, final, live-update or a rollback. The
 *  fetch layer is the single writer; everything else reads MANIFEST. */
export function setManifest(m: ManifestValue): void {
  MANIFEST.value = m ?? null;
}
