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
//                  perimeter down to a small closing ring; each ring pair
//                  produces N quads, rock colour. The profile is a
//                  superellipse: r(t) = (1 - t^p)^(1/p) where p is
//                  derived from BLUNTNESS. This produces a smooth
//                  rounded-bottom teardrop with no visible seams.
//   BOTTOM FAN   — N triangles from the closing ring to a center vertex.
//                  The closing ring is small enough (5–50 % of baseR
//                  depending on BLUNTNESS) that the fan reads as an
//                  integrated rounded tip, not a glued-on cap.
//
// Triangle count (indexed, before toNonIndexed):
//   top cap      : sides
//   side wall    : 2 * sides
//   underside    : 2 * sides * (tiers + 1)
//   bottom fan   : sides
//   Total        : sides * (4 + 2*(tiers+1))  ≈ 12*(4+6) = 120
//                  (same count after toNonIndexed, 3× as many vertices)

import * as THREE from 'three';

export interface IslandBuildParams {
  sides: number;        // top polygon side count
  irregularity: number; // 0–0.5 radial jitter
  tiers: number;        // count of intermediate rings on the underside
  depth: number;        // total island depth as fraction of island radius
  halfWidth: number;    // bounds half-width (X)
  halfDepth: number;    // bounds half-depth (Z)
  seed: number;         // deterministic shape per bounds
  bluntness: number;    // 0–1: 0 = pointed teardrop tip, 1 = wide egg-like rounded base
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
 * Superellipse profile: r(t) = (1 - t^p)^(1/p), t ∈ [0, 1].
 *
 * At t=0 → r=1 (top perimeter).
 * At t=1 → r=0 (would be a perfect point; we clamp to tipFrac instead).
 *
 * The exponent p controls shape:
 *   p >> 1  : stays wide near the top, collapses fast near t=1 → pointy teardrop
 *   p = 1   : linear taper
 *   p < 1   : rounds off early → blunt egg bottom
 *
 * We map BLUNTNESS (0–1) to p via:
 *   p = 3.5 - 3.0 * bluntness
 *   bluntness=0 → p=3.5 (pointy)
 *   bluntness=0.5 → p=2.0 (smooth rounded teardrop)
 *   bluntness=1 → p=0.5 (wide egg, blunt bottom)
 */
function superellipseR(t: number, p: number): number {
  // Numerical safety: avoid negative base for fractional exponent.
  const base = Math.max(0, 1 - Math.pow(t, p));
  return Math.pow(base, 1 / p);
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
 * The underside is a single parameterized body: rings are generated with
 * radii following a superellipse profile r(t) = (1 - t^p)^(1/p), where
 * t is the depth fraction and p is derived from BLUNTNESS. The final ring
 * closes to a tiny center vertex via a fan. There is no separately-stitched
 * "bottom-cap ring" — the body just curves continuously to its close.
 */
export function buildIslandGeometry(
  params: IslandBuildParams,
  colors: IslandColors,
): THREE.BufferGeometry {
  const { sides, irregularity, tiers, depth, halfWidth, halfDepth, seed, bluntness } = params;

  const islandRadius = Math.min(halfWidth, halfDepth);
  const totalDepth = islandRadius * depth;

  // Superellipse exponent from bluntness.
  // bluntness=0 → p=3.5 (pointy tip), bluntness=1 → p=0.5 (wide egg).
  const p = 3.5 - 3.0 * Math.max(0, Math.min(1, bluntness));

  // Closing ring radius as fraction of islandRadius.
  // Grows with bluntness: bluntness=0 → 5%, bluntness=1 → 50%.
  // This ensures the bottom fan reads as an integrated rounded end rather
  // than a visible cap stuck onto a tapered body.
  const tipFrac = 0.05 + 0.45 * Math.max(0, Math.min(1, bluntness));

  // Top perimeter ring — perfectly at y=0.
  const topRing = buildTopPolygon(params);

  // ------------------------------------------------------------------ //
  // Build underside rings using the superellipse profile.               //
  // We generate (tiers + 1) rings:                                      //
  //   ring[0..tiers-1] = intermediate shrinking rings                   //
  //   ring[tiers]      = closing ring (radius = tipFrac * islandRadius) //
  //                                                                      //
  // Each ring:                                                           //
  //   - rotated by (π/sides) per step so facets stagger between rings   //
  //   - radius: superellipseR(depthFrac, p) × islandRadius              //
  //   - with small XZ noise so the silhouette reads angular/chunky      //
  // ------------------------------------------------------------------ //

  const noiseScale = islandRadius * irregularity * 0.18;
  const noiseRand = rng(seed ^ 0xdeadbeef);

  // Total rings to generate = tiers (intermediate) + 1 (closing).
  const totalRings = tiers + 1;
  const undersideRings: THREE.Vector3[][] = [];

  for (let t = 0; t < totalRings; t++) {
    // depthFrac: 0→1, linearly spaced across all rings.
    const depthFrac = (t + 1) / totalRings;
    const targetY = -totalDepth * depthFrac;

    // Radius fraction from the superellipse profile, clamped to tipFrac
    // for the closing ring so it never reaches zero.
    const isLastRing = t === totalRings - 1;
    const radiusFrac = isLastRing
      ? tipFrac
      : Math.max(tipFrac + 0.01, superellipseR(depthFrac, p));
    const ringRadius = islandRadius * radiusFrac;

    // Rotate each ring by half a "tooth" per step so vertices stagger.
    const rotation = (Math.PI / sides) * (t + 1);
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      const theta = (i / sides) * Math.PI * 2;
      // Build this ring's vertex at the superellipse radius, then rotate.
      const bx = Math.cos(theta) * ringRadius;
      const bz = -Math.sin(theta) * ringRadius;
      const rx = bx * cosR - bz * sinR;
      const rz = bx * sinR + bz * cosR;

      // Small XZ noise — scales down toward the closing ring so the tip
      // region is clean and doesn't cross adjacent vertices.
      const noiseFade = 1 - depthFrac * 0.6;
      const nx = (noiseRand() - 0.5) * 2 * noiseScale * noiseFade;
      const nz = (noiseRand() - 0.5) * 2 * noiseScale * noiseFade;

      ring.push(new THREE.Vector3(rx + nx, targetY, rz + nz));
    }
    undersideRings.push(ring);
  }

  // ------------------------------------------------------------------ //
  // Accumulate indexed geometry.                                         //
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
  const centerIdx = addVertex(new THREE.Vector3(0, 0, 0), grass, 1.0);
  const topIdx: number[] = topRing.map((v) => addVertex(v, grass, 1.0));
  for (let i = 0; i < sides; i++) {
    const a = topIdx[i]!;
    const b = topIdx[(i + 1) % sides]!;
    // CCW winding from above → normal points +Y.
    indices.push(centerIdx, a, b);
  }

  // ----- UNDERSIDE BODY -----
  // Stitch from the top perimeter ring down through each underside ring.
  // All underside faces use rock colour. AO decreases from ~0.85 at the
  // top edge down to ~0.42 at the closing ring.

  // allRings[0] = top perimeter re-indexed for rock color.
  // allRings[1..totalRings] = underside rings.
  const allRingIdx: number[][] = [];

  const topRockIdx: number[] = topRing.map((v) => addVertex(v, rock, 0.85));
  allRingIdx.push(topRockIdx);

  for (let t = 0; t < undersideRings.length; t++) {
    const depthFrac = (t + 1) / totalRings;
    const ao = 0.85 - 0.43 * depthFrac; // 0.85 at top → 0.42 at last ring
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
      indices.push(tl, bl, br);
      indices.push(tl, br, tr);
    }
  }

