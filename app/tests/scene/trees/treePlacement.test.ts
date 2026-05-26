// treePlacement.test.ts — verifies commit-driven tree placement.

import { describe, it, expect, beforeEach } from 'vitest';
import { placeTrees, type TreePlacement } from '@/scene/components/trees/treePlacement.js';
import { TREES } from '@/config/components/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/components/buildings.js';
import type { CityBbox, CityLayout } from '@/types';

function resetTrees() {
  TREES.set({
    TREES_ENABLED: true,
    EDGE_INSET_PERCENT: 8,
    TREE_DENSITY_FALLOFF: 0,
    TREE_MIN_HEIGHT: 48,
    TREE_MAX_HEIGHT: 144,
    TREE_MIN_WIDTH: 32,
    TREE_MAX_WIDTH: 128,
    TRUNK_HEIGHT_FRAC: 0.25,
    TRUNK_RADIUS_FRAC_OF_CANOPY: 0.15,
    CANOPY_TRUNK_OVERLAP_FRAC: 0.7,
    SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
    TREE_COLOR_BUSY_DAY: '#0a2613',
    TREE_COLOR_SOLO_DAY: '#a8d68a',
    TREE_SHADING_STRENGTH: 0.35,
    TREE_TRUNK_COLOR: '#4a3220',
    TREE_AGE_DESAT_ENABLED: false,
    TREE_AGE_SATURATION_MIN: 20,
    TREE_AGE_SATURATION_MAX: 100,
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
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    depth: maxY - minY,
  };
}

function emptyLayout(bb: CityBbox): CityLayout {
  return {
    buildings: [],
    streets: [],
    paths: [],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: bb,
  };
}

describe('placeTrees (commit-driven)', () => {
  beforeEach(() => {
    resetTrees();
    resetBuildings();
  });

  it('returns empty when TREES_ENABLED is false', () => {
    TREES.setKey('TREES_ENABLED', false);
    expect(
      placeTrees(emptyLayout(bbox(-100, -100, 100, 100)), undefined, { commitCount: 10 })
    ).toEqual([]);
  });

  it('returns empty when bbox is missing', () => {
    const layout: CityLayout = {
      buildings: [],
      streets: [],
      paths: [],
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
    function makeBuilding(x: number, y: number, w: number, d: number) {
      return {
        x,
        y,
        w,
        d,
        h: 10,
        color: '#000',
        file: { path: '', name: '', size: 0, lines: 0, modified: 0, created: 0 } as never,
        orient: 'n' as never,
      } as never;
    }
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [makeBuilding(0, 0, 400, 400)],
    };
    const placements = placeTrees(layout, bb, { commitCount: 50 });
    for (const p of placements) {
      const inside = p.x > -200 && p.x < 200 && p.y > -200 && p.y < 200;
      expect(inside).toBe(false);
    }
  });

  it('rejects candidates inside the FOOTPRINT halo around a layout rect', async () => {
    const { FOOTPRINT } = await import('@/config/components/footprint.js');
    FOOTPRINT.setKey('HALO_WIDTH', 100);

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

    FOOTPRINT.setKey('HALO_WIDTH', 32);
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
