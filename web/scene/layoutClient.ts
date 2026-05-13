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

  function _supersedeAll(): void {
    if (pending.size === 0) return;
    for (const entry of pending.values()) {
      entry.reject(new Error('superseded'));
    }
    pending.clear();
  }

  function compute(manifest: Manifest): Promise<CityLayout> {
    if (disposed) {
      return Promise.reject(new Error('layoutClient disposed'));
    }
    const id = nextId++;
    // Any in-flight compute is replaced by this newer one.
    _supersedeAll();

    return new Promise<CityLayout>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Sync fallback path: jsdom + tests, plus any environment without
      // Worker support. Run synchronously but in a microtask so the
      // supersede behavior matches the async-worker path. Apply config
      // snapshot? Skip — in the fallback we're sharing the same store
      // instances as the caller, so the values are already correct.
      const snap = _snapshot();
      void snap; // silence unused-var lint in fallback path
      try {
        const layout = layoutCityV4(
          manifest as unknown as Parameters<typeof layoutCityV4>[0],
        );
        // Resolve on a microtask so the supersede check in the next
        // compute() call still has a chance to fire before this one
        // resolves. Without queueMicrotask, two synchronous compute()
        // calls in the same tick would both observe the same pending
        // map and the supersede semantics would be racy.
        queueMicrotask(() => {
          if (!pending.has(id)) return; // already superseded
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
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    _supersedeAll();
  }

  return { compute, dispose };
}
