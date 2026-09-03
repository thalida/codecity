// city/components/trees/treePlacementClient.ts — the main-thread end: spins the
// worker up on first compute, supersedes a pending request when a new one
// arrives, and falls back to a synchronous call where Worker is unavailable.
import {
  placeTrees,
  type TreePlacement,
  type TreePlacementConfig,
  type LayoutGeometry,
} from './treePlacement';
import { MSG } from './treePlacementProtocol';
import type { CityBbox, CityLayout } from '../../types/scene';

interface PendingRequest {
  resolve(placements: TreePlacement[]): void;
  reject(err: Error): void;
}

export interface TreePlacementClient {
  compute(
    layout: CityLayout,
    bbox: CityBbox | undefined,
    commitCount: number,
    cityHeight: number,
    settings: TreePlacementConfig
  ): Promise<TreePlacement[]>;
  dispose(): void;
}

// Strip to geometry: every rect carries a file/dir payload that structured
// clone would copy. bbox rides along so the sync and worker paths agree.
function _slimLayout(layout: CityLayout): LayoutGeometry {
  return {
    streets: layout.streets.map((s) => ({
      x: s.x,
      y: s.y,
      length: s.length,
      width: s.width,
      orientation: s.orientation,
      isRoot: s.isRoot,
    })),
    buildings: layout.buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d })),
    bbox: layout.bbox,
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
    settings: TreePlacementConfig,
    resolve: PendingRequest['resolve'],
    reject: PendingRequest['reject']
  ): void {
    try {
      const placements = placeTrees(layout, bbox, { commitCount, cityHeight, settings });
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
    cityHeight: number,
    settings: TreePlacementConfig
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
        _computeSync(id, layout, bbox, commitCount, cityHeight, settings, resolve, reject);
        return;
      }
      w.postMessage({
        type: MSG.REQUEST,
        id,
        layout: _slimLayout(layout),
        bbox,
        commitCount,
        cityHeight,
        settings,
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
