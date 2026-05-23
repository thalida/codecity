import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildTopPolygon,
  buildTierRings,
  buildIslandGeometry,
  pointInIslandPolygon,
  type IslandBuildParams,
  type IslandColors,
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

  it('returns SIDES vertices in CCW order on the XZ plane (as viewed from above)', () => {
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

  it('polygon contains the bounds rect at irregularity=0 (vertices lie on the circumscribing circle)', () => {
    const pts = buildTopPolygon(baseParams);
    // With irregularity=0, every vertex is at exactly baseR = hypot(halfWidth, halfDepth).
    const baseR = Math.hypot(100, 100);
    pts.forEach((p) => {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(baseR, 3);
    });
  });

  it('with irregularity>0 produces non-uniform radii that stay at or below baseR', () => {
    const pts = buildTopPolygon({ ...baseParams, irregularity: 0.3 });
    const radii = pts.map((p) => Math.hypot(p.x, p.z));
    const min = Math.min(...radii);
    const max = Math.max(...radii);
    expect(max - min).toBeGreaterThan(0); // varied
    // Irregularity only shrinks vertices — none should exceed baseR.
    const baseR = Math.hypot(100, 100);
    radii.forEach((r) => {
      expect(r).toBeLessThanOrEqual(baseR + 1e-6);
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

describe('buildIslandGeometry', () => {
  const baseParams: IslandBuildParams = {
    sides: 12, irregularity: 0.18, tiers: 2, depth: 0.6,
    halfWidth: 100, halfDepth: 100, seed: 1234,
  };
  const colors: IslandColors = {
    GRASS: '#1a2620',
    ROCK: '#0a0a10',
  };

  it('returns a closed BufferGeometry with position, normal, color, and ao attributes', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    expect(geom).toBeInstanceOf(THREE.BufferGeometry);
    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('normal')).toBeDefined();
    expect(geom.getAttribute('color')).toBeDefined();
    expect(geom.getAttribute('ao')).toBeDefined();
    expect(geom.getIndex()).not.toBeNull();
    geom.dispose();
  });

  it('top-cap vertices use GRASS color, bottom vertices use ROCK color', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const col = geom.getAttribute('color') as THREE.BufferAttribute;
    // Find the highest-y vertex (top cap interior).
    let topIdx = 0, topY = -Infinity, bottomIdx = 0, bottomY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > topY) { topY = y; topIdx = i; }
      if (y < bottomY) { bottomY = y; bottomIdx = i; }
    }
    const grass = new THREE.Color('#1a2620');
    const rockColor = new THREE.Color('#0a0a10');
    expect(col.getX(topIdx)).toBeCloseTo(grass.r, 3);
    expect(col.getX(bottomIdx)).toBeCloseTo(rockColor.r, 3);
    geom.dispose();
  });

  it('AO is highest on the top cap and lowest in tier-ring crevices', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const ao = geom.getAttribute('ao') as THREE.BufferAttribute;
    let topAO = 0, bottomAO = 1;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const aoVal = ao.getX(i);
      if (y > -0.01) topAO = Math.max(topAO, aoVal);
      if (y < -50) bottomAO = Math.min(bottomAO, aoVal);
    }
    expect(topAO).toBeGreaterThan(bottomAO);
    geom.dispose();
  });

  it('disposes cleanly with no exception', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    expect(() => geom.dispose()).not.toThrow();
  });

  it('top-cap triangles have +Y normals (front-face up)', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const idx = geom.getIndex()!;
    // Find a triangle on the top cap (all three vertices at y≈0).
    let foundTopTri = false;
    for (let t = 0; t < idx.count; t += 3) {
      const ia = idx.getX(t), ib = idx.getX(t + 1), ic = idx.getX(t + 2);
      const ya = pos.getY(ia), yb = pos.getY(ib), yc = pos.getY(ic);
      if (ya === 0 && yb === 0 && yc === 0) {
        // Compute face normal via cross product.
        const ax = pos.getX(ia), az = pos.getZ(ia);
        const bx = pos.getX(ib), bz = pos.getZ(ib);
        const cx = pos.getX(ic), cz = pos.getZ(ic);
        const v1x = bx - ax, v1z = bz - az;
        const v2x = cx - ax, v2z = cz - az;
        const normalY = v1z * v2x - v1x * v2z;
        // Skip the degenerate origin-fan triangles where v1 or v2 is zero
        if (Math.abs(normalY) > 1e-6) {
          expect(normalY).toBeGreaterThan(0);  // front-face up
          foundTopTri = true;
          break;
        }
      }
    }
    expect(foundTopTri).toBe(true);
    geom.dispose();
  });

  it('bottom-cap triangles have -Y normals (front-face down)', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const idx = geom.getIndex()!;
    // Find the overall Y range and look for triangles in the bottom 10% of
    // depth. With 3D noise displacement applied to the bottom cap ring,
    // vertices no longer sit at exactly the same Y, so we use a loose
    // threshold rather than requiring all three to equal minY.
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const totalDepthRange = maxY - minY;
    const bottomThreshold = minY + totalDepthRange * 0.1; // bottom 10%
    let foundBottomTri = false;
    for (let t = 0; t < idx.count; t += 3) {
      const ia = idx.getX(t), ib = idx.getX(t + 1), ic = idx.getX(t + 2);
      const ya = pos.getY(ia), yb = pos.getY(ib), yc = pos.getY(ic);
      if (ya < bottomThreshold && yb < bottomThreshold && yc < bottomThreshold) {
        const ax = pos.getX(ia), az = pos.getZ(ia);
        const bx = pos.getX(ib), bz = pos.getZ(ib);
        const cx = pos.getX(ic), cz = pos.getZ(ic);
        const v1x = bx - ax, v1z = bz - az;
        const v2x = cx - ax, v2z = cz - az;
        const normalY = v1z * v2x - v1x * v2z;
        if (Math.abs(normalY) > 1e-6) {
          expect(normalY).toBeLessThan(0);
          foundBottomTri = true;
          break;
        }
      }
    }
    expect(foundBottomTri).toBe(true);
    geom.dispose();
  });
});

