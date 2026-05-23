// scene/island/islandGeometry.ts — Procedural builder for the floating
// island mesh. Generates a closed indexed BufferGeometry consisting of:
//   - a top cap polygon (grass surface)
//   - a grass-side band (thin grass lip wrapping the top edge)
//   - a cliff side band (rock, with noisy bottom edge)
//   - N tier rings (chunky rock, each smaller and rotated per tier)
//   - a bottom cap (blunt cluster)
//
// Vertex colors and ambient-occlusion attributes are baked at build time.
// Per-face normals are computed manually so adjacent triangles of the
// same logical "face" stay flat-shaded for the low-poly look.

import * as THREE from 'three';

export interface IslandBuildParams {
  sides: number;        // top polygon side count
  irregularity: number; // 0–0.5 radial jitter
  tiers: number;        // count of underside tier rings
  depth: number;        // total island depth as fraction of island radius
  halfWidth: number;    // bounds half-width (X)
  halfDepth: number;    // bounds half-depth (Z)
  seed: number;         // deterministic shape per bounds
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
  // Base radius circumscribes the bounds rectangle: every point of the
  // rect (including corners at distance hypot(halfWidth, halfDepth)) is
  // guaranteed to lie inside the polygon. Jitter only shrinks vertices
  // inward, so the polygon never grows past baseR.
  const baseR = Math.hypot(halfWidth, halfDepth);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    // Jitter range: [1 - irregularity, 1] (only shrinks, never grows past
    // baseR — keeps the polygon inscribed).
    const jitter = 1 - irregularity * rand();
    const r = baseR * jitter;
    pts.push(new THREE.Vector3(Math.cos(theta) * r, 0, -Math.sin(theta) * r));
  }
  return pts;
}

// Per-tier shrink + depth-fraction tables. Indexed by tier (0 = topmost
// tier ring, just below the cliff side band). Length must be ≥ max TIERS.
// Larger steps between tiers → more angular silhouette (reads chunkier).
const TIER_SHRINK = [0.78, 0.50, 0.28, 0.12];
const TIER_DEPTH_FRAC = [0.35, 0.65, 0.85, 1.0]; // cumulative fraction of total DEPTH

/**
 * Build TIERS rings below a starting ring. Each ring chains from the PREVIOUS
 * ring (startRing → tier 0 → tier 1 → ... → tier N-1), with shrink + noise
 * applied at each level. This eliminates seams: the first tier inherits the
 * noisy cliff-bottom shape directly rather than starting from the clean top
 * polygon.
 *
 * @param startRing  The ring to chain from (e.g. cliffBotPositions).
 * @param params     Island build params.
 */
export function buildTierRings(
  startRing: THREE.Vector3[],
  params: IslandBuildParams,
): THREE.Vector3[][] {
  const { tiers, depth, halfWidth, halfDepth, irregularity, seed } = params;
  const islandRadius = Math.min(halfWidth, halfDepth);
  const totalDepth = islandRadius * depth;
  const rand = rng(seed ^ 0xa5a5a5a5); // distinct stream from top jitter
  const tierJitter = irregularity * 0.6;
  const noiseScale = islandRadius * irregularity * 0.25;
  const noiseRand = rng(seed ^ 0xfeedface);

  const rings: THREE.Vector3[][] = [];
  let prevRing = startRing;
  for (let t = 0; t < tiers; t++) {
    const shrink = TIER_SHRINK[t] ?? TIER_SHRINK[TIER_SHRINK.length - 1]!;
    const depthFrac = TIER_DEPTH_FRAC[t] ?? TIER_DEPTH_FRAC[TIER_DEPTH_FRAC.length - 1]!;
    const targetY = -totalDepth * depthFrac;
    // Small per-tier angular offset so tier vertices don't align radially.
    // Adjacent tier facets meet at angles → chunkier, more faceted silhouette.
    const tierRotation = (t + 1) * (Math.PI / startRing.length) * 0.75;
    const cos = Math.cos(tierRotation);
    const sin = Math.sin(tierRotation);
    const ring: THREE.Vector3[] = [];
    for (const v of prevRing) {
      // Shrink from the PREVIOUS ring's position (not from the top).
      const j = 1 - tierJitter * rand();
      const sx = v.x * shrink * j;
      const sz = v.z * shrink * j;
      // Per-tier rotation in XZ.
      const rx = sx * cos - sz * sin;
      const rz = sx * sin + sz * cos;
      // 3D noise displacement.
      const nx = (noiseRand() - 0.5) * 2 * noiseScale;
      const ny = (noiseRand() - 0.5) * 2 * noiseScale * 0.6;
      const nz = (noiseRand() - 0.5) * 2 * noiseScale;
      ring.push(new THREE.Vector3(rx + nx, targetY + ny, rz + nz));
    }
    rings.push(ring);
    prevRing = ring;
  }
  return rings;
}

export interface IslandColors {
  GRASS: string;
  ROCK: string;
}

