// city/components/island/islandGeometry.ts — the floating island mesh, built as
// one indexed geometry then toNonIndexed + computeVertexNormals: every triangle
// owns its vertices, so each gets a pure face normal and the low-poly ridges
// stay crisp. Y descends from 0: top cap, grass band, underside rings, pit fan.

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

/** The top silhouette around the (halfWidth, halfDepth) rect: CCW on XZ at
 *  y=0, with the mesh's own Y offset left to the caller. */
export function buildTopPolygon(params: IslandBuildParams): THREE.Vector3[] {
  const { sides, irregularity, halfWidth, halfDepth, seed } = params;
  const rand = rng(seed);
  // Two corrections put the bounds rect inside the polygon: sqrt(2) for its
  // corners, 1/cos(π/N) for the inward-bowing chords. Jitter only ever adds.
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

/** The whole island. The cap holds y=0 for the city; the underside fans through
 *  shrinking rings to one pit vertex, which is the inverted-mountain shape. */
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

  // The longest axis, so depth follows the dimension the eye reads: min() left
  // an elongated city sitting on a disc.
  const islandRadius = Math.max(halfWidth, halfDepth);
  const totalDepth = islandRadius * depth;

  // Lower exponent bowls the body out, higher one points it.
  const taperExponent = 2.0 - roundness * 1.93;

  // Grass band: vertical wall from y=0 down to y=-grassBand.
  const grassBand = islandRadius * grassThickness;

  // Top perimeter ring — perfectly at y=0.
  const topRing = buildTopPolygon(params);

  // Rings shrink, deepen, and rotate half a tooth off the one above so facets
  // angle. XZ noise only: Y noise made the tiers read as stacked layers.
  const undersideRings: THREE.Vector3[][] = [];

  const noiseScale = islandRadius * irregularity * 0.18;
  const noiseRand = rng(seed ^ 0xdeadbeef);

  for (let t = 0; t < tiers; t++) {
    const frac = (t + 1) / (tiers + 1); // 0 < frac < 1

    // Later rings shrink faster: wide body, pointed tip.
    const radiusFrac = Math.pow(1 - frac, taperExponent); // 1→0 with curved profile

    // Deep quickly, so the underside is convex rather than a ledge.
    const depthFrac = Math.pow(frac, 0.8);

    const targetY = -totalDepth * depthFrac;
    // Rotate each ring by half a "tooth" so vertices stagger between rings.
    const rotation = (Math.PI / sides) * (t + 1);
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      // Staggered against the ring above, so each quad is an angled facet.
      const topV = topRing[i]!;
      const baseX = topV.x * radiusFrac;
      const baseZ = topV.z * radiusFrac;
      const rx = baseX * cosR - baseZ * sinR;
      const rz = baseX * sinR + baseZ * cosR;

      // XZ only: the ring has to hold one depth or it reads as a ledge.
      const nx = (noiseRand() - 0.5) * 2 * noiseScale * (1 - frac * 0.5);
      const nz = (noiseRand() - 0.5) * 2 * noiseScale * (1 - frac * 0.5);

      ring.push(new THREE.Vector3(rx + nx, targetY, rz + nz));
    }
    undersideRings.push(ring);
  }

  const pitPos = new THREE.Vector3(0, -totalDepth, 0);

  const positions: number[] = [];
  const colorsArr: number[] = [];
  const aoArr: number[] = [];
  // Which material a vertex belongs to, so the shader can texture grass and
  // rock differently: the top cap and its band are grass, everything below rock.
  const surfaceArr: number[] = [];
  const indices: number[] = [];

  const grass = new THREE.Color(colors.GRASS);
  const grassSide = new THREE.Color(colors.GRASS_SIDE);
  const rock = new THREE.Color(colors.ROCK);

  // Push a vertex; return its index.
  function addVertex(p: THREE.Vector3, c: THREE.Color, ao: number, surface: number): number {
    const idx = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    colorsArr.push(c.r, c.g, c.b);
    aoArr.push(ao);
    surfaceArr.push(surface);
    return idx;
  }

  const SURFACE_ROCK = 0;
  const SURFACE_GRASS = 1;

  // Top cap: a fan at y=0, unoccluded, since the city stands on it.
  const centerIdx = addVertex(new THREE.Vector3(0, 0, 0), grass, 1.0, SURFACE_GRASS);
  const topIdx: number[] = topRing.map((v) => addVertex(v, grass, 1.0, SURFACE_GRASS));
  for (let i = 0; i < sides; i++) {
    const a = topIdx[i]!;
    const b = topIdx[(i + 1) % sides]!;
    // CCW winding from above → normal points +Y.
    indices.push(centerIdx, a, b);
  }

  // The green band wrapping the top edge: a vertical wall down to -grassBand.
  let grassBotRing: THREE.Vector3[];
  if (grassBand > 0) {
    grassBotRing = topRing.map((v) => new THREE.Vector3(v.x, -grassBand, v.z));
    // Its own colour: this face points outward and the cap points up, so
    // hemispheric lighting hits them completely differently.
    const grassTopIdx: number[] = topRing.map((v) => addVertex(v, grassSide, 1.0, SURFACE_GRASS));
    const grassBotIdx: number[] = grassBotRing.map((v) =>
      addVertex(v, grassSide, 0.9, SURFACE_GRASS)
    );
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

  // The rock body, stitched from the band's bottom ring (not from y=0, or the
  // two leave a gap) down to the pit.
  const allRingIdx: number[][] = [];

  // Breaks the depth tie at the seam without opening a visible gap. Fixed, not
  // scaled with the island: scaled, it showed as a gap on large cities.
  const SEAM_EPSILON = 0.05;
  // Occlusion baked into vertex alpha: bright where the rock meets the lit band
  // so the seam doesn't pop, shadowed by the pit.
  const UNDERSIDE_AO_TOP = 0.85;
  const UNDERSIDE_AO_RANGE = 0.4;

  const topRockIdx: number[] = grassBotRing.map((v) =>
    addVertex(new THREE.Vector3(v.x, v.y - SEAM_EPSILON, v.z), rock, UNDERSIDE_AO_TOP, SURFACE_ROCK)
  );
  allRingIdx.push(topRockIdx);

  for (let t = 0; t < undersideRings.length; t++) {
    const frac = (t + 1) / (tiers + 1);
    const ao = UNDERSIDE_AO_TOP - UNDERSIDE_AO_RANGE * frac;
    const ring = undersideRings[t]!;
    const ringIdx: number[] = ring.map((v) => addVertex(v, rock, ao, SURFACE_ROCK));
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
      // Wound CCW from outside, so the normals point away from the centre.
      indices.push(tl, bl, br);
      indices.push(tl, br, tr);
    }
  }

  // Fan from the last ring to the pit vertex.
  const lastRingIdx = allRingIdx[allRingIdx.length - 1]!;
  const pitIdx = addVertex(pitPos, rock, 0.45, SURFACE_ROCK);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const a = lastRingIdx[i]!;
    const b = lastRingIdx[j]!;
    // Wound so the bottom faces point outward and down.
    indices.push(a, pitIdx, b);
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setIndex(indices);
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  indexed.setAttribute('color', new THREE.Float32BufferAttribute(colorsArr, 3));
  indexed.setAttribute('ao', new THREE.Float32BufferAttribute(aoArr, 1));
  indexed.setAttribute('aSurface', new THREE.Float32BufferAttribute(surfaceArr, 1));

  // Unsharing the vertices is what makes computeVertexNormals produce a pure
  // face normal per triangle instead of averaging across neighbours.
  const geom = indexed.toNonIndexed();
  geom.computeVertexNormals();

  indexed.dispose();
  return geom;
}

/** Ray-casting point-in-polygon over an XZ loop, winding-agnostic. */
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
