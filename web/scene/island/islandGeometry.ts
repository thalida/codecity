// scene/island/islandGeometry.ts — Procedural builder for the floating
// island mesh.
//
// Approach: build a single indexed BufferGeometry containing all triangles,
// then call toNonIndexed() + computeVertexNormals(). This is the canonical
// Three.js idiom for low-poly flat shading: every triangle gets its own
// three independent vertices, so computeVertexNormals() produces a pure
// face normal (no averaging across neighbours) — giving perfectly crisp
// ridge lines with zero seams between logical sections.
//
// Mesh structure (Y descends from 0):
//   TOP CAP      — flat N-gon fan at y=0, grass colour
//   SIDE WALL    — vertical N quads connecting the top ring to the
//                  outermost underside ring (same Y as the first underside
//                  ring), rock colour
//   UNDERSIDE    — (tiers+1) rings that shrink and deepen from the top
//                  perimeter down to the bottom-cap ring; each ring pair
//                  produces N quads, rock colour
//   BOTTOM CAP   — N quads stitching the last underside ring to a small
//                  bottom-cap N-gon ring at the deepest Y, plus an N-
//                  triangle fan from that ring to a center vertex; the fan
//                  cap's reversed winding gives -Y normals (face down).
//
// Triangle count (indexed, before toNonIndexed):
//   top cap      : sides
//   side wall    : 2 * sides
//   underside    : 2 * sides * (tiers + 1)
//   bottom quads : 2 * sides
//   bottom fan   : sides
//   Total        : sides * (5 + 2*(tiers+1))  ≈ 12*(5+6)=132 → 200-600 triangles
//                  after toNonIndexed (same count, 3× as many vertices).

import * as THREE from 'three';

export interface IslandBuildParams {
  sides: number;        // top polygon side count
  irregularity: number; // 0–0.5 radial jitter
  tiers: number;        // count of intermediate rings on the underside
  depth: number;        // total island depth as fraction of island radius
  halfWidth: number;    // bounds half-width (X)
  halfDepth: number;    // bounds half-depth (Z)
  seed: number;         // deterministic shape per bounds
  pitWidth: number;     // 0–0.4, fraction of islandRadius — bottom-cap ring radius
  taperCurve: number;   // 0.5–3.0, exponent on the radius shrink — < 1 = bowl, > 1 = concave/pointed
}

// Mulberry32 — small deterministic PRNG. Stable across platforms.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the N-gon top silhouette inscribed in the (halfWidth, halfDepth)
 * rectangle. Vertices are returned in CCW order on the XZ plane with y=0;
 * the mesh's overall Y offset is applied by the caller.
 */
export function buildTopPolygon(params: IslandBuildParams): THREE.Vector3[] {
  const { sides, irregularity, halfWidth, halfDepth, seed } = params;
  const rand = rng(seed);
  // Base radius circumscribes the bounds rectangle.
  const baseR = Math.hypot(halfWidth, halfDepth);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    // Jitter only shrinks inward so the polygon never grows past baseR.
    const jitter = 1 - irregularity * rand();
    const r = baseR * jitter;
    pts.push(new THREE.Vector3(Math.cos(theta) * r, 0, -Math.sin(theta) * r));
  }
  return pts;
}

export interface IslandColors {
  GRASS: string;
  ROCK: string;
}

/**
 * Build the complete island as one closed indexed BufferGeometry, then
 * call toNonIndexed() + computeVertexNormals() so every triangle is
 * independently flat-shaded — the canonical Three.js low-poly idiom.
 *
 * The top cap stays perfectly flat at y=0 (city sits on it).
 * The underside fans from the top perimeter ring inward through several
 * progressively smaller/deeper rings to a single pit vertex, producing
 * the inverted-mountain faceted look.
 */