const GRASS_SIDE_FRAC_OF_DEPTH = 0.03; // thin grass lip wrapping the top edge
const SIDE_FRAC_OF_DEPTH = 0.30;       // cliff side band height (measured from top, including grass)

/**
 * Build the complete island as one closed indexed BufferGeometry.
 *
 * Layout (Y descends):
 *   y=0                — top cap (grass)
 *   y=-grassSideHeight — thin grass lip (grass wraps the top edge)
 *   y=-sideHeight      — cliff side band (rock, noisy bottom edge)
 *   tier 0 ring        — rock (chunky)
 *   tier N-1 ring      — rock (chunky)
 *   bottom cap         — blunt cluster (rock)
 *
 * Per-vertex colors are baked into the `color` attribute. A separate
 * `ao` scalar attribute (1.0 → fully lit, ~0.4 → tucked crevice) is
 * baked too; the island shader multiplies it into the fragment color.
 *
 * Per-face normals are computed by triangulating and calling
 * computeVertexNormals, then welding adjacent triangles of the same
 * logical face by not sharing vertices across face groups.
 */
export function buildIslandGeometry(
  params: IslandBuildParams,
  colors: IslandColors,
): THREE.BufferGeometry {
  const top = buildTopPolygon(params);
  const islandRadius = Math.min(params.halfWidth, params.halfDepth);
  const totalDepth = islandRadius * params.depth;
  const grassSideHeight = totalDepth * GRASS_SIDE_FRAC_OF_DEPTH;
  // sideHeight is the total Y extent from y=0 down to the bottom of the cliff
  // band. It encompasses the grass lip + cliff rock band.
  const sideHeight = totalDepth * SIDE_FRAC_OF_DEPTH;

  const bottomY = -totalDepth;

  // Build vertex pools per face group. We DO NOT share vertices across
  // groups so each face group gets its own normals (flat-shading per
  // face group, not per triangle).
  const positions: number[] = [];
  const colorsArr: number[] = [];
  const aoArr: number[] = [];
  const indices: number[] = [];

  const grass = new THREE.Color(colors.GRASS);
  const rock = new THREE.Color(colors.ROCK);

  function pushVert(p: THREE.Vector3, c: THREE.Color, ao: number): number {
    const idx = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    colorsArr.push(c.r, c.g, c.b);
    aoArr.push(ao);
    return idx;
  }

  // ----- TOP CAP (grass) -----
  // Center vertex + fan to perimeter. AO=1.0 throughout.
  const topCenter = pushVert(new THREE.Vector3(0, 0, 0), grass, 1.0);
  const topRingIdx = top.map((v) => pushVert(v, grass, 1.0));
  for (let i = 0; i < params.sides; i++) {
    const a = topRingIdx[i]!;
    const b = topRingIdx[(i + 1) % params.sides]!;
    indices.push(topCenter, a, b);
  }

  // ----- GRASS SIDE BAND (thin grass lip wrapping the top edge) -----
  // Visible from any side angle — 3% of island depth is still green.
  // Each quad gets its own 4 vertices so computeVertexNormals produces a
  // single face normal per quad (true flat shading, sharp angle to neighbors).
  const grassBotPositions = top.map((v) => new THREE.Vector3(v.x, -grassSideHeight, v.z));
  for (let i = 0; i < params.sides; i++) {
    const j = (i + 1) % params.sides;
    const tl = pushVert(top[i]!, grass, 0.92);
    const bl = pushVert(grassBotPositions[i]!, grass, 0.85);
    const br = pushVert(grassBotPositions[j]!, grass, 0.85);
    const tr = pushVert(top[j]!, grass, 0.92);
    indices.push(tl, bl, br);
    indices.push(tl, br, tr);
  }

  // ----- SIDE CLIFF BAND -----
  // From grass lip bottom down to sideHeight (rock). The cliff BOTTOM edge
  // gets 3D noise displacement so the band reads as irregular and chunky
  // rather than a clean cylinder. Top edge (where it meets grass) stays clean.
  // Per-quad vertices for flat shading.
  const noiseScale = islandRadius * params.irregularity * 0.25;
  const cliffNoise = rng(params.seed ^ 0x7eadbeef); // fresh seeded PRNG, distinct stream
  const cliffBotPositions = top.map((v) => new THREE.Vector3(
    v.x + (cliffNoise() - 0.5) * 2 * noiseScale,
    -sideHeight + (cliffNoise() - 0.5) * 2 * noiseScale * 0.4,
    v.z + (cliffNoise() - 0.5) * 2 * noiseScale,
  ));
  for (let i = 0; i < params.sides; i++) {
    const j = (i + 1) % params.sides;
    const tl = pushVert(grassBotPositions[i]!, rock, 0.75);
    const bl = pushVert(cliffBotPositions[i]!, rock, 0.65);
    const br = pushVert(cliffBotPositions[j]!, rock, 0.65);
    const tr = pushVert(grassBotPositions[j]!, rock, 0.75);
    indices.push(tl, bl, br);
    indices.push(tl, br, tr);
  }

  // Chain tier rings from cliff bottom so the entire brown body below the
  // grass is one continuous noisy taper with no seams.
  const rings = buildTierRings(cliffBotPositions, params);

  // Bottom cap chains from the last tier ring (shrunk + noised) — same
  // chaining principle so there's no seam at the bottom either.
  const bottomCapShrink = 0.55;
  const bottomNoise = rng(params.seed ^ 0x5a5a5a5a);
  const lastTierRing = rings[params.tiers - 1]!;
  const bottomRing: THREE.Vector3[] = lastTierRing.map((v) => new THREE.Vector3(
    v.x * bottomCapShrink + (bottomNoise() - 0.5) * 2 * (islandRadius * params.irregularity * 0.25),
    bottomY + (bottomNoise() - 0.5) * 2 * (islandRadius * params.irregularity * 0.25 * 0.3),
    v.z * bottomCapShrink + (bottomNoise() - 0.5) * 2 * (islandRadius * params.irregularity * 0.25),
  ));

  // ----- TIER BANDS -----
  // From cliff bottom to bottom-cap edge, stitched through each tier ring.
  // Single unified rock color — per-face lighting provides all visual variation.
  // AO deepens slightly in tier-ring crevices. Per-quad vertices for flat shading.
  let bandTopPositions = cliffBotPositions;
  for (let t = 0; t < params.tiers; t++) {
    const ring = rings[t]!;
    // AO deepens in tier-ring crevices.
    const lerpT = params.tiers === 1 ? 1 : t / (params.tiers - 1);
    const ao = 0.55 - 0.15 * lerpT;
    for (let i = 0; i < params.sides; i++) {
      const j = (i + 1) % params.sides;
      // Each quad gets its own 4 vertices so computeVertexNormals produces
      // a single face normal per quad (true flat shading, sharp angle to
      // adjacent quads).
      const tl = pushVert(bandTopPositions[i]!, rock, ao + 0.08);
      const bl = pushVert(ring[i]!, rock, ao);
      const br = pushVert(ring[j]!, rock, ao);
      const tr = pushVert(bandTopPositions[j]!, rock, ao + 0.08);
      indices.push(tl, bl, br);
      indices.push(tl, br, tr);
    }
    bandTopPositions = ring;
  }

  // ----- BOTTOM CAP -----
  // Stitch from last tier ring to bottomRing (per-quad vertices for flat shading).
  // Bottom-cap fan stays as-is — adjacent triangles in the fan are coplanar.
  const bottomEdgeAO = 0.35;
  const lastTier = rings[params.tiers - 1]!;
  for (let i = 0; i < params.sides; i++) {
    const j = (i + 1) % params.sides;
    const tl = pushVert(lastTier[i]!, rock, bottomEdgeAO + 0.05);
    const bl = pushVert(bottomRing[i]!, rock, bottomEdgeAO);
    const br = pushVert(bottomRing[j]!, rock, bottomEdgeAO);
    const tr = pushVert(lastTier[j]!, rock, bottomEdgeAO + 0.05);
    indices.push(tl, bl, br);
    indices.push(tl, br, tr);
  }
  // Bottom-cap fan (closes the mesh). Adjacent fan triangles are coplanar so
  // computeVertexNormals gives the correct flat -Y normal without vertex duplication.
  const bottomRingIdx = bottomRing.map((v) => pushVert(v, rock, bottomEdgeAO));
  const bottomCenter = pushVert(new THREE.Vector3(0, bottomY, 0), rock, bottomEdgeAO);
  for (let i = 0; i < params.sides; i++) {
    const a = bottomRingIdx[i]!;
    const b = bottomRingIdx[(i + 1) % params.sides]!;
    // Reversed winding so bottom-cap normal points -Y.
    indices.push(bottomCenter, b, a);
  }

  const geom = new THREE.BufferGeometry();
  geom.setIndex(indices);
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colorsArr, 3));
  geom.setAttribute('ao', new THREE.Float32BufferAttribute(aoArr, 1));
  geom.computeVertexNormals();
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
 * internal tier-shrink constants.
 */
export function bottomCapRadius(params: IslandBuildParams): number {
  const islandRadius = Math.min(params.halfWidth, params.halfDepth);
  const lastTierShrink = TIER_SHRINK[params.tiers - 1] ?? TIER_SHRINK[TIER_SHRINK.length - 1]!;
  return islandRadius * lastTierShrink * 0.6;
}

/**
 * Returns the world-space Y depth of the bottom cap for given params.
 * (Positive value; subtract from island-top Y to get world Y.)
 */
export function bottomCapDepth(params: IslandBuildParams): number {
  const islandRadius = Math.min(params.halfWidth, params.halfDepth);
  return islandRadius * params.depth;
}
