// parksPlacement.test.ts — verifies commit-driven tree placement
// and decorative bush/flower scatter.

import { describe, it, expect, beforeEach } from 'vitest';
import { placeParks, type ParkPlacement } from '@/scene/parks/parksPlacement.js';
import { PARKS, PARKS_PALETTE } from '@/config/parks.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import type { CityBbox, CityLayout } from '@/types';

function resetParks() {
  PARKS.set({
    ENABLED: true,
    DENSITY_PERCENT: 100,
    CITY_DENSITY_PERCENT: 100, // uniform by default in tests
    GRADIENT_REACH_PERCENT: 40,
    MIX_TREE_FRAC: 0.65,
    MIX_BUSH_FRAC: 0.25,
    MIX_FLOWER_FRAC: 0.10,
    SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
    TREE_HEIGHT_FLOORS: 6,
    TREE_RADIUS_FRAC_OF_HEIGHT: 0.3,
    BUSH_RADIUS_FRAC_OF_TREE: 0.4,
    FLOWER_SIZE_FRAC_OF_TREE: 0.08,
    FLOWERS_PER_BUSH: 4,
    FLOWERS_PER_CLUSTER: 8,
    EDGE_INSET_PERCENT: 8,
  });
}

function resetBuildings() {
  BUILDING_DIMENSIONS.set({
    MIN_FLOORS: 2,
    MAX_FLOORS: 96,
    FLOOR_HEIGHT: 16,
    MIN_WIDTH: 8,
    MAX_WIDTH: 8,
    PATH_LENGTH: 8,
    PATH_WIDTH_FRAC: 0.5,
  });
}

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

