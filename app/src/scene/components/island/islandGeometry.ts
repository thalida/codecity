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
//   GRASS BAND   — vertical N quads from y=0 to y=-grassBand, grass colour
//                  (only emitted when GRASS_THICKNESS > 0)
//   UNDERSIDE    — (tiers+1) rings that shrink and deepen from the grass-
//                  bottom perimeter (y=-grassBand) to a single pit vertex;
//                  each ring pair produces N quads, rock colour
//   PIT FAN      — N triangles from the last ring to the pit vertex
//
// Triangle count (indexed, before toNonIndexed):
//   top cap     : sides
//   grass band  : 2 * sides  (when GRASS_THICKNESS > 0)
//   underside   : 2 * sides * (tiers + 1)
//   pit fan     : sides
//   Total       : sides * (4 + 2*(tiers+1)) + (2*sides if grass)
//                 ≈ 12*(4+6)=120 base → +24 grass → 144 triangles indexed
//                 after toNonIndexed (same count, 3× as many vertices).

import * as THREE from 'three';

export interface IslandBuildParams {
  sides: number; // top polygon side count
  irregularity: number; // 0–0.5 radial jitter
  tiers: number; // count of intermediate rings on the underside
  depth: number; // total island depth as fraction of island radius
  halfWidth: number; // bounds half-width (X)
  halfDepth: number; // bounds half-depth (Z)
  seed: number; // deterministic shape per bounds
  roundness: number; // 0–1; maps to taperExponent = 2.0 - roundness*1.93
  grassThickness: number; // 0–0.1; vertical grass band as fraction of island radius
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
  // Polygon parameterisation: ellipse with separate X and Z axes (matches
  // the city's aspect ratio — square city → circle, elongated city → oval).
  //
  // Three corrections give the polygon room to fully contain the bounds
  // rect — including the rect's CORNERS:
  //
  // 1. Scale the ellipse axes by sqrt(2) so the rect corner at
  //    (halfWidth, halfDepth) sits exactly on the unjittered ellipse
  //    boundary. Mathematical minimum for an ellipse with this aspect
  //    ratio to contain the rect.
  //
  // 2. Scale further by 1/cos(π/N) so the polygon's CHORD edges (which
  //    bow inward between vertices) still reach the ellipse boundary.
  //
  // 3. Jitter is ADDITIVE — vertices only push OUTWARD from the
  //    minimum-bounding silhouette. Subtractive jitter (the previous
  //    behavior) could pull vertices inside the bounds rect at higher
  //    irregularity values, exposing city corners as buildings/streets
  //    floating off the island edge into black space. With additive
  //    jitter the bounds rect stays fully contained at any irregularity.
  const cornerCorrection = Math.SQRT2;
  const edgeCorrection = 1 / Math.cos(Math.PI / sides);
  const baseScale = cornerCorrection * edgeCorrection;
  const aX = halfWidth * baseScale;
  const aZ = halfDepth * baseScale;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    const jitter = 1 + irregularity * rand();
    pts.push(new THREE.Vector3(Math.cos(theta) * aX * jitter, 0, -Math.sin(theta) * aZ * jitter));
  }
  return pts;
}

