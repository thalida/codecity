// One of four answers to "which tree does this surface show":
//   manifest         HEAD, the project you opened            (fetched)
//   scrubbedManifest a real scan AT the scrubbed commit      (fetched)
//   presentPaths     the paths alive at that commit          (derived)
//   paneManifest     what the tree and search show           (derived)
//
// The manifest reconstructed AT the scrubbed commit, for the one surface the
// union can't serve: folder rollups (counts, size, ext breakdown, date span)
// are all-time in the union, so they have to come from a real scan of that
// commit. /api/manifest?ref= already does exactly that, with the same code a
// live scan runs, so the numbers match by construction.

import { signal } from '@preact/signals';
import { manifestUrlFor, streamManifest, ScanPhase } from '@/api/manifest';
import type { Manifest } from '@/types';
import { activeExcludePathsFor } from '@/state/stores/excludes';

// Immutable per commit, so revisits are free. Bounded: an entry is a whole repo
// tree. Insertion order is recency; the oldest key is first.
const _cache = new Map<string, Manifest>();
const _CACHE_MAX = 16;

function cacheGet(key: string): Manifest | undefined {
  const hit = _cache.get(key);
  if (hit) {
    _cache.delete(key);
    _cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, manifest: Manifest): void {
  _cache.delete(key);
  _cache.set(key, manifest);
  while (_cache.size > _CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest === undefined) break;
    _cache.delete(oldest);
  }
}

/** Test-only: drop every cached reconstruction. */
export function _clearScrubbedManifestCache(): void {
  _cache.clear();
}

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
  const cached = cacheGet(key);
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
        cacheSet(key, ev.manifest);
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
