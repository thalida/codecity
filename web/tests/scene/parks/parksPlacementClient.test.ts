// parksPlacementClient.test.ts — verifies the sync fallback when
// Worker is unavailable, the supersede protocol, and dispose behavior.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createParksPlacementClient } from '@/scene/parks/parksPlacementClient.js';
import type { CityBbox, CityLayout } from '@/types';

function bbox(minX: number, minY: number, maxX: number, maxY: number): CityBbox {
  return {
    minX, minY, maxX, maxY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    width: maxX - minX, depth: maxY - minY,
  };
}

function emptyLayout(bb: CityBbox): CityLayout {
  return {
    buildings: [], streets: [], paths: [],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: bb,
  };
}

describe('parksPlacementClient (sync fallback path)', () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    // Force the sync fallback by removing Worker.
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  afterEach(() => {
    if (originalWorker) {
      (globalThis as { Worker?: unknown }).Worker = originalWorker;
    }
  });

  it('returns ParkPlacement[] via the sync fallback when Worker is unavailable', async () => {
    const client = createParksPlacementClient();
    const result = await client.compute(emptyLayout(bbox(-100, -100, 100, 100)), undefined);
    expect(Array.isArray(result)).toBe(true);
    client.dispose();
  });

  it('rejects the prior request with "superseded" when a new compute() arrives', async () => {
    const client = createParksPlacementClient();
    const a = client.compute(emptyLayout(bbox(-100, -100, 100, 100)), undefined);
    const b = client.compute(emptyLayout(bbox(-200, -200, 200, 200)), undefined);
    await expect(a).rejects.toThrow(/superseded/);
    await expect(b).resolves.toBeTruthy();
    client.dispose();
  });

  it('rejects all pending requests after dispose()', async () => {
    const client = createParksPlacementClient();
    const p = client.compute(emptyLayout(bbox(-100, -100, 100, 100)), undefined);
    client.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });
});