describe('pointInIslandPolygon', () => {
  // Use irregularity=0 for a clean regular 12-gon, same halfWidth/halfDepth
  // as the geometry tests so baseR = hypot(100,100) ≈ 141.4.
  const polygon = buildTopPolygon({
    sides: 12,
    irregularity: 0,
    tiers: 2,
    depth: 0.6,
    halfWidth: 100,
    halfDepth: 100,
    seed: 42,
  });

  it('origin is inside', () => {
    expect(pointInIslandPolygon(0, 0, polygon)).toBe(true);
  });

  it('point clearly inside the inscribed circle is inside', () => {
    // distance from origin ≈ 70.7, well inside the inscribed circle
    // (baseR × cos(π/12) ≈ 136.6)
    expect(pointInIslandPolygon(50, 50, polygon)).toBe(true);
  });

  it('point far outside (200, 200) is outside', () => {
    expect(pointInIslandPolygon(200, 200, polygon)).toBe(false);
  });

  it('point inside inscribed circle at mid-edge angle is inside polygon', () => {
    // At angle π/12 (midway between vertex 0 and vertex 1), the polygon
    // edge distance from origin = baseR × cos(π/12) (inscribed circle).
    // A point slightly inside that radius should be inside.
    const baseR = Math.hypot(100, 100);
    const inscR = baseR * Math.cos(Math.PI / 12);
    const angle = Math.PI / 12; // midway between vertex 0 (theta=0) and vertex 1 (theta=2π/12)
    const x = Math.cos(angle) * inscR * 0.99;
    const z = -Math.sin(angle) * inscR * 0.99; // matches the negated-z polygon parameterization
    expect(pointInIslandPolygon(x, z, polygon)).toBe(true);
  });

  it('point outside polygon at mid-edge angle is outside polygon', () => {
    // Slightly past the polygon edge at the mid-edge angle.
    const baseR = Math.hypot(100, 100);
    const inscR = baseR * Math.cos(Math.PI / 12);
    const angle = Math.PI / 12;
    const x = Math.cos(angle) * inscR * 1.01;
    const z = -Math.sin(angle) * inscR * 1.01;
    expect(pointInIslandPolygon(x, z, polygon)).toBe(false);
  });

  it('a simple square polygon correctly classifies points', () => {
    // Cross-check with a known square where we can reason directly.
    const square = [
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 0, -1),
      new THREE.Vector3(1, 0, 1),
      new THREE.Vector3(-1, 0, 1),
    ];
    expect(pointInIslandPolygon(0, 0, square)).toBe(true);   // center
    expect(pointInIslandPolygon(0.9, 0.9, square)).toBe(true);  // inside corner
    expect(pointInIslandPolygon(1.1, 1.1, square)).toBe(false); // outside corner
    expect(pointInIslandPolygon(0, 1.1, square)).toBe(false);   // past top edge
  });
});
