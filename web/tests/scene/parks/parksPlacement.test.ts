// parksPlacement.test.ts — verifies the unified random-scatter
// placeParks() fills the visible plane with foliage, respects the
// city-density gradient + overall density modulator, rejects
// candidates that overlap buildings, and is deterministic.

import { describe, it, expect, beforeEach } from 'vitest';
import { placeParks, type ParkPlacement } from '@/scene/parks/parksPlacement.js';
import { PARKS } from '@/config/parks.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';
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

const FAR = CAMERA_PERSPECTIVE.get().FAR;

describe('placeParks (unified, plane-fill)', () => {
  beforeEach(() => {
    resetParks();
    resetBuildings();
  });

  it('returns empty when master ENABLED is false', () => {
    PARKS.setKey('ENABLED', false);
    expect(placeParks(emptyLayout(bbox(-100, -100, 100, 100)))).toEqual([]);
  });

  it('returns empty when DENSITY_PERCENT is 0', () => {
    PARKS.setKey('DENSITY_PERCENT', 0);
    expect(placeParks(emptyLayout(bbox(-100, -100, 100, 100)))).toEqual([]);
  });

  it('returns no plots when bbox is missing', () => {
    const layout: CityLayout = {
      buildings: [], streets: [], paths: [],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
    };
    expect(placeParks(layout)).toEqual([]);
  });

  it('places every element within the scatter circle (centered on gem / bbox center for empty layouts)', () => {
    const bb = bbox(-100, -100, 100, 100);
    const placements = placeParks(emptyLayout(bb));
    // For an empty layout, scatter centers on bbox center and the
    // radius = hypot(width/2, depth/2) × 1.5 ≈ 212 for this bbox.
    // 1-unit slack absorbs float precision.
    const cornerDist = Math.hypot(bb.width / 2, bb.depth / 2);
    const scatterRadius = Math.max(cornerDist * 1.5, 100);
    for (const p of placements) {
      const d = Math.hypot(p.x - bb.cx, p.y - bb.cy);
      expect(d).toBeLessThanOrEqual(scatterRadius + 1);
    }
  });

  it('centers the scatter circle on the gem (closed end of the root street)', () => {
    // Root street oriented along X axis, length 100, centered at
    // (50, 30), width 10. Gem sits at the closed end:
    //   x = 50 - 50 + 5 = 5,  y = 30.
    const bb = bbox(-100, -100, 200, 100);
    const rootStreet = {
      x: 50, y: 30, width: 10, length: 100,
      label: 'root',
      dir: { path: '', name: '' } as never,
      orientation: 'x' as never,
      isRoot: true,
    } as never;
    const layout: CityLayout = {
      ...emptyLayout(bb),
      streets: [rootStreet],
    };
    // High density so we get plenty of placements to measure spread.
    PARKS.setKey('DENSITY_PERCENT', 100);
    const placements = placeParks(layout);

    // Compute mean position of placements. With a uniform-in-area
    // polar scatter centered on the gem at (5, 30), the mean
    // converges to (5, 30) as the sample grows. Allow generous
    // slack for sample variance.
    let sumX = 0, sumY = 0;
    for (const p of placements) { sumX += p.x; sumY += p.y; }
    const meanX = sumX / placements.length;
    const meanY = sumY / placements.length;
    expect(meanX).toBeGreaterThan(5 - 30);
    expect(meanX).toBeLessThan(5 + 30);
    expect(meanY).toBeGreaterThan(30 - 30);
    expect(meanY).toBeLessThan(30 + 30);
  });

  it('scatter circle covers every corner of the city bbox', () => {
    const bb = bbox(-100, -100, 100, 100);
    const placements = placeParks(emptyLayout(bb));
    // At least one placement must land in each quadrant of the bbox
    // — proves the circle reaches every corner of the city.
    const corners = [
      placements.some((p) => p.x > 0 && p.y > 0),
      placements.some((p) => p.x > 0 && p.y < 0),
      placements.some((p) => p.x < 0 && p.y > 0),
      placements.some((p) => p.x < 0 && p.y < 0),
    ];
    for (const has of corners) expect(has).toBe(true);
  });

  it('higher density → more placements (monotonic in DENSITY_PERCENT)', () => {
    const bb = bbox(-100, -100, 100, 100);
    PARKS.setKey('DENSITY_PERCENT', 25);
    const low = placeParks(emptyLayout(bb)).length;
    PARKS.setKey('DENSITY_PERCENT', 100);
    const high = placeParks(emptyLayout(bb)).length;
    expect(high).toBeGreaterThan(low);
  });

  it('CITY_DENSITY_PERCENT thins placements near buildings', () => {
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
    const uniform = placeParks(layout).length;
    // Thinned-near-city run.
    PARKS.setKey('CITY_DENSITY_PERCENT', 0);
    const thinned = placeParks(layout).length;
    // With city density at 0, points within gradient reach of the
    // building are nearly always rejected — total should drop.
    expect(thinned).toBeLessThan(uniform);
  });

  it('rejects candidates that overlap a building', () => {
    const bb = bbox(-50, -50, 50, 50);
    function makeBuilding(x: number, y: number, w: number, d: number) {
      return {
        x, y, w, d, h: 10, color: '#000',
        file: { path: '', name: '', size: 0, lines: 0, modified: 0, created: 0 } as never,
        orient: 'n' as never,
      } as never;
    }
    const layout: CityLayout = {
      ...emptyLayout(bb),
      buildings: [makeBuilding(0, 0, 200, 200)],
    };
    const placements = placeParks(layout);
    // Every placement should be outside the building (-100..100).
    for (const p of placements) {
      const inside = p.x > -100 && p.x < 100 && p.y > -100 && p.y < 100;
      expect(inside).toBe(false);
    }
  });

  it('does NOT form diagonal-line / grid patterns (2D uniformity regression)', () => {
    PARKS.setKey('DENSITY_PERCENT', 100);
    const bb = bbox(-100, -100, 100, 100);
    const placements = placeParks(emptyLayout(bb));
    // Place sample points and check angular distribution from the
    // city center. With proper RNG, the 36 angular bins should be
    // roughly balanced.
    const bins = new Array<number>(36).fill(0);
    for (const p of placements) {
      const a = Math.atan2(p.y - bb.cy, p.x - bb.cx);
      const bin = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 36) % 36;
      bins[bin]++;
    }
    const peak = Math.max(...bins);
    expect(peak).toBeLessThan(placements.length * 0.1);
  });

  it('is deterministic — same layout → identical placements', () => {
    const a = placeParks(emptyLayout(bbox(-100, -100, 100, 100)));
    const b = placeParks(emptyLayout(bbox(-100, -100, 100, 100)));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].y).toBe(b[i].y);
      expect(a[i].seed).toBe(b[i].seed);
      expect(a[i].kind).toBe(b[i].kind);
    }
  });

  it('assigns a kind to every placement (tree / bush / flower-cluster)', () => {
    const placements = placeParks(emptyLayout(bbox(-100, -100, 100, 100)));
    for (const p of placements) {
      expect(['tree', 'bush', 'flower-cluster']).toContain(p.kind);
    }
  });

  it('counts are driven by kind (tree:1, bush:1+flowers, cluster:flowers only)', () => {
    const placements = placeParks(emptyLayout(bbox(-100, -100, 100, 100)));
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

    const placements: ParkPlacement[] = placeParks(layout, bb);

    for (const p of placements) {
      const dInf = Math.max(Math.abs(p.x), Math.abs(p.y));
      expect(dInf).toBeGreaterThan(110);
    }

    FOOTPRINT.setKey('HALO_WIDTH', 32);
  });
});

export type { ParkPlacement };
