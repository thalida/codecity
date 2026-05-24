// bushPlacement.test.ts — verifies decorative bush scatter placement.

import { describe, it, expect, beforeEach } from 'vitest';
import { placeBushes } from '@/scene/components/bushes/bushPlacement.js';
import { BUSHES } from '@/config/bushes.js';
import { TREES } from '@/config/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import type { CityBbox, CityLayout } from '@/types';

function resetConfig() {
  BUSHES.set({
    BUSHES_ENABLED: true,
    BUSH_RADIUS_FRAC_OF_TREE: 0.4,
    BUSH_NEON_COLORS: ['#00ff88', '#ff2bd6', '#b400ff', '#00d9ff', '#ffd400'],
    BUSH_EMISSION_BOOST: 1.5,
  });
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
    TREE_COLOR_OLD: '#0a2613',
    TREE_COLOR_NEW: '#a8d68a',
    TREE_SHADING_STRENGTH: 0.35,
    TREE_TRUNK_COLOR: '#4a3220',
  });
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

describe('placeBushes (decorative scatter)', () => {
  beforeEach(resetConfig);

  it('returns empty when BUSHES_ENABLED is false', () => {
    BUSHES.setKey('BUSHES_ENABLED', false);
    expect(placeBushes(emptyLayout(bbox(-100, -100, 100, 100)))).toEqual([]);
  });

  it('returns empty when bbox is missing', () => {
    const layout: CityLayout = {
      buildings: [], streets: [], paths: [],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
    };
    expect(placeBushes(layout, undefined)).toEqual([]);
  });

  it('returns placements when enabled', () => {
    const layout = emptyLayout(bbox(-1000, -1000, 1000, 1000));
    const placements = placeBushes(layout, layout.bbox);
    expect(placements.length).toBeGreaterThan(0);
  });

  it('is deterministic — same layout → identical placements', () => {
    const a = placeBushes(emptyLayout(bbox(-100, -100, 100, 100)));
    const b = placeBushes(emptyLayout(bbox(-100, -100, 100, 100)));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].y).toBe(b[i].y);
      expect(a[i].seed).toBe(b[i].seed);
    }
  });

  it('all placements have x, y, and seed fields', () => {
    const layout = emptyLayout(bbox(-1000, -1000, 1000, 1000));
    const placements = placeBushes(layout, layout.bbox);
    for (const p of placements) {
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(typeof p.seed).toBe('number');
    }
  });
});
