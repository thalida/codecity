// bushPlacement.test.ts — verifies decorative bush scatter placement.

import { describe, it, expect, beforeEach } from 'vitest';
import { placeBushes } from '@/scene/components/bushes/bushPlacement.js';
import { BUSHES } from '@/config/components/bushes.js';
import type { CityLayout } from '@/types';
import {
  bbox,
  emptyLayout,
  resetBushesConfig,
  resetTreesConfig,
  resetBuildingsConfig,
} from '../../_helpers/cityFixtures';

describe('placeBushes (decorative scatter)', () => {
  beforeEach(() => {
    resetBushesConfig();
    resetTreesConfig();
    resetBuildingsConfig();
  });

  it('returns empty when BUSHES_ENABLED is false', () => {
    BUSHES.setKey('BUSHES_ENABLED', false);
    expect(placeBushes(emptyLayout(bbox(-100, -100, 100, 100)))).toEqual([]);
  });

  it('returns empty when bbox is missing', () => {
    const layout: CityLayout = {
      buildings: [],
      streets: [],
      paths: [],
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
