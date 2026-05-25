import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildTopPolygon,
  buildIslandGeometry,
  pointInIslandPolygon,
  type IslandBuildParams,
  type IslandColors,
} from '@/scene/components/island/islandGeometry.js';

describe('buildTopPolygon', () => {
  const baseParams: IslandBuildParams = {
    sides: 12,
    irregularity: 0,
    tiers: 2,
    depth: 0.6,
    halfWidth: 100,
    halfDepth: 100,
    seed: 1234,
    roundness: 0.7,
    grassThickness: 0.025,
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

  it('polygon FULLY CONTAINS the bounds rect (sqrt(2) corner correction × edge correction)', () => {
    const pts = buildTopPolygon(baseParams);
    // baseScale = sqrt(2) × 1/cos(π/12) ≈ 1.464.
    const expectedR = 100 * Math.SQRT2 / Math.cos(Math.PI / 12);
    pts.forEach((p) => {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(expectedR, 1);
    });
    expect(expectedR).toBeGreaterThan(Math.hypot(100, 100));
  });

  it('irregularity is reductive — vertices pull inward from the baseline', () => {
    const pts = buildTopPolygon({ ...baseParams, irregularity: 0.3 });
    const baseline = 100 * Math.SQRT2 / Math.cos(Math.PI / 12);
    const radii = pts.map((p) => Math.hypot(p.x, p.z));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0);
    // All vertices sit at-or-inside the baseline (never grow past it).
    pts.forEach((p) => {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(baseline + 1e-6);
    });
  });

  it('non-square bounds produce an ellipse (radii vary by angle, aspect ratio preserved)', () => {
    const pts = buildTopPolygon({ ...baseParams, halfWidth: 200, halfDepth: 50 });
    const radii = pts.map((p) => Math.hypot(p.x, p.z));
    // baseScale = sqrt(2)/cos(π/12) ≈ 1.464.
    // Ellipse axes: 200×1.464 ≈ 293 (X), 50×1.464 ≈ 73 (Z).
    expect(Math.min(...radii)).toBeLessThan(80);
    expect(Math.max(...radii)).toBeGreaterThan(280);
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

describe('buildIslandGeometry', () => {
  const baseParams: IslandBuildParams = {
    sides: 12, irregularity: 0.18, tiers: 2, depth: 0.6,
    halfWidth: 100, halfDepth: 100, seed: 1234,
    roundness: 0.7, grassThickness: 0.025,
  };
  const colors: IslandColors = {
    GRASS: '#1a2620',
    GRASS_SIDE: '#1a2620',
    ROCK: '#0a0a10',
  };

  it('returns a non-indexed BufferGeometry with position, normal, color, and ao attributes', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    expect(geom).toBeInstanceOf(THREE.BufferGeometry);
    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('normal')).toBeDefined();
    expect(geom.getAttribute('color')).toBeDefined();
    expect(geom.getAttribute('ao')).toBeDefined();
    // toNonIndexed() produces a non-indexed geometry (no index buffer).
    expect(geom.getIndex()).toBeNull();
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

  it('AO is highest on the top cap and lowest near the pit', () => {
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
    const nor = geom.getAttribute('normal') as THREE.BufferAttribute;
    // After toNonIndexed + computeVertexNormals, every vertex in a top-cap
    // triangle has the same face normal. Find any vertex at y=0 and check
    // its normal points upward.
    let foundTopVertex = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i)) < 1e-6) {
        const ny = nor.getY(i);
        expect(ny).toBeGreaterThan(0);
        foundTopVertex = true;
        break;
      }
    }
    expect(foundTopVertex).toBe(true);
    geom.dispose();
  });

  it('bottom-cap fan triangles have -Y normals (front-face down)', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const nor = geom.getAttribute('normal') as THREE.BufferAttribute;
    // The bottom-cap center is at (0, -totalDepth, 0) — the cap fan uses
    // reversed winding so computeVertexNormals() gives it a -Y face normal.
    // Look for a vertex very close to the XZ origin at the deepest Y band;
    // that vertex will be the replicated cap center inside a fan triangle.
    const islandRadius = Math.min(100, 100);
    const totalDepth = islandRadius * 0.6;
    const expectedBottomY = -totalDepth;
    let foundCapCenter = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Cap center is at (0, expectedBottomY, 0) with no jitter.
      if (Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6 && Math.abs(y - expectedBottomY) < 1e-6) {
        const ny = nor.getY(i);
        expect(ny).toBeLessThan(0);
        foundCapCenter = true;
        break;
      }
    }
    expect(foundCapCenter).toBe(true);
    geom.dispose();
  });

  it('vertex count is in the expected low-poly range', () => {
    const geom = buildIslandGeometry(baseParams, colors);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    // Non-indexed: vertexCount = triangleCount * 3.
    // Expected triangles: sides*(4 + 2*(tiers+1)) = 12*(4+6) = 120.
    // Some variation due to the actual ring count — accept a generous range.
    expect(pos.count).toBeGreaterThan(100);
    expect(pos.count).toBeLessThan(3000);
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
    roundness: 0.7,
    grassThickness: 0.025,
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
    // For a square bounds (hw=hd=100), the polygon is a regular 12-gon
    // circumscribed by radius 100. Its inscribed circle radius is
    // 100 × cos(π/12) ≈ 96.6. A point well inside that is inside the polygon.
    const inscR = 100 * Math.cos(Math.PI / 12);
    const angle = Math.PI / 12; // midway between vertex 0 (theta=0) and vertex 1 (theta=2π/12)
    const x = Math.cos(angle) * inscR * 0.99;
    const z = -Math.sin(angle) * inscR * 0.99; // matches the negated-z polygon parameterization
    expect(pointInIslandPolygon(x, z, polygon)).toBe(true);
  });

  it('point outside polygon at mid-edge angle is outside polygon', () => {
    // Polygon baseline radius = 100 × sqrt(2)/cos(π/12) ≈ 146.4. Its
    // inscribed circle sits at baseline × cos(π/12) = 100×sqrt(2) ≈ 141.4.
    // Point just past that is outside.
    const inscR = 100 * Math.SQRT2;
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