export interface IslandColors {
  GRASS: string;
  GRASS_SIDE: string;
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
  colors: IslandColors
): THREE.BufferGeometry {
  const {
    sides,
    irregularity,
    tiers,
    depth,
    halfWidth,
    halfDepth,
    seed,
    roundness,
    grassThickness,
  } = params;

  // Use the LONGEST oval axis as the reference for vertical island depth.
  // Previously Math.min was used, which made elongated cities (long X,
  // short Z) get a very shallow underside — disproportionate to the
  // island's horizontal extent. With max(), depth scales with the
  // visually-dominant dimension.
  const islandRadius = Math.max(halfWidth, halfDepth);
  const totalDepth = islandRadius * depth;

  // Higher ROUNDNESS → lower exponent → more bowl-like body.
  // Lower ROUNDNESS → higher exponent → more pointed taper.
  // At ROUNDNESS=0.7 → exp = 2.0 - 0.7*1.93 ≈ 0.649 ≈ the previous hardcoded 0.65.
  const taperExponent = 2.0 - roundness * 1.93;

  // Grass band: vertical wall from y=0 down to y=-grassBand.
  const grassBand = islandRadius * grassThickness;

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

    // Radius: smoothly taper from ~topRing radius down toward 0.
    // We use a slight exponential bias so later rings shrink faster,
    // giving the inverted-mountain silhouette (wide body, pointed tip).
    const radiusFrac = Math.pow(1 - frac, taperExponent); // 1→0 with curved profile

    // Depth: start deep quickly (convex underside, not a flat ledge).
    const depthFrac = Math.pow(frac, 0.8);

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

  const pitPos = new THREE.Vector3(0, -totalDepth, 0);

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
  const grassSide = new THREE.Color(colors.GRASS_SIDE);
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

  // ----- GRASS BAND (vertical wall from y=0 to y=-grassBand) -----
  // Only emitted when grassBand > 0. Two grass-coloured rings:
  //   grassTopIdx  — same XZ as topRing, at y=0  (grass colour)
  //   grassBotIdx  — same XZ as topRing, at y=-grassBand (grass colour)
  // These N quads form the visible green band wrapping the island top edge.
  let grassBotRing: THREE.Vector3[];
  if (grassBand > 0) {
    grassBotRing = topRing.map((v) => new THREE.Vector3(v.x, -grassBand, v.z));
    // Side band uses GRASS_SIDE so the user can tune it independently of
    // the top cap (top points up, side points outward — they get very
    // different hemispheric lighting).
    const grassTopIdx: number[] = topRing.map((v) => addVertex(v, grassSide, 1.0));
    const grassBotIdx: number[] = grassBotRing.map((v) => addVertex(v, grassSide, 0.9));
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const tl = grassTopIdx[i]!;
      const tr = grassTopIdx[j]!;
      const bl = grassBotIdx[i]!;
      const br = grassBotIdx[j]!;
      // Outward-facing quads (normals point away from island centre).
      indices.push(tl, bl, br);
      indices.push(tl, br, tr);
    }
  } else {
    grassBotRing = topRing; // zero thickness — band collapses to top ring
  }

  // ----- UNDERSIDE BODY -----
  // Stitch from the grass-bottom perimeter ring down through each intermediate
  // ring, then fan from the last ring to the pit vertex.
  //
  // All underside faces use rock colour. AO decreases from ~0.85 at the
  // top edge down to ~0.45 at the pit, giving a subtle depth cue.
  //
  // The underside starts at y=-grassBand (not y=0) so the grass band and the
  // rock body meet cleanly without a gap.

  // Build the underside vertex index arrays.
  // allRings[0] = grass-bottom ring (re-indexed for rock color at y=-grassBand).
  // allRings[1..tiers] = intermediate rings.
  // Then pit vertex.
  const allRingIdx: number[][] = [];

  // Grass-bottom perimeter re-indexed with rock color + AO for the underside.
  // Shift down by a tiny FIXED epsilon (not scaled with island size — that
  // made the gap visible on large cities) so the underside's top edge
  // doesn't sit at EXACTLY the same Y as the grass band's bottom edge.
  // Without the shift, both surfaces rasterise to identical depth values
  // at the seam and z-fight; with too large a shift, the gap shows. 0.05 wu
  // is enough to break the depth tie at city scale (depth-buffer precision
  // resolves sub-unit differences) while staying sub-pixel visually.
  const SEAM_EPSILON = 0.05;
  // Ambient occlusion baked into vertex alpha. The underside darkens
  // with depth — top edge sits flush against the lit grass band so it
  // stays bright; the deepest ring is mostly shadowed. UNDERSIDE_AO_TOP
  // is reused for the very top rock vertices so the seam edge matches
  // the band immediately below it without a luminance pop.
  const UNDERSIDE_AO_TOP = 0.85; // brightest underside vertex
  const UNDERSIDE_AO_RANGE = 0.4; // top - bottom AO span
  // Resulting AO at the deepest ring: UNDERSIDE_AO_TOP - UNDERSIDE_AO_RANGE = 0.45

  const topRockIdx: number[] = grassBotRing.map((v) =>
    addVertex(new THREE.Vector3(v.x, v.y - SEAM_EPSILON, v.z), rock, UNDERSIDE_AO_TOP)
  );
  allRingIdx.push(topRockIdx);

  for (let t = 0; t < undersideRings.length; t++) {
    const frac = (t + 1) / (tiers + 1);
    const ao = UNDERSIDE_AO_TOP - UNDERSIDE_AO_RANGE * frac;
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

  // Fan from the last ring to the pit vertex.
  const lastRingIdx = allRingIdx[allRingIdx.length - 1]!;
  const pitIdx = addVertex(pitPos, rock, 0.45);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const a = lastRingIdx[i]!;
    const b = lastRingIdx[j]!;
    // Winding: (a, pitIdx, b) gives a face normal with -Y component
    // (outward-facing downward) for the very bottom faces.
    indices.push(a, pitIdx, b);
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
export function pointInIslandPolygon(px: number, pz: number, polygon: THREE.Vector3[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x,
      zi = polygon[i]!.z;
    const xj = polygon[j]!.x,
      zj = polygon[j]!.z;
    const intersects = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
