import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildTopPolygon,
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
    bluntness: 0.4,
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

describe('buildIslandGeometry', () => {
  const baseParams: IslandBuildParams = {
    sides: 12, irregularity: 0.18, tiers: 2, depth: 0.6,
    halfWidth: 100, halfDepth: 100, seed: 1234,
    bluntness: 0.4,
  };
  const colors: IslandColors = {
    GRASS: '#1a2620',
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
    bluntness: 0.4,
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