  // ----- BOTTOM FAN -----
  // Close the closing ring to a single center vertex. Reversed winding so
  // the fan's normal points DOWN (−Y), giving it the correct face direction
  // when viewed from below. The closing ring radius is small (tipFrac ×
  // islandRadius) so this fan reads as the natural rounded tip of the body.
  const closingY = -totalDepth;
  const bottomCenter = addVertex(new THREE.Vector3(0, closingY, 0), rock, 0.42);
  const closingRingIdx = allRingIdx[allRingIdx.length - 1]!;
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    // Reversed winding: bottomCenter, next, current → normal points −Y.
    indices.push(bottomCenter, closingRingIdx[j]!, closingRingIdx[i]!);
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
 * Returns the effective bottom tip radius for the given params.
 * Used by callers (e.g. islandMesh, underglow core, shadow disc) so they
 * stay in sync with the actual bottom geometry without reaching into
 * internal constants.
 *
 * The closing ring radius = tipFrac × islandRadius, where
 * tipFrac = 0.05 + 0.45 × bluntness.
 */
export function bottomCapRadius(params: IslandBuildParams): number {
  const islandRadius = Math.min(params.halfWidth, params.halfDepth);
  const tipFrac = 0.05 + 0.45 * Math.max(0, Math.min(1, params.bluntness));
  return islandRadius * tipFrac;
}

/**
 * Returns the world-space Y depth of the bottom cap for given params.
 * (Positive value; subtract from island-top Y to get world Y.)
 */
export function bottomCapDepth(params: IslandBuildParams): number {
  const islandRadius = Math.min(params.halfWidth, params.halfDepth);
  return islandRadius * params.depth;
}
