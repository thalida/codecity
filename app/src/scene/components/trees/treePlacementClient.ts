// scene/trees/treePlacementClient.ts — main-thread companion to
// treePlacementWorker.ts. Lazily spins up the worker on first
// compute(), sends a config snapshot + layout, returns a promise that
// resolves to TreePlacement[]. Supersedes any pending request when a
// new compute() arrives (same protocol as layoutClient). Falls back
// to a synchronous in-thread call when Worker is unavailable (older
// browsers / SSR / test environments).

import { placeTrees, type TreePlacement } from './treePlacement.js';
import { MSG } from './treePlacementProtocol.js';
import { TREES } from '@/state/settings/components/trees.js';
import { BUILDING_DIMENSIONS } from '@/state/settings/components/buildings.js';
import { FOOTPRINT } from '@/state/settings/components/footprint.js';
import { ISLAND_GEOMETRY } from '@/state/settings/components/island.js';
import { WORLD } from '@/state/settings/world/world.js';
import type { CityBbox, CityLayout } from '@/types';

interface PendingRequest {
  resolve(placements: TreePlacement[]): void;
  reject(err: Error): void;
}

interface ConfigSnapshot {
  trees: ReturnType<typeof TREES.get>;
  buildingDims: ReturnType<typeof BUILDING_DIMENSIONS.get>;
  footprint: ReturnType<typeof FOOTPRINT.get>;
  islandGeo: ReturnType<typeof ISLAND_GEOMETRY.get>;
  world: ReturnType<typeof WORLD.get>;
}

export interface TreePlacementClient {
  compute(
    layout: CityLayout,
    bbox: CityBbox | undefined,
    commitCount: number,
    cityHeight: number
  ): Promise<TreePlacement[]>;
  dispose(): void;
}

function _snapshot(): ConfigSnapshot {
  return {
    trees: TREES.get(),
    buildingDims: BUILDING_DIMENSIONS.get(),
    footprint: FOOTPRINT.get(),
    islandGeo: ISLAND_GEOMETRY.get(),
    world: WORLD.get(),
  };
}

export function createTreePlacementClient(): TreePlacementClient {
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
      worker = new Worker(new URL('./treePlacementWorker.ts', import.meta.url), { type: 'module' });
    } catch (_) {
      worker = null;
      return null;
    }
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as
        | { type: typeof MSG.RESPONSE_OK; id: number; placements: TreePlacement[] }
        | { type: typeof MSG.RESPONSE_ERROR; id: number; message: string };
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.type === MSG.RESPONSE_OK) {
        entry.resolve(data.placements);
      } else {
        entry.reject(new Error(data.message));
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      for (const entry of pending.values()) {
        entry.reject(new Error(event.message || 'tree placement worker error'));
      }
      pending.clear();
      const dying = worker;
      worker = null;
      dying?.terminate();
    });
    return worker;
  }

  function _computeSync(
    id: number,
    layout: CityLayout,
    bbox: CityBbox | undefined,
    commitCount: number,
    cityHeight: number,
    resolve: PendingRequest['resolve'],
    reject: PendingRequest['reject']
  ): void {
    try {
      const placements = placeTrees(layout, bbox, { commitCount, cityHeight });
      queueMicrotask(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve(placements);
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
    layout: CityLayout,
    bbox: CityBbox | undefined,
    commitCount: number,
    cityHeight: number
  ): Promise<TreePlacement[]> {
    if (disposed) {
      return Promise.reject(new Error('treePlacementClient disposed'));
    }
    const id = nextId++;
    _supersedeAll();
    return new Promise<TreePlacement[]>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const w = _ensureWorker();
      if (!w) {
        _computeSync(id, layout, bbox, commitCount, cityHeight, resolve, reject);
        return;
      }
      w.postMessage({
        type: MSG.REQUEST,
        id,
        layout,
        bbox,
        commitCount,
        cityHeight,
        configSnapshot: _snapshot(),
      });
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