export function buildIslandGeometry(
  params: IslandBuildParams,
  colors: IslandColors,
): THREE.BufferGeometry {
  const { sides, irregularity, tiers, depth, halfWidth, halfDepth, seed, taperCurve, pitWidth } = params;

  const islandRadius = Math.min(halfWidth, halfDepth);
  const totalDepth = islandRadius * depth;

  // Top perimeter ring — perfectly at y=0.
  const topRing = buildTopPolygon(params);

  // ------------------------------------------------------------------ //
  // Build underside rings. We generate (tiers + 1) rings below the top: //
  //   ring[0] = top perimeter (just re-used for stitching)              //
  //   ring[1..tiers] = intermediate shrinking rings                     //
  // Then a single pit vertex at (0, -totalDepth, 0).                   //
  //                                                                      //
  // Each intermediate ring:                                              //
  //   - is rotated by (π/sides) relative to the previous ring so        //
  //     adjacent facets are clearly angled (not collinear)              //
  //   - shrinks toward the axis (parameterised by radiusFrac)           //
  //   - drops in Y (parameterised by depthFrac)                         //
  //   - gets small XZ noise so the silhouette reads angular/chunky      //
  //                                                                      //
  // We deliberately avoid applying Y noise to the intermediate rings    //
  // because that's what made previous tiers look like separate layers.  //
  // ------------------------------------------------------------------ //

  // shrinkFracs[t] = fraction of islandRadius the ring sits at (radius).
  // depthFracs[t] = fraction of totalDepth the ring sits at (Y descent).
  // We space rings evenly but bias depth so the first ring is already
  // well below the top edge — this gives the "chunky rock body" look.
  const undersideRings: THREE.Vector3[][] = [];

  const noiseScale = islandRadius * irregularity * 0.18;
  const noiseRand = rng(seed ^ 0xdeadbeef);

  for (let t = 0; t < tiers; t++) {
    const frac = (t + 1) / (tiers + 1); // 0 < frac < 1

    // Radius: shrink AGGRESSIVELY as we go deeper so the silhouette
    // tapers to a pointed bottom (concave/conical profile, not a
    // bowl). Exponent > 1 makes the outer rings stay wide and the
    // inner rings (near the pit) shrink fast.
    const radiusFrac = Math.pow(1 - frac, taperCurve); // 1→0, concave taper

    // Depth: more linear so each ring drops by a steady amount —
    // gives the taper room to be visible per-ring rather than the
    // depth crushing everything to the bottom.
    const depthFrac = Math.pow(frac, 1.0);

    const targetY = -totalDepth * depthFrac;
    // Rotate each ring by half a "tooth" so vertices stagger between rings.
    const rotation = (Math.PI / sides) * (t + 1);
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      // Scale and rotate the top-ring vertex position into this ring's
      // position. radiusFrac shrinks it toward the axis; the rotation
      // staggers vertices between adjacent rings so each quad is a proper
      // angled facet (not a flat rectangle).
      const topV = topRing[i]!;
      const baseX = topV.x * radiusFrac;
      const baseZ = topV.z * radiusFrac;
      const rx = baseX * cosR - baseZ * sinR;
      const rz = baseX * sinR + baseZ * cosR;

      // Small XZ noise to break up the symmetry. No Y noise — we want
      // the ring to sit at a consistent depth, not create ledge artifacts.
      const nx = (noiseRand() - 0.5) * 2 * noiseScale * (1 - frac * 0.5);
      const nz = (noiseRand() - 0.5) * 2 * noiseScale * (1 - frac * 0.5);

      ring.push(new THREE.Vector3(rx + nx, targetY, rz + nz));
    }
    undersideRings.push(ring);
  }

  // ------------------------------------------------------------------ //
  // Accumulate indexed geometry.                                         //
  // We collect positions, colors, and ao values. After assembly we call  //
  // toNonIndexed() which duplicates vertices per-triangle, then          //
  // computeVertexNormals() which gives each triangle its face normal.   //
  // ------------------------------------------------------------------ //

  const positions: number[] = [];
  const colorsArr: number[] = [];
  const aoArr: number[] = [];
  const indices: number[] = [];

  const grass = new THREE.Color(colors.GRASS);
  const rock = new THREE.Color(colors.ROCK);

  // Push a vertex; return its index.
  function addVertex(p: THREE.Vector3, c: THREE.Color, ao: number): number {
    const idx = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    colorsArr.push(c.r, c.g, c.b);
    aoArr.push(ao);
    return idx;
  }

  // ----- TOP CAP (grass, flat at y=0) -----
  // Fan from a center vertex to each edge of the top ring.
  // AO = 1.0 everywhere on the top — fully lit, city sits here.
  const centerIdx = addVertex(new THREE.Vector3(0, 0, 0), grass, 1.0);
  const topIdx: number[] = topRing.map((v) => addVertex(v, grass, 1.0));
  for (let i = 0; i < sides; i++) {
    const a = topIdx[i]!;
    const b = topIdx[(i + 1) % sides]!;
    // CCW winding from above → normal points +Y.
    indices.push(centerIdx, a, b);
  }

  // ----- UNDERSIDE BODY -----
  // Stitch from the top perimeter ring down through each intermediate ring,
  // then fan from the last ring to the pit vertex.
  //
  // All underside faces use rock colour. AO decreases from ~0.85 at the
  // top edge down to ~0.45 at the pit, giving a subtle depth cue.

  // Build the underside vertex index arrays.
  // allRings[0] = top perimeter (re-indexed for rock color).
  // allRings[1..tiers] = intermediate rings.
  // Then pit vertex.
  const allRingIdx: number[][] = [];

  // Top perimeter re-indexed with rock color + AO for the side connection.
  const topRockIdx: number[] = topRing.map((v) => addVertex(v, rock, 0.85));
  allRingIdx.push(topRockIdx);

  for (let t = 0; t < undersideRings.length; t++) {
    const frac = (t + 1) / (tiers + 1);
    const ao = 0.85 - 0.40 * frac; // 0.85 at top edge → 0.45 at deepest ring
    const ring = undersideRings[t]!;
    const ringIdx: number[] = ring.map((v) => addVertex(v, rock, ao));
    allRingIdx.push(ringIdx);
  }

  // Stitch adjacent ring pairs into quads (2 triangles each).
  for (let r = 0; r < allRingIdx.length - 1; r++) {
    const upper = allRingIdx[r]!;
    const lower = allRingIdx[r + 1]!;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const tl = upper[i]!;
      const tr = upper[j]!;
      const bl = lower[i]!;
      const br = lower[j]!;
      // Two triangles per quad; winding so normals point outward (away from
      // island centre — roughly outward-and-downward for underside faces).
      // tl→bl→br (CCW from outside) and tl→br→tr.
      indices.push(tl, bl, br);
      indices.push(tl, br, tr);
    }
  }

  // Bottom cap: small N-gon polygon (not a single point) at the deepest Y.
  // pitWidth controls the MINIMUM bottom-cap ring fraction, but we guarantee
  // the cap is never narrower than the last intermediate ring — otherwise the
  // stitch goes inward and creates a visible dagger spike.
  //
  // lastRingRadiusFrac mirrors the radiusFrac formula in the intermediate-ring
  // loop above, evaluated at frac = tiers/(tiers+1) (the last ring).
  const lastRingRadiusFrac = tiers > 0
    ? Math.pow(1 - tiers / (tiers + 1), taperCurve)
    : 1;
  const lastRingRadius = islandRadius * lastRingRadiusFrac;
  const minPitRadius = islandRadius * pitWidth;
  // Clamp: the cap may be smaller than the last ring, but never so small it
  // inverts the taper. 0.85 gives a visible "bottom closure" step.
  const pitRadius = Math.max(minPitRadius, lastRingRadius * 0.85);

  const bottomY = -totalDepth;
  const bottomNoise = rng(seed ^ 0xa1b2c3d4);
  const bottomRing: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    // Stagger rotation by half a "tooth" relative to the last ring so adjacent
    // facets meet at an angle, not as aligned columns.
    const stagger = (Math.PI / sides);
    const rx = Math.cos(theta + stagger) * pitRadius;
    const rz = -Math.sin(theta + stagger) * pitRadius;
    // Tiny per-vertex noise — just enough so the cap isn't perfectly circular.
    // The old value (pitRadius * 0.25) was large enough to cross adjacent
    // vertices and produce a tangled cap; 0.08 gives a barely-perturbed ring.
    const jitter = pitRadius * 0.08;
    bottomRing.push(new THREE.Vector3(
      rx + (bottomNoise() - 0.5) * 2 * jitter,
      bottomY + (bottomNoise() - 0.5) * 2 * jitter * 0.4,
      rz + (bottomNoise() - 0.5) * 2 * jitter,
    ));
  }

  // Stitch last intermediate ring to bottom ring (quads).
  const lastRingIdx = allRingIdx[allRingIdx.length - 1]!;
  const bottomRingVerts = bottomRing.map((v) => addVertex(v, rock, 0.45));
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    indices.push(lastRingIdx[i]!, bottomRingVerts[i]!, bottomRingVerts[j]!);
    indices.push(lastRingIdx[i]!, bottomRingVerts[j]!, lastRingIdx[j]!);
  }

  // Bottom cap fan to center. Reversed winding so the cap's normal points DOWN.
  const bottomCenter = addVertex(new THREE.Vector3(0, bottomY, 0), rock, 0.42);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    indices.push(bottomCenter, bottomRingVerts[j]!, bottomRingVerts[i]!);
  }

  // ------------------------------------------------------------------ //
  // Assemble, toNonIndexed, computeVertexNormals.                        //
  // ------------------------------------------------------------------ //
  const indexed = new THREE.BufferGeometry();
  indexed.setIndex(indices);
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  indexed.setAttribute('color', new THREE.Float32BufferAttribute(colorsArr, 3));
  indexed.setAttribute('ao', new THREE.Float32BufferAttribute(aoArr, 1));

  // toNonIndexed() duplicates each vertex so adjacent triangles don't share
  // vertices — computeVertexNormals() then computes a pure face normal for
  // each triangle with no cross-triangle averaging. This is the canonical
  // Three.js idiom for crisp low-poly flat shading.
  const geom = indexed.toNonIndexed();
  geom.computeVertexNormals();

  indexed.dispose();
  return geom;
}

