// scene/island/islandGeometry.ts — Procedural builder for the floating
// island mesh. Generates a closed indexed BufferGeometry consisting of:
//   - a top cap polygon (grass surface)
//   - a soil-lip ring just below the top
//   - a side band (cliff rock)
//   - N tier rings (chunky rock, each smaller than the one above)
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
const TIER_SHRINK = [0.82, 0.55, 0.32, 0.18];
const TIER_DEPTH_FRAC = [0.35, 0.65, 0.85, 1.0]; // cumulative fraction of total DEPTH

/**
 * Build TIERS rings below the top polygon. Each ring has the same vertex
 * count as the top, shrunk inward by per-tier factor and dropped in Y.
 * Includes a small per-vertex jitter (driven by IRREGULARITY × 0.4) to
 * keep the tiers chunky rather than mathematically clean.
 */
export function buildTierRings(
  top: THREE.Vector3[],
  params: IslandBuildParams,
): THREE.Vector3[][] {
  const { tiers, depth, halfWidth, halfDepth, irregularity, seed } = params;
  const islandRadius = Math.min(halfWidth, halfDepth);
  const totalDepth = islandRadius * depth;
  const rand = rng(seed ^ 0xa5a5a5a5); // distinct stream from top jitter
  const tierJitter = irregularity * 0.4;

  const rings: THREE.Vector3[][] = [];
  for (let t = 0; t < tiers; t++) {
    const shrink = TIER_SHRINK[t] ?? TIER_SHRINK[TIER_SHRINK.length - 1]!;
    const depthFrac = TIER_DEPTH_FRAC[t] ?? TIER_DEPTH_FRAC[TIER_DEPTH_FRAC.length - 1]!;
    const ring: THREE.Vector3[] = [];
    for (const v of top) {
      const j = 1 - tierJitter * rand();
      ring.push(new THREE.Vector3(v.x * shrink * j, -totalDepth * depthFrac, v.z * shrink * j));
    }
    rings.push(ring);
  }
  return rings;
}

export interface IslandColors {
  GRASS: string;
  SOIL: string;
  ROCK_LIGHT: string;
  ROCK_MID: string;
  ROCK_DARK: string;
}

const SOIL_FRAC_OF_DEPTH = 0.03; // soil lip band height as fraction of total island depth
const SIDE_FRAC_OF_DEPTH = 0.30; // cliff side band height

