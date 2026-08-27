// treePlacement.test.ts — verifies commit-driven tree placement.

import { describe, it, expect, beforeEach } from 'vitest';
import { placeTrees, type TreePlacement } from '@/city/components/trees/treePlacement';
import type { CitySettingsPatch } from '@/city/settings';
import { treeCfg } from '../../../_helpers/citySettings';
import { bbox, emptyLayout, TEST_TREES } from '../../../_helpers/cityFixtures';
import { building } from '../../../_helpers/buildingFixture';
import type { CityLayout } from '@/city/types/scene';

describe('placeTrees (commit-driven)', () => {
  // The settings this test is currently placing under. Reset per case, then
  // narrowed by tune() where a case is about one particular knob.
  let over: CitySettingsPatch;

  beforeEach(() => {
    over = { TREES: TEST_TREES, WORLD: { GROUND_BUFFER_PERCENT: 0 } };
  });

  /** Narrow the settings for this case. Merges, so an earlier tune() stands. */
  function tune(patch: CitySettingsPatch): void {
    over = {
      ...over,
      ...Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [
          k,
          { ...(over[k as keyof CitySettingsPatch] as object), ...v },
        ])
      ),
    };
  }

  /** placeTrees options at whatever tune() has left the settings. */
  function opts(commitCount: number) {
    return { commitCount, settings: treeCfg(over) };
  }

  it('returns empty when ENABLED is false', () => {
    tune({ TREES: { ENABLED: false } });
    expect(placeTrees(emptyLayout(bbox(-100, -100, 100, 100)), undefined, opts(10))).toEqual([]);
  });

  it('returns empty when bbox is missing', () => {
    const layout: CityLayout = {
      buildings: [],
      streets: [],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
    };
    expect(placeTrees(layout, undefined, opts(10))).toEqual([]);
  });

  it('returns empty when commitCount is 0', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    expect(placeTrees(layout, layout.bbox, opts(0))).toEqual([]);
  });

  it('emits exactly commitCount tree placements', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeTrees(layout, layout.bbox, opts(50));
    expect(placements.length).toBe(50);
  });

  it('places a tree for every commit even on a tiny, city-covered island', () => {
    // The candidate grid is floored (TREE_MIN_CELLS) so enough positions survive
    // rejection; without it the centered building eats HEAD's tree.
    const bb = bbox(-40, -40, 40, 40);
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [building({ x: 0, y: 0, w: 40, d: 40, h: 10 })],
    };
    for (const commitCount of [1, 2, 3]) {
      const placements = placeTrees(layout, bb, opts(commitCount));
      expect(placements.length).toBe(commitCount);
      // Each commit index appears exactly once.
      expect(new Set(placements.map((p) => p.commitIndex)).size).toBe(commitCount);
    }
  });

  it('still places every commit at the maximum density falloff', () => {
    // At the top of the range falloff rejects nearly everything, so the thinned
    // positions are kept as spares and topped up to reach the commit count.
    tune({ WORLD: { GROUND_BUFFER_PERCENT: 100 } });
    tune({ TREES: { DENSITY_FALLOFF: 50 } });
    const bb = bbox(-40, -40, 40, 40);
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [building({ x: 0, y: 0, w: 40, d: 40, h: 10 })],
    };
    const placements = placeTrees(layout, bb, opts(200));
    expect(placements.length).toBe(200);
    expect(new Set(placements.map((p) => p.commitIndex)).size).toBe(200);
  });

  it('tree placements are sorted by distance from gem (closest first)', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeTrees(layout, layout.bbox, opts(100));
    const gem = { x: 0, y: 0 };
    const d2 = (p: TreePlacement) => (p.x - gem.x) ** 2 + (p.y - gem.y) ** 2;
    for (let i = 1; i < placements.length; i++) {
      expect(d2(placements[i])).toBeGreaterThanOrEqual(d2(placements[i - 1]));
    }
  });

  it('assigns commitIndex 0..N-1 in distance order', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeTrees(layout, layout.bbox, opts(20));
    placements.forEach((t, i) => {
      expect(t.commitIndex).toBe(i);
    });
  });

  it('is deterministic — same layout → identical placements', () => {
    const a = placeTrees(emptyLayout(bbox(-100, -100, 100, 100)), undefined, opts(30));
    const b = placeTrees(emptyLayout(bbox(-100, -100, 100, 100)), undefined, opts(30));
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
    const placements = placeTrees(layout, bb, opts(50));
    for (const p of placements) {
      const inside = p.x > -200 && p.x < 200 && p.y > -200 && p.y < 200;
      expect(inside).toBe(false);
    }
  });

  it('rejects candidates inside the FOOTPRINT halo around a layout rect', () => {
    tune({ FOOTPRINT: { HALO_WIDTH: 100 } });

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

    const placements = placeTrees(layout, bb, opts(30));

    for (const p of placements) {
      const dInf = Math.max(Math.abs(p.x), Math.abs(p.y));
      expect(dInf).toBeGreaterThan(110);
    }
  });

  describe('city clearance limits', () => {
    // A 400x400 block at the origin, so a placement's gap is its Chebyshev
    // distance from the origin minus the half-extent, as rbush measures it.
    const HALF_BLOCK = 200;
    const cityBlock = (bb: ReturnType<typeof bbox>): CityLayout => ({
      ...emptyLayout(bb),
      buildings: [building({ x: 0, y: 0, w: HALF_BLOCK * 2, d: HALF_BLOCK * 2, h: 10 })],
    });
    const narrowestGap = (placements: TreePlacement[]): number =>
      Math.min(...placements.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)) - HALF_BLOCK));

    beforeEach(() => {
      tune({ FOOTPRINT: { HALO_WIDTH: 0 } });
    });

    it('caps the gap on a big island, where a small percentage clears a lot of ground', () => {
      const bb = bbox(-10_000, -10_000, 10_000, 10_000);
      const layout = cityBlock(bb);
      tune({ TREES: { CITY_CLEARANCE_PERCENT: 10 } });

      tune({ TREES: { CITY_CLEARANCE_LIMITS: [0, 2000] } });
      const unclamped = narrowestGap(placeTrees(layout, bb, opts(400)));

      tune({ TREES: { CITY_CLEARANCE_LIMITS: [0, 300] } });
      const clamped = narrowestGap(placeTrees(layout, bb, opts(400)));

      expect(clamped).toBeGreaterThanOrEqual(300);
      expect(clamped).toBeLessThan(unclamped);
    });

    it('floors the gap on a small island, where the percentage barely clears anything', () => {
      const bb = bbox(-600, -600, 600, 600);
      const layout = cityBlock(bb);
      tune({ TREES: { CITY_CLEARANCE_PERCENT: 1 } });

      tune({ TREES: { CITY_CLEARANCE_LIMITS: [0, 2000] } });
      const unfloored = narrowestGap(placeTrees(layout, bb, opts(200)));

      tune({ TREES: { CITY_CLEARANCE_LIMITS: [80, 2000] } });
      const floored = narrowestGap(placeTrees(layout, bb, opts(200)));

      expect(floored).toBeGreaterThanOrEqual(80);
      expect(floored).toBeGreaterThan(unfloored);
    });
  });

  describe('island edge inset limits', () => {
    // The inset is radial, so how far out the forest reaches is the widest
    // distance any placement sits from the island center.
    const outermost = (placements: TreePlacement[]): number =>
      Math.max(...placements.map((p) => Math.hypot(p.x, p.y)));

    const forest = (percent: number, limits: [number, number]): TreePlacement[] => {
      const bb = bbox(-5000, -5000, 5000, 5000);
      tune({ TREES: { EDGE_INSET_PERCENT: percent, EDGE_INSET_LIMITS: limits } });
      return placeTrees(emptyLayout(bb), bb, opts(600));
    };

    it('caps the inset, so a big island keeps its trees out at the rim', () => {
      const unclamped = outermost(forest(20, [0, 2000]));
      const clamped = outermost(forest(20, [0, 200]));
      expect(clamped).toBeGreaterThan(unclamped);
    });

    it('floors the inset, so trees stop short of the edge on any island', () => {
      const unfloored = outermost(forest(0, [0, 2000]));
      const floored = outermost(forest(0, [800, 2000]));
      // Short of the full 800: the candidate grid is discrete, so the outermost
      // survivor sits inside the rim rather than on it.
      expect(unfloored - floored).toBeGreaterThan(600);
    });
  });
});

export type { TreePlacement };
