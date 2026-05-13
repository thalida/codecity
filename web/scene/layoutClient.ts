// scene/layoutClient.ts — main-thread façade for the layout worker.
// Owns one lazily-created module Worker; exposes a Promise-based
// `compute(manifest)` API. Generates monotonic request ids and rejects
// older pending requests when a newer one starts, so a rapid succession
// of applyManifests can never produce stale layouts.
//
// Falls back to synchronous in-process layout when `Worker` is undefined
// (jsdom test env). In the sync path the returned promise still
// participates in the supersede protocol so callers see identical
// semantics regardless of environment.

import { layoutCityV4 } from './layoutV4.js';
import {
  STREET_LAYOUT,
  BUILDING_DIMENSIONS,
  GEM_SIZING,
  STREET_TIERS,
} from '@/config/index.js';
import type { Manifest, CityLayout } from '@/types';

interface PendingRequest {
  resolve: (layout: CityLayout) => void;
  reject: (err: Error) => void;
}

interface ConfigSnapshot {
  streetLayout: ReturnType<typeof STREET_LAYOUT.get>;
  buildingDimensions: ReturnType<typeof BUILDING_DIMENSIONS.get>;
  gemSizing: ReturnType<typeof GEM_SIZING.get>;
  streetTiers: ReturnType<typeof STREET_TIERS.get>;
}

export interface LayoutClient {
  /**
   * Compute the layout off-thread (or sync if Worker is unavailable).
   * The returned promise resolves with the layout, or rejects with
   * `Error('superseded')` when a newer compute() supersedes it, or
   * `Error('disposed')` if the client is torn down before the call
   * completes, or with the worker's own error message on failure.
   */
  compute(manifest: Manifest): Promise<CityLayout>;
  /** Tear down the worker and reject every pending request. */
  dispose(): void;
}

function _snapshot(): ConfigSnapshot {
  return {
    streetLayout: STREET_LAYOUT.get(),
    buildingDimensions: BUILDING_DIMENSIONS.get(),
    gemSizing: GEM_SIZING.get(),
    streetTiers: STREET_TIERS.get(),
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
      worker = new Worker(new URL('./layoutWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (_) {
      // Older browsers without module-worker support — fall back to sync.
      worker = null;
      return null;
    }
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as
        | { type: 'layout-result'; id: number; layout: CityLayout }
        | { type: 'layout-error'; id: number; message: string };
      const entry = pending.get(data.id);
      if (!entry) return; // already superseded
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
    });
    return worker;
  }

  function _computeSync(
    id: number,
    manifest: Manifest,
    resolve: PendingRequest['resolve'],
    reject: PendingRequest['reject'],
  ): void {
    try {
      const layout = layoutCityV4(
        manifest as unknown as Parameters<typeof layoutCityV4>[0],
      );
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

  function compute(manifest: Manifest): Promise<CityLayout> {
    if (disposed) {
      return Promise.reject(new Error('layoutClient disposed'));
    }
    const id = nextId++;
    _supersedeAll();
    return new Promise<CityLayout>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const w = _ensureWorker();
      if (!w) {
        _computeSync(id, manifest, resolve, reject);
        return;
      }
      w.postMessage({
        type: 'layout',
        id,
        manifest,
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
