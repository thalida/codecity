// treePlacementClient.test.ts — verifies the sync fallback when
// Worker is unavailable, the supersede protocol, and dispose behavior.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTreePlacementClient } from '../../../src/components/trees/treePlacementClient';
import { bbox, emptyLayout } from '../../_helpers/cityFixtures';
import type { CityLayout } from '../../../src/types/scene';
import { treeCfg } from '../../_helpers/citySettings';
const TREE_CFG = treeCfg();

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

  it('falls back to the sync path when Worker is unavailable', async () => {
    const client = createTreePlacementClient();
    const result = await client.compute(
      emptyLayout(bbox(-100, -100, 100, 100)),
      undefined,
      0,
      0,
      TREE_CFG
    );
    expect(result).toEqual([]);
    client.dispose();
  });

  it('rejects the prior request with "superseded" when a new compute( TREE_CFG) arrives', async () => {
    const client = createTreePlacementClient();
    const a = client.compute(emptyLayout(bbox(-100, -100, 100, 100)), undefined, 0, 0, TREE_CFG);
    const b = client.compute(emptyLayout(bbox(-200, -200, 200, 200)), undefined, 0, 0, TREE_CFG);
    await expect(a).rejects.toThrow(/superseded/);
    await expect(b).resolves.toBeTruthy();
    client.dispose();
  });

  it('rejects all pending requests after dispose()', async () => {
    const client = createTreePlacementClient();
    const p = client.compute(emptyLayout(bbox(-100, -100, 100, 100)), undefined, 0, 0, TREE_CFG);
    client.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });

  it('forwards commitCount to placeTrees', async () => {
    const client = createTreePlacementClient();
    // Bbox sized generously so the polygon-in rejection doesn't crowd out the
    // 25 candidates we expect. Nothing pads a tiny bbox on our behalf.
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
    const placements = await client.compute(layout, layout.bbox, 25, 0, TREE_CFG);
    expect(placements.length).toBe(25);
    client.dispose();
  });
});