/**
 * Standard ray-casting point-in-polygon test. Polygon vertices are
 * given as a CCW (or CW — algorithm is winding-agnostic) loop on the
 * XZ plane. Returns true if (px, pz) is inside or on the polygon edge.
 */
export function pointInIslandPolygon(
  px: number,
  pz: number,
  polygon: THREE.Vector3[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x, zi = polygon[i]!.z;
    const xj = polygon[j]!.x, zj = polygon[j]!.z;
    const intersects =
      (zi > pz) !== (zj > pz) &&
      px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Returns the effective bottom-cap ring radius for the given params.
 * Used by callers (e.g. islandMesh, underglow core, shadow disc) so they
 * stay in sync with the actual bottom geometry without reaching into
 * internal constants.
 *
 * Mirrors the clamping logic in buildIslandGeometry: the cap radius is
 * MAX(pitWidth × islandRadius, lastRingRadius × 0.85) so callers that
 * position effects relative to the cap get the real value.
 */
export function bottomCapRadius(params: IslandBuildParams): number {
  const islandRadius = Math.min(params.halfWidth, params.halfDepth);
  const lastRingRadiusFrac = params.tiers > 0
    ? Math.pow(1 - params.tiers / (params.tiers + 1), params.taperCurve)
    : 1;
  const lastRingRadius = islandRadius * lastRingRadiusFrac;
  const minPitRadius = islandRadius * params.pitWidth;
  return Math.max(minPitRadius, lastRingRadius * 0.85);
}

/**
 * Returns the world-space Y depth of the bottom cap for given params.
 * (Positive value; subtract from island-top Y to get world Y.)
 */
export function bottomCapDepth(params: IslandBuildParams): number {
  const islandRadius = Math.min(params.halfWidth, params.halfDepth);
  return islandRadius * params.depth;
}
