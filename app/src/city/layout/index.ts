// city/layout/index.ts — main-thread façade for the layout worker.
// Owns one lazily-created module Worker; exposes a Promise-based
// `compute(manifest, opts)` API. Generates monotonic request ids and rejects
// older pending requests when a newer one starts, so a rapid succession
// of applyManifests can never produce stale layouts.
//
// Falls back to synchronous in-process layout when `Worker` is undefined
// (jsdom test env). In the sync path the returned promise still
// participates in the supersede protocol so callers see identical
// semantics regardless of environment.
//
// When opts.reuseLayoutFrom is provided and the tree shape matches,
// compute() skips the worker entirely and returns a fresh CityLayout in
// the main thread — positions stay, per-file metadata (file refs,
// dimensions) is recomputed from the new manifest. This is the cheap
// path for skeleton→final transitions and live updates.

import { STREET_LAYOUT, STREET_TIERS } from '@/state/stores/settings/streets';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { GEM_SIZING } from '@/state/stores/settings/gem';
import type { StreetLayoutConfig, StreetTier } from '@/state/stores/settings/streets';
import type { BuildingDimensionsConfig } from '@/state/stores/settings/buildings';
import type { GemSizingConfig } from '@/state/stores/settings/gem';
import { layoutCity } from './algorithm';
import { makeHeightContext, recomputeBuildingDimensions } from './dimensions';
import type { LayoutRequest, LayoutResponse } from './protocol';
import type { Manifest, CityLayout, FileNode, TreeNode } from '@/types';

interface PendingRequest {
  resolve: (layout: CityLayout) => void;
  reject: (err: Error) => void;
  onProgress?: (percent: number) => void;
}

interface ConfigSnapshot {
  streetLayout: StreetLayoutConfig;
  buildingDimensions: BuildingDimensionsConfig;
  gemSizing: GemSizingConfig;
  streetTiers: StreetTier[];
}

export interface LayoutClient {
  /**
   * Compute the layout off-thread (or sync if Worker is unavailable).
   * The returned promise resolves with the layout, or rejects with
   * `Error('superseded')` when a newer compute() supersedes it, or
   * `Error('disposed')` if the client is torn down before the call
   * completes, or with the worker's own error message on failure.
   *
   * If `reuseLayoutFrom` is non-null, skips the worker round-trip and returns a
   * cheap in-JS layout that reuses that prior layout's positions and recomputes
   * per-file metadata from the new manifest. The caller must ensure the
   * packer's inputs are unchanged (same layout_signature).
   *
   * `onProgress` receives whole percents as the pack advances. Only the worker
   * path reports: the reuse and sync-fallback paths hold the thread for their
   * whole (much shorter) run, so nothing could render a tick from them anyway.
   */
  compute(
    manifest: Manifest,
    reuseLayoutFrom?: CityLayout | null,
    onProgress?: (percent: number) => void
  ): Promise<CityLayout>;
  /** Tear down the worker and reject every pending request. */
  dispose(): void;
}

// buildPathToFile(tree) -> Map<path, FileNode>
//
// Single O(N) walk of the manifest tree; returns a map from file path to
// its FileNode. Used by reuseLayout to look up fresh FileNode refs.
function buildPathToFile(tree: TreeNode): Map<string, FileNode> {
  const map = new Map<string, FileNode>();
  function walk(node: TreeNode): void {
    if (node.type === 'file') {
      map.set(node.path, node as FileNode);
    } else if ('children' in node && Array.isArray(node.children)) {
      for (const c of node.children as TreeNode[]) walk(c);
    }
  }
  walk(tree);
  return map;
}

// reuseLayout(prior, newManifest) -> CityLayout
//
// Cheap main-thread path: keeps all positions, streets, paths, gem, and
// sidewalks from the prior layout; recomputes per-file refs and dimensions
// (h, w, d, floors) from the new manifest's real metadata. Does NOT call
// the layout worker — skips collision detection and placement entirely.
function reuseLayout(prior: CityLayout, newManifest: Manifest): CityLayout {
  const filesByPath = buildPathToFile(newManifest.tree as unknown as TreeNode);
  const heightCtx = makeHeightContext(newManifest.stats);
  const newBuildings = prior.buildings.map((b) => {
    const freshFile = (b.file?.path ? filesByPath.get(b.file.path) : null) ?? b.file;
    const dims = recomputeBuildingDimensions(
      freshFile as unknown as Parameters<typeof recomputeBuildingDimensions>[0],
      heightCtx
    );
    return {
      ...b,
      file: freshFile,
      w: dims.w,
      d: dims.d,
      h: dims.h,
      floors: dims.floors,
    };
  });
  return {
    ...prior,
    buildings: newBuildings,
    // streets, paths, gem, sidewalks, bbox stay the same
  };
}

