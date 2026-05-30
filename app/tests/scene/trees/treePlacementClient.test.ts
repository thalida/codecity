// treePlacementClient.test.ts — verifies the sync fallback when
// Worker is unavailable, the supersede protocol, and dispose behavior.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTreePlacementClient } from '@/scene/components/trees/treePlacementClient';
import type { CityLayout } from '@/types';
import { bbox, emptyLayout } from '../../_helpers/cityFixtures';

describe('treePlacementClient (sync fallback path)', () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  afterEach(() => {
    if (originalWorker) {
      (globalThis as { Worker?: unknown }).Worker = originalWorker;
    }
  });

  it('returns TreePlacement[] via the sync fallback when Worker is unavailable', async () => {
    const client = createTreePlacementClient();
    const result = await client.compute(emptyLayout(bbox(-100, -100, 100, 100)), undefined, 0, 0);
    expect(Array.isArray(result)).toBe(true);
    client.dispose();
  });

  it('rejects the prior request with "superseded" when a new compute() arrives', async () => {
    const client = createTreePlacementClient();
    const a = client.compute(emptyLayout(bbox(-100, -100, 100, 100)), undefined, 0, 0);
    const b = client.compute(emptyLayout(bbox(-200, -200, 200, 200)), undefined, 0, 0);
    await expect(a).rejects.toThrow(/superseded/);
    await expect(b).resolves.toBeTruthy();
    client.dispose();
  });

  it('rejects all pending requests after dispose()', async () => {
    const client = createTreePlacementClient();
    const p = client.compute(emptyLayout(bbox(-100, -100, 100, 100)), undefined, 0, 0);
    client.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });

  it('forwards commitCount to placeTrees', async () => {
    const client = createTreePlacementClient();
    // Bbox sized generously so the polygon-in rejection doesn't crowd
    // out the 25 candidates we expect. Previously the MIN_BUFFER=800 floor
    // padded tiny bboxes; now removed, so this test sizes its own bbox big enough.
    const layout: CityLayout = {
      buildings: [],
      streets: [],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
      bbox: {
        minX: -2000,
        minY: -2000,
        maxX: 2000,
        maxY: 2000,
        cx: 0,
        cy: 0,
        width: 4000,
        depth: 4000,
      },
    };
    const placements = await client.compute(layout, layout.bbox, 25, 0);
    expect(placements.length).toBe(25);
    client.dispose();
  });
});