describe('placeParks (commit-driven trees + decorative bushes/flowers)', () => {
  beforeEach(() => {
    resetParks();
    resetBuildings();
    PARKS_PALETTE.setKey('BUSHES_ENABLED', true);
    PARKS_PALETTE.setKey('FLOWERS_ENABLED', true);
    PARKS_PALETTE.setKey('TREES_ENABLED', true);
  });

  // ── Core guard tests ──────────────────────────────────────────────

  it('returns empty when master ENABLED is false', () => {
    PARKS.setKey('ENABLED', false);
    expect(placeParks(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 10 })).toEqual([]);
  });

  it('returns no plots when bbox is missing', () => {
    const layout: CityLayout = {
      buildings: [], streets: [], paths: [],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
    };
    expect(placeParks(layout, undefined, { commitCount: 10 })).toEqual([]);
  });

  // ── Commit-driven tree tests ──────────────────────────────────────

  it('emits exactly commitCount tree placements (one per commit)', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeParks(layout, layout.bbox, { commitCount: 50 });
    const trees = placements.filter((p) => p.treeCount > 0);
    expect(trees.length).toBe(50);
  });

  it('tree placements are sorted by distance from gem (closest first)', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeParks(layout, layout.bbox, { commitCount: 100 });
    const trees = placements.filter((p) => p.treeCount > 0);
    const gem = { x: 0, y: 0 }; // empty layout falls back to bbox center
    const d2 = (p: ParkPlacement) =>
      (p.x - gem.x) ** 2 + (p.y - gem.y) ** 2;
    for (let i = 1; i < trees.length; i++) {
      expect(d2(trees[i])).toBeGreaterThanOrEqual(d2(trees[i - 1]));
    }
  });

  it('assigns commitIndex 0..N-1 in distance order', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeParks(layout, layout.bbox, { commitCount: 20 });
    const trees = placements.filter((p) => p.treeCount > 0);
    trees.forEach((t, i) => {
      expect(t.commitIndex).toBe(i);
    });
  });

  it('emits zero tree placements when commitCount is 0', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeParks(layout, layout.bbox, { commitCount: 0 });
    expect(placements.filter((p) => p.treeCount > 0).length).toBe(0);
  });

  it('is deterministic — same layout → identical placements', () => {
    const a = placeParks(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 30 });
    const b = placeParks(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 30 });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].y).toBe(b[i].y);
      expect(a[i].seed).toBe(b[i].seed);
      expect(a[i].kind).toBe(b[i].kind);
    }
  });

  it('assigns a kind to every placement (tree / bush / flower-cluster)', () => {
    const placements = placeParks(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 30 });
    for (const p of placements) {
      expect(['tree', 'bush', 'flower-cluster']).toContain(p.kind);
    }
  });

  it('counts are driven by kind (tree:1, bush:1+flowers, cluster:flowers only)', () => {
    const placements = placeParks(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 30 });
    for (const p of placements) {
      if (p.kind === 'tree') {
        expect(p.treeCount).toBe(1);
        expect(p.bushCount).toBe(0);
        expect(p.flowerCount).toBe(0);
      } else if (p.kind === 'bush') {
        expect(p.treeCount).toBe(0);
        expect(p.bushCount).toBe(1);
        expect(p.flowerCount).toBe(4);
      } else if (p.kind === 'flower-cluster') {
        expect(p.treeCount).toBe(0);
        expect(p.bushCount).toBe(0);
        expect(p.flowerCount).toBe(8);
      }
    }
  });

  it('rejects tree candidates that overlap a building', () => {
    const bb = bbox(-500, -500, 500, 500);
    function makeBuilding(x: number, y: number, w: number, d: number) {
      return {
        x, y, w, d, h: 10, color: '#000',
        file: { path: '', name: '', size: 0, lines: 0, modified: 0, created: 0 } as never,
        orient: 'n' as never,
      } as never;
    }
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [makeBuilding(0, 0, 400, 400)],
    };
    const placements = placeParks(layout, bb, { commitCount: 50 });
    const trees = placements.filter((p) => p.treeCount > 0);
    // No tree should be inside the building footprint (-200..200)
    for (const p of trees) {
      const inside = p.x > -200 && p.x < 200 && p.y > -200 && p.y < 200;
      expect(inside).toBe(false);
    }
  });

  it('rejects candidates inside the FOOTPRINT halo around a layout rect', async () => {
    const { FOOTPRINT } = await import('@/config/footprint.js');
    FOOTPRINT.setKey('HALO_WIDTH', 100);
    PARKS.setKey('GRADIENT_REACH_PERCENT', 0); // disable gradient to isolate overlap

    const bb = bbox(-500, -500, 500, 500);
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [
        { x: 0, y: 0, w: 20, d: 20, h: 32, floors: 2, file: { path: 'a.ts', size: 0, lines: 0 } } as never,
      ],
    };

    const placements: ParkPlacement[] = placeParks(layout, bb, { commitCount: 30 });
    const trees = placements.filter((p) => p.treeCount > 0);

    for (const p of trees) {
      const dInf = Math.max(Math.abs(p.x), Math.abs(p.y));
      expect(dInf).toBeGreaterThan(110);
    }

    FOOTPRINT.setKey('HALO_WIDTH', 32);
  });

  // ── Bush + flower pass tests ──────────────────────────────────────

  it('skips bush+flower pass when both are disabled', () => {
    PARKS_PALETTE.setKey('BUSHES_ENABLED', false);
    PARKS_PALETTE.setKey('FLOWERS_ENABLED', false);
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeParks(layout, layout.bbox, { commitCount: 30 });
    for (const p of placements) {
      expect(p.bushCount).toBe(0);
      expect(p.flowerCount).toBe(0);
    }
  });

  it('still emits bush+flower placements when enabled', () => {
    PARKS_PALETTE.setKey('BUSHES_ENABLED', true);
    PARKS_PALETTE.setKey('FLOWERS_ENABLED', true);
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeParks(layout, layout.bbox, { commitCount: 30 });
    const bushes = placements.filter((p) => p.bushCount > 0);
    expect(bushes.length).toBeGreaterThan(0);
  });

  it('CITY_DENSITY_PERCENT thins bush/flower placements near buildings', () => {
    // Single big building at origin. Compare placements within
    // gradient reach to a uniform run.
    const bb = bbox(-1000, -1000, 1000, 1000);
    function makeBuilding(x: number, y: number, w: number, d: number) {
      return {
        x, y, w, d, h: 10, color: '#000',
        file: { path: '', name: '', size: 0, lines: 0, modified: 0, created: 0 } as never,
        orient: 'n' as never,
      } as never;
    }
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [makeBuilding(0, 0, 2000, 2000)],
    };
    // Uniform run.
    PARKS.setKey('CITY_DENSITY_PERCENT', 100);
    const uniform = placeParks(layout, bb, { commitCount: 0 }).filter(
      (p) => p.bushCount > 0 || p.flowerCount > 0,
    ).length;
    // Thinned-near-city run.
    PARKS.setKey('CITY_DENSITY_PERCENT', 0);
    const thinned = placeParks(layout, bb, { commitCount: 0 }).filter(
      (p) => p.bushCount > 0 || p.flowerCount > 0,
    ).length;
    // With city density at 0, points within gradient reach of the
    // building are nearly always rejected — total should drop.
    expect(thinned).toBeLessThan(uniform);
  });

  it('commitIndex is undefined for bush/flower placements', () => {
    const layout = emptyLayout(bbox(-100, -100, 100, 100));
    const placements = placeParks(layout, layout.bbox, { commitCount: 10 });
    for (const p of placements) {
      if (p.kind === 'bush' || p.kind === 'flower-cluster') {
        expect(p.commitIndex).toBeUndefined();
      }
    }
  });
});

export type { ParkPlacement };