function _snapshot(): ConfigSnapshot {
  return {
    streetLayout: STREET_LAYOUT.value,
    buildingDimensions: BUILDING_DIMENSIONS.value,
    gemSizing: GEM_SIZING.value,
    streetTiers: STREET_TIERS.value.TIERS,
  };
}

export function createLayoutClient(): LayoutClient {
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let disposed = false;
  let worker: Worker | null = null;

  function _supersedeAll(): void {
    if (pending.size === 0) return;
    for (const entry of pending.values()) {
      entry.reject(new Error('superseded'));
    }
    pending.clear();
  }

  function _ensureWorker(): Worker | null {
    if (worker) return worker;
    if (typeof Worker === 'undefined') return null;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (_) {
      // Older browsers without module-worker support — fall back to sync.
      worker = null;
      return null;
    }
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as LayoutResponse;
      const entry = pending.get(data.id);
      if (!entry) return; // already superseded
      if (data.type === 'layout-progress') {
        entry.onProgress?.(data.percent);
        return; // the request is still running
      }
      pending.delete(data.id);
      if (data.type === 'layout-result') {
        entry.resolve(data.layout);
      } else {
        entry.reject(new Error(data.message));
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      // Reject every pending request — we don't know which one died.
      for (const entry of pending.values()) {
        entry.reject(new Error(event.message || 'layout worker error'));
      }
      pending.clear();
      // After an uncaught exception, the worker's state is undefined
      // per spec — posting further messages to it is unreliable. Null
      // the cached ref so the next compute() reconstructs a fresh
      // worker on demand, and terminate the dying instance so the
      // browser frees its thread + memory promptly (browsers don't
      // always auto-terminate after onerror).
      const dying = worker;
      worker = null;
      dying?.terminate();
    });
    return worker;
  }

  function _computeSync(
    id: number,
    manifest: Manifest,
    resolve: PendingRequest['resolve'],
    reject: PendingRequest['reject']
  ): void {
    try {
      const layout = layoutCity(manifest as unknown as Parameters<typeof layoutCity>[0]);
      queueMicrotask(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve(layout);
      });
    } catch (err) {
      queueMicrotask(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  function compute(
    manifest: Manifest,
    reuseLayoutFrom: CityLayout | null = null,
    onProgress?: (percent: number) => void
  ): Promise<CityLayout> {
    if (disposed) {
      return Promise.reject(new Error('layoutClient disposed'));
    }

    // Cheap in-JS reuse path: caller has confirmed tree shape matches.
    // Supersede any pending requests (same protocol as the full path) then
    // return a microtask-resolved promise so callers always see async semantics.
    if (reuseLayoutFrom) {
      const id = nextId++;
      _supersedeAll();
      return new Promise<CityLayout>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        queueMicrotask(() => {
          if (!pending.has(id)) return; // superseded
          pending.delete(id);
          try {
            resolve(reuseLayout(reuseLayoutFrom, manifest));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });
    }

    const id = nextId++;
    _supersedeAll();
    return new Promise<CityLayout>((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      const w = _ensureWorker();
      if (!w) {
        _computeSync(id, manifest, resolve, reject);
        return;
      }
      const request: LayoutRequest = {
        type: 'layout',
        id,
        // Send ONLY what layoutCity reads (tree + stats). The full manifest
        // carries the commits array (100k–1M entries at Linux scale), which
        // postMessage would structured-clone on the main thread every apply —
        // ~240ms at 200k commits vs ~65ms for this slice, all wasted.
        manifest: { tree: manifest.tree, stats: manifest.stats },
        configSnapshot: _snapshot(),
      };
      w.postMessage(request);
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const entry of pending.values()) {
      entry.reject(new Error('disposed'));
    }
    pending.clear();
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  return { compute, dispose };
}
