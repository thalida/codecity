// treePlacement.test.ts — verifies commit-driven tree placement.

import { describe, it, expect, beforeEach } from 'vitest';
import { placeTrees, type TreePlacement } from '@/city/components/trees/treePlacement';
import { TREES } from '@/state/stores/settings/trees';
import type { CityLayout } from '@/types';
import {
  bbox,
  emptyLayout,
  resetTreesConfig,
  resetBuildingsConfig,
} from '../../../_helpers/cityFixtures';
import { building } from '../../../_helpers/buildingFixture';

describe('placeTrees (commit-driven)', () => {
  beforeEach(() => {
    resetTreesConfig();
    resetBuildingsConfig();
  });

  it('returns empty when ENABLED is false', () => {
    TREES.value = { ...TREES.value, ENABLED: false };
    expect(
      placeTrees(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 10 })
    ).toEqual([]);
  });

  it('returns empty when bbox is missing', () => {
    const layout: CityLayout = {
      buildings: [],
      streets: [],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
    };
    expect(placeTrees(layout, undefined, { commitCount: 10 })).toEqual([]);
  });

  it('returns empty when commitCount is 0', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    expect(placeTrees(layout, layout.bbox, { commitCount: 0 })).toEqual([]);
  });

  it('emits exactly commitCount tree placements', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeTrees(layout, layout.bbox, { commitCount: 50 });
    expect(placements.length).toBe(50);
  });

  it('places a tree for every commit even on a tiny, city-covered island', () => {
    // A 2- or 3-commit repo: the candidate grid is floored (TREE_MIN_CELLS) so
    // enough positions survive rejection to place ALL commits' trees. Without the
    // floor a handful of cells collide with the centered building and accepted
    // falls below the commit count, silently dropping HEAD's tree.
    const bb = bbox(-40, -40, 40, 40);
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [building({ x: 0, y: 0, w: 40, d: 40, h: 10 })],
    };
    for (const commitCount of [1, 2, 3]) {
      const placements = placeTrees(layout, bb, { commitCount });
      expect(placements.length).toBe(commitCount);
      // Each commit index appears exactly once.
      expect(new Set(placements.map((p) => p.commitIndex)).size).toBe(commitCount);
    }
  });

  it('tree placements are sorted by distance from gem (closest first)', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeTrees(layout, layout.bbox, { commitCount: 100 });
    const gem = { x: 0, y: 0 };
    const d2 = (p: TreePlacement) => (p.x - gem.x) ** 2 + (p.y - gem.y) ** 2;
    for (let i = 1; i < placements.length; i++) {
      expect(d2(placements[i])).toBeGreaterThanOrEqual(d2(placements[i - 1]));
    }
  });

  it('assigns commitIndex 0..N-1 in distance order', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeTrees(layout, layout.bbox, { commitCount: 20 });
    placements.forEach((t, i) => {
      expect(t.commitIndex).toBe(i);
    });
  });

  it('is deterministic — same layout → identical placements', () => {
    const a = placeTrees(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 30 });
    const b = placeTrees(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 30 });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].y).toBe(b[i].y);
      expect(a[i].seed).toBe(b[i].seed);
      expect(a[i].commitIndex).toBe(b[i].commitIndex);
    }
  });

  it('rejects tree candidates that overlap a building', () => {
    const bb = bbox(-500, -500, 500, 500);
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [building({ x: 0, y: 0, w: 400, d: 400, h: 10 })],
    };
    const placements = placeTrees(layout, bb, { commitCount: 50 });
    for (const p of placements) {
      const inside = p.x > -200 && p.x < 200 && p.y > -200 && p.y < 200;
      expect(inside).toBe(false);
    }
  });

  it('rejects candidates inside the FOOTPRINT halo around a layout rect', async () => {
    const { FOOTPRINT } = await import('@/state/stores/settings/footprint.js');
    FOOTPRINT.value = { ...FOOTPRINT.value, HALO_WIDTH: 100 };

    const bb = bbox(-500, -500, 500, 500);
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [
        {
          x: 0,
          y: 0,
          w: 20,
          d: 20,
          h: 32,
          floors: 2,
          file: { path: 'a.ts', size: 0, lines: 0 },
        } as never,
      ],
    };

    const placements = placeTrees(layout, bb, { commitCount: 30 });

    for (const p of placements) {
      const dInf = Math.max(Math.abs(p.x), Math.abs(p.y));
      expect(dInf).toBeGreaterThan(110);
    }

    FOOTPRINT.value = { ...FOOTPRINT.value, HALO_WIDTH: 32 };
  });

  it('all placements have a defined commitIndex', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeTrees(layout, layout.bbox, { commitCount: 20 });
    for (const p of placements) {
      expect(p.commitIndex).toBeDefined();
    }
  });
});

export type { TreePlacement };
