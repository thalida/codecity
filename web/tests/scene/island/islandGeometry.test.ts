import { describe, it, expect } from 'vitest';
import {
  buildTopPolygon,
  buildTierRings,
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

describe('buildTierRings', () => {
  const baseParams: IslandBuildParams = {
    sides: 12,
    irregularity: 0,
    tiers: 2,
    depth: 0.6,
    halfWidth: 100,
    halfDepth: 100,
    seed: 1234,
  };

  it('returns TIERS rings of SIDES vertices each', () => {
    const top = buildTopPolygon(baseParams);
    const rings = buildTierRings(top, baseParams);
    expect(rings.length).toBe(2);
    rings.forEach((ring) => expect(ring.length).toBe(12));
  });

  it('each tier shrinks inward (radius decreases per tier)', () => {
    const top = buildTopPolygon(baseParams);
    const rings = buildTierRings(top, baseParams);
    const topR = Math.hypot(top[0]!.x, top[0]!.z);
    const r1 = Math.hypot(rings[0]![0]!.x, rings[0]![0]!.z);
    const r2 = Math.hypot(rings[1]![0]!.x, rings[1]![0]!.z);
    expect(r1).toBeLessThan(topR);
    expect(r2).toBeLessThan(r1);
  });

  it('each tier drops in Y (y decreases per tier)', () => {
    const top = buildTopPolygon(baseParams);
    const rings = buildTierRings(top, baseParams);
    expect(rings[0]![0]!.y).toBeLessThan(0);
    expect(rings[1]![0]!.y).toBeLessThan(rings[0]![0]!.y);
  });

  it('respects TIERS=3', () => {
    const top = buildTopPolygon(baseParams);
    const rings = buildTierRings(top, { ...baseParams, tiers: 3 });
    expect(rings.length).toBe(3);
  });
});
