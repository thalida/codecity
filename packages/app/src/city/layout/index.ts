// city/layout/index.ts — main-thread façade for the layout worker: one lazily
// created Worker, a Promise-based compute(), and monotonic request ids so a
// newer call supersedes the pending ones rather than racing them. Falls back to
// synchronous in-process layout when Worker is undefined (jsdom), identically.

import { STREET_LAYOUT, STREET_TIERS } from '@/state/settings/fields/streets';
import { BUILDING_DIMENSIONS } from '@/state/settings/fields/buildings';
import { GEM_SIZING } from '@/state/settings/fields/gem';
import type { StreetLayoutConfig, StreetTier } from '@/state/settings/fields/streets';
import type { BuildingDimensionsConfig } from '@/state/settings/fields/buildings';
import type { GemSizingConfig } from '@/state/settings/fields/gem';
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
  /** Off-thread, or in-thread without a Worker; rejects 'superseded'/'disposed'.
   *  reuseLayoutFrom takes the cheap path, onProgress reports the worker's own. */
  compute(
    manifest: Manifest,
    reuseLayoutFrom?: CityLayout | null,
    onProgress?: (percent: number) => void
  ): Promise<CityLayout>;
  /** Tear down the worker and reject every pending request. */
  dispose(): void;
}

// One O(N) walk of the tree: path → FileNode, for reuseLayout's fresh refs.
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

// The cheap main-thread path: prior positions kept, per-file refs and dims
// recomputed from the new manifest. No worker, no collision detection.
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
      // After an uncaught exception the worker's state is undefined per spec:
      // drop the ref so the next compute rebuilds, and terminate the dying one.
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

    // Supersede the pending requests as the full path does, then resolve in a
    // microtask so callers always see async semantics.
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
        // ONLY what layoutCity reads: the commits array would be structured-
        // cloned on the main thread every apply (~240ms at 200k), for nothing.
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
