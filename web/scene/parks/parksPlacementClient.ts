// scene/parks/parksPlacementClient.ts — main-thread companion to
// parksPlacementWorker.ts. Lazily spins up the worker on first
// compute(), sends a config snapshot + layout, returns a promise that
// resolves to ParkPlacement[]. Supersedes any pending request when a
// new compute() arrives (same protocol as layoutClient). Falls back
// to a synchronous in-thread call when Worker is unavailable (older
// browsers / SSR / test environments).

import { placeParks, type ParkPlacement } from './parksPlacement.js';
import { PARKS, PARKS_PALETTE } from '@/config/parks.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';
import { FOOTPRINT } from '@/config/footprint.js';
import type { CityBbox, CityLayout } from '@/types';

interface PendingRequest {
  resolve(placements: ParkPlacement[]): void;
  reject(err: Error): void;
}

interface ConfigSnapshot {
  parks: ReturnType<typeof PARKS.get>;
  parksPalette: ReturnType<typeof PARKS_PALETTE.get>;
  buildingDims: ReturnType<typeof BUILDING_DIMENSIONS.get>;
  cameraPerspective: ReturnType<typeof CAMERA_PERSPECTIVE.get>;
  footprint: ReturnType<typeof FOOTPRINT.get>;
}

export interface ParksPlacementClient {
  compute(
    layout: CityLayout,
    bbox: CityBbox | undefined,
    commitCount: number,
  ): Promise<ParkPlacement[]>;
  dispose(): void;
}

function _snapshot(): ConfigSnapshot {
  return {
    parks: PARKS.get(),
    parksPalette: PARKS_PALETTE.get(),
    buildingDims: BUILDING_DIMENSIONS.get(),
    cameraPerspective: CAMERA_PERSPECTIVE.get(),
    footprint: FOOTPRINT.get(),
  };
}

export function createParksPlacementClient(): ParksPlacementClient {
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
      worker = new Worker(
        new URL('./parksPlacementWorker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch (_) {
      // Older browsers without module-worker support — fall back to sync.
      worker = null;
      return null;
    }
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as
        | { type: 'place-result'; id: number; placements: ParkPlacement[] }
        | { type: 'place-error'; id: number; message: string };
      const entry = pending.get(data.id);
      if (!entry) return; // superseded
      pending.delete(data.id);
      if (data.type === 'place-result') {
        entry.resolve(data.placements);
      } else {
        entry.reject(new Error(data.message));
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      for (const entry of pending.values()) {
        entry.reject(new Error(event.message || 'parks placement worker error'));
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
    resolve: PendingRequest['resolve'],
    reject: PendingRequest['reject'],
  ): void {
    try {
      const placements = placeParks(layout, bbox, { commitCount });
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
  ): Promise<ParkPlacement[]> {
    if (disposed) {
      return Promise.reject(new Error('parksPlacementClient disposed'));
    }
    const id = nextId++;
    _supersedeAll();
    return new Promise<ParkPlacement[]>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const w = _ensureWorker();
      if (!w) {
        _computeSync(id, layout, bbox, commitCount, resolve, reject);
        return;
      }
      w.postMessage({
        type: 'place',
        id,
        layout,
        bbox,
        commitCount,
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
