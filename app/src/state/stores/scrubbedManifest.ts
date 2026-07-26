// The manifest reconstructed AT the scrubbed commit, for the one surface the
// union can't serve: folder rollups (counts, size, ext breakdown, date span)
// are all-time in the union, so they have to come from a real scan of that
// commit. /api/manifest?ref= already does exactly that, with the same code a
// live scan runs, so the numbers match by construction.

import { signal } from '@preact/signals';
import { manifestUrlFor, streamManifest, ScanPhase } from '@/api/manifest';
import type { Manifest } from '@/types';
import { activeExcludePathsFor } from '@/state/stores/excludes';

// Reconstruction is immutable per commit, so a visited commit is free to revisit.
const _cache = new Map<string, Manifest>();

export const SCRUBBED_MANIFEST = signal<Manifest | null>(null);
export const SCRUBBED_MANIFEST_PENDING = signal(false);

let _inflight: AbortController | null = null;

/** Point SCRUBBED_MANIFEST at `sha`, fetching only on a cache miss. */
export async function loadManifestAt(
  src: string,
  branch: string | undefined,
  sha: string
): Promise<void> {
  // Excludes reshape the tree, so they're part of the identity of what we cached.
  const exclude = activeExcludePathsFor(src);
  const key = `${src}@${sha}@${exclude.join(',')}`;
  const cached = _cache.get(key);
  if (cached) {
    SCRUBBED_MANIFEST.value = cached;
    return;
  }
  // Scrubbing past a commit shouldn't leave its scan running behind the one
  // the user actually stopped on.
  _inflight?.abort();
  const ctrl = new AbortController();
  _inflight = ctrl;
  SCRUBBED_MANIFEST_PENDING.value = true;
  try {
    for await (const ev of streamManifest(manifestUrlFor({ src, branch, ref: sha, exclude }), {
      signal: ctrl.signal,
    })) {
      if (ev.phase === ScanPhase.CompleteManifest) {
        _cache.set(key, ev.manifest);
        if (!ctrl.signal.aborted) SCRUBBED_MANIFEST.value = ev.manifest;
      }
    }
  } catch {
    // Keep the last good manifest; the pane falls back to union rollups.
  } finally {
    if (_inflight === ctrl) {
      _inflight = null;
      SCRUBBED_MANIFEST_PENDING.value = false;
    }
  }
}

export function resetScrubbedManifest(): void {
  _inflight?.abort();
  _inflight = null;
  SCRUBBED_MANIFEST.value = null;
  SCRUBBED_MANIFEST_PENDING.value = false;
}
