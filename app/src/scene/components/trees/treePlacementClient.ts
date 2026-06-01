// scene/trees/treePlacementClient.ts — main-thread companion to
// treePlacementWorker.ts. Lazily spins up the worker on first
// compute(), sends a config snapshot + layout, returns a promise that
// resolves to TreePlacement[]. Supersedes any pending request when a
// new compute() arrives (same protocol as layoutClient). Falls back
// to a synchronous in-thread call when Worker is unavailable (older
// browsers / SSR / test environments).

import { placeTrees, type TreePlacement } from './treePlacement';
import { MSG } from './treePlacementProtocol';
import { TREES, type TreesConfig } from '@/state/stores/settings/trees';
import { BUILDING_DIMENSIONS, type BuildingDimensionsConfig } from '@/state/stores/settings/buildings';
import { FOOTPRINT, type FootprintConfig } from '@/state/stores/settings/footprint';
import { ISLAND, type IslandConfig } from '@/state/stores/settings/island';
import { WORLD, type WorldConfig } from '@/state/stores/settings/scene';
import type { CityBbox, CityLayout } from '@/types';

interface PendingRequest {
  resolve(placements: TreePlacement[]): void;
  reject(err: Error): void;
}

interface ConfigSnapshot {
  trees: TreesConfig;
  buildingDims: BuildingDimensionsConfig;
  footprint: FootprintConfig;
  islandGeo: IslandConfig;
  world: WorldConfig;
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
    trees: TREES.value,
    buildingDims: BUILDING_DIMENSIONS.value,
    footprint: FOOTPRINT.value,
    islandGeo: ISLAND.value,
    world: WORLD.value,
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