/**
 * Build the complete island as one closed indexed BufferGeometry.
 *
 * Layout (Y descends):
 *   y=0                 — top cap (grass)
 *   y=-soilHeight        — soil-lip ring
 *   y=-sideHeight        — start of cliff side band (rock_light)
 *   tier 0 ring          — rock_mid (chunky)
 *   tier N-1 ring        — rock_dark (chunky)
 *   bottom cap           — blunt cluster (rock_dark)
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
  const rings = buildTierRings(top, params);
  const islandRadius = Math.min(params.halfWidth, params.halfDepth);
  const totalDepth = islandRadius * params.depth;
  const soilHeight = totalDepth * SOIL_FRAC_OF_DEPTH;
  const sideHeight = totalDepth * SIDE_FRAC_OF_DEPTH;

  // Bottom cap: small offset polygon (NOT a single point).
  const bottomShrink = (TIER_SHRINK[params.tiers - 1] ?? 0.3) * 0.6;
  const bottomY = -totalDepth;
  const bottomRing: THREE.Vector3[] = top.map(
    (v) => new THREE.Vector3(v.x * bottomShrink, bottomY, v.z * bottomShrink),
  );

  // Build vertex pools per face group. We DO NOT share vertices across
  // groups so each face group gets its own normals (flat-shading per
  // face group, not per triangle).
  const positions: number[] = [];
  const colorsArr: number[] = [];
  const aoArr: number[] = [];
  const indices: number[] = [];

  const grass = new THREE.Color(colors.GRASS);
  const soil = new THREE.Color(colors.SOIL);
  const rockLight = new THREE.Color(colors.ROCK_LIGHT);
  const rockMid = new THREE.Color(colors.ROCK_MID);
  const rockDark = new THREE.Color(colors.ROCK_DARK);

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

  // ----- SOIL LIP BAND -----
  // Narrow band between top cap and side cliff.
  const soilTopIdx = top.map((v) => pushVert(v, soil, 0.9));
  const soilBotPositions = top.map((v) => new THREE.Vector3(v.x, -soilHeight, v.z));
  const soilBotIdx = soilBotPositions.map((v) => pushVert(v, soil, 0.85));
  for (let i = 0; i < params.sides; i++) {
    const j = (i + 1) % params.sides;
    indices.push(soilTopIdx[i]!, soilBotIdx[i]!, soilBotIdx[j]!);
    indices.push(soilTopIdx[i]!, soilBotIdx[j]!, soilTopIdx[j]!);
  }

  // ----- SIDE CLIFF BAND -----
  // From soil-lip bottom down to first tier ring. Uses ROCK_LIGHT.
  const cliffTopIdx = soilBotPositions.map((v) => pushVert(v, rockLight, 0.75));
  const cliffBotPositions = top.map((v) => new THREE.Vector3(v.x, -sideHeight, v.z));
  const cliffBotIdx = cliffBotPositions.map((v) => pushVert(v, rockLight, 0.65));
  for (let i = 0; i < params.sides; i++) {
    const j = (i + 1) % params.sides;
    indices.push(cliffTopIdx[i]!, cliffBotIdx[i]!, cliffBotIdx[j]!);
    indices.push(cliffTopIdx[i]!, cliffBotIdx[j]!, cliffTopIdx[j]!);
  }

  // ----- TIER BANDS -----
  // From cliff bottom to bottom-cap edge, stitched through each tier ring.
  // Color darkens per tier from ROCK_LIGHT → ROCK_MID → ROCK_DARK.
  let bandTopPositions = cliffBotPositions;
  for (let t = 0; t < params.tiers; t++) {
    const ring = rings[t]!;
    // Color lerp: tier 0 → ROCK_MID, last tier → ROCK_DARK.
    const lerpT = params.tiers === 1 ? 1 : t / (params.tiers - 1);
    const tierColor = new THREE.Color().copy(rockMid).lerp(rockDark, lerpT);
    // AO deepens in tier-ring crevices.
    const ao = 0.55 - 0.15 * lerpT;
    const ringIdx = ring.map((v) => pushVert(v, tierColor, ao));
    // Re-push top-row vertices in this band's group so flat-shading
    // doesn't bleed across the tier seam.
    const bandTopReIdx = bandTopPositions.map((v) => pushVert(v, tierColor, ao + 0.08));
    for (let i = 0; i < params.sides; i++) {
      const j = (i + 1) % params.sides;
      indices.push(bandTopReIdx[i]!, ringIdx[i]!, ringIdx[j]!);
      indices.push(bandTopReIdx[i]!, ringIdx[j]!, bandTopReIdx[j]!);
    }
    bandTopPositions = ring;
  }

  // ----- BOTTOM CAP -----
  // Stitch from last tier ring to bottomRing.
  const bottomEdgeColor = rockDark;
  const bottomEdgeAO = 0.35;
  const lastTier = rings[params.tiers - 1]!;
  const lastTierReIdx = lastTier.map((v) => pushVert(v, bottomEdgeColor, bottomEdgeAO + 0.05));
  const bottomRingIdx = bottomRing.map((v) => pushVert(v, bottomEdgeColor, bottomEdgeAO));
  for (let i = 0; i < params.sides; i++) {
    const j = (i + 1) % params.sides;
    indices.push(lastTierReIdx[i]!, bottomRingIdx[i]!, bottomRingIdx[j]!);
    indices.push(lastTierReIdx[i]!, bottomRingIdx[j]!, lastTierReIdx[j]!);
  }
  // Bottom-cap fan (closes the mesh).
  const bottomCenter = pushVert(new THREE.Vector3(0, bottomY, 0), bottomEdgeColor, bottomEdgeAO);
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
