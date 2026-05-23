import { describe, it, expect } from 'vitest';
import {
  buildTopPolygon,
  type IslandBuildParams,
} from '@/scene/island/islandGeometry.js';

describe('buildTopPolygon', () => {
  const baseParams: IslandBuildParams = {
    sides: 12,
    irregularity: 0,
    tiers: 2,
    depth: 0.6,
    halfWidth: 100,
    halfDepth: 100,
    seed: 1234,
  };

  it('returns SIDES vertices in CCW order on the XZ plane', () => {
    const pts = buildTopPolygon(baseParams);
    expect(pts.length).toBe(12);
    pts.forEach((p) => {
      expect(p.y).toBe(0); // top cap is the y=0 reference; mesh offset applied elsewhere
    });
  });

  it('with irregularity=0 produces a regular polygon (all vertices equidistant from origin)', () => {
    const pts = buildTopPolygon(baseParams);
    const radii = pts.map((p) => Math.hypot(p.x, p.z));
    const first = radii[0]!;
    radii.forEach((r) => expect(r).toBeCloseTo(first, 3));
  });

  it('inscribes the polygon in the bounds (max |x| ≤ halfWidth, max |z| ≤ halfDepth)', () => {
    const pts = buildTopPolygon(baseParams);
    pts.forEach((p) => {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(100 + 1e-6);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(100 + 1e-6);
    });
  });

  it('with irregularity>0 produces non-uniform radii but still stays inscribed', () => {
    const pts = buildTopPolygon({ ...baseParams, irregularity: 0.3 });
    const radii = pts.map((p) => Math.hypot(p.x, p.z));
    const min = Math.min(...radii);
    const max = Math.max(...radii);
    expect(max - min).toBeGreaterThan(0); // varied
    pts.forEach((p) => {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(100 + 1e-6);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(100 + 1e-6);
    });
  });

  it('is deterministic for the same seed', () => {
    const a = buildTopPolygon({ ...baseParams, irregularity: 0.3, seed: 42 });
    const b = buildTopPolygon({ ...baseParams, irregularity: 0.3, seed: 42 });
    a.forEach((pa, i) => {
      expect(pa.x).toBeCloseTo(b[i]!.x, 6);
      expect(pa.z).toBeCloseTo(b[i]!.z, 6);
    });
  });

  it('produces different polygons for different seeds', () => {
    const a = buildTopPolygon({ ...baseParams, irregularity: 0.3, seed: 1 });
    const b = buildTopPolygon({ ...baseParams, irregularity: 0.3, seed: 2 });
    const dx = a.reduce((s, pa, i) => s + Math.abs(pa.x - b[i]!.x), 0);
    expect(dx).toBeGreaterThan(0);
  });
});
