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
  // Base radius inscribes the polygon in the smaller of the two half-dims
  // so it always fits the bounds rectangle (even after jitter, since
  // jitter shrinks vertices toward the center).
  const baseR = Math.min(halfWidth, halfDepth);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    // Jitter range: [1 - irregularity, 1] (only shrinks, never grows past
    // baseR — keeps the polygon inscribed).
    const jitter = 1 - irregularity * rand();
    const r = baseR * jitter;
    pts.push(new THREE.Vector3(Math.cos(theta) * r, 0, Math.sin(theta) * r));
  }
  return pts;
}
