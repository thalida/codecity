// city/components/buildings/tilt.ts — single source of truth for the
// per-building lean angle.
//
// The lean is a Y-driven XZ shear BAKED INTO the instance matrix (via
// composeShearMatrix), so a local box vertex (lx, ly, lz) lands at
//   X = lx·sx + px + (ly·sy + py) × tiltX
//   Z = lz·sz + pz + (ly·sy + py) × tiltZ
// where
//   tiltAngle = mix(TILT_DEGREES.newest, TILT_DEGREES.oldest, createdAge) → rad
//   (tiltX, tiltZ) = tiltAngle × (cos theta, sin theta), theta = seed × 2π,
//   seed = seedFromPath(file.path) in [0, 1).
//
// Baking it into the matrix (not the vertex shader) means one source of
// truth: the render (instanceMatrix), the outline, AND the picker BVH all
// read the same sheared matrix, so click targets hit the leaned silhouette
// instead of the un-leaned AABB. Tilt is on the Rebuild route so a Save
// re-bakes matrices + rebuilds the picker index.

import * as THREE from 'three';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import type { Building } from '@/types';

/**
 * Per-instance random seed derived from a file path. Same FNV-1a-based
 * hash the cell-instance attributes use — deterministic across rebuilds
 * so a building's tilt direction (and its facade pattern) doesn't shuffle
 * on every live-update poll. Output is normalized to [0, 1).
 */
export function seedFromPath(path: string): number {
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime, 32-bit safe via imul
  }
  return (h >>> 0) / 4294967296;
}

export interface BuildingTilt {
  /** X-axis offset per unit of worldY: dx = worldY × tiltX. */
  tiltX: number;
  /** Z-axis offset per unit of worldY: dz = worldY × tiltZ. */
  tiltZ: number;
}

const ZERO_TILT: BuildingTilt = { tiltX: 0, tiltZ: 0 };

/**
 * Lean magnitude (radians) for a building of the given createdAge, lerped
 * across the TILT_DEGREES `[newest, oldest]` range. Single source of the
 * age→angle mapping baked into every building's instance matrix.
 */
function tiltRadForAge(degRange: readonly [number, number], createdAge: number): number {
  const deg = degRange[0] + (degRange[1] - degRange[0]) * createdAge;
  return (deg * Math.PI) / 180;
}

/**
 * Compute the (tiltX, tiltZ) shear coefficients for a building, matching
 * exactly what the vertex shader applies. Returns `{0, 0}` when
 * BUILDINGS.TILT_ENABLED is off, when the building has no file (no stable
 * seed source), or when the age-lerped lean angle is zero.
 */
export function getBuildingTilt(b: Building): BuildingTilt {
  if (!b.file) return ZERO_TILT;
  return getBuildingTiltAtAge(b.file.path, b.createdAge ?? 0);
}

/**
 * Shear coefficients for a building at an EXPLICIT createdAge — for Timeline
 * mode, where a building's age is relative to the scrubbed commit, not its
 * static layout createdAge. Live callers use {@link getBuildingTilt}.
 */
export function getBuildingTiltAtAge(path: string, createdAge: number): BuildingTilt {
  const aging = BUILDINGS.value;
  if (!aging.TILT_ENABLED) return ZERO_TILT;
  const tiltAngle = tiltRadForAge(aging.TILT_DEGREES, createdAge);
  if (tiltAngle === 0) return ZERO_TILT;
  const theta = seedFromPath(path) * 2 * Math.PI;
  return {
    tiltX: tiltAngle * Math.cos(theta),
    tiltZ: tiltAngle * Math.sin(theta),
  };
}

/**
 * Compose a building's full per-instance TRS + Y-shear matrix into `out`.
 *
 * This is the CPU mirror of the vertex shader's lean: a local vertex
 * (lx, ly, lz) of the unit box lands at world position
 *   X = lx·sx + px + (ly·sy + py)·tiltX
 *   Y = ly·sy + py
 *   Z = lz·sz + pz + (ly·sy + py)·tiltZ
 * so a column scales+translates and the Y row drives an XZ shear by
 * (tiltX, tiltZ). With tiltX = tiltZ = 0 this is a plain TRS (no rotation).
 *
 * `Matrix4.set()` takes row-major args (Matrix4 is column-major internally).
 * Writes into the caller's `out` so hot paths (per-frame outline sync,
 * per-instance raycast) reuse one scratch matrix with no allocation.
 *
 * Single source of truth for the lean shear shared by the outline mesh
 * (visible skew) and the picker raycast (click targets on the leaned
 * silhouette) — both MUST match the shader exactly.
 */
export function composeShearMatrix(
  position: THREE.Vector3,
  scale: THREE.Vector3,
  tiltX: number,
  tiltZ: number,
  out: THREE.Matrix4
): THREE.Matrix4 {
  const sx = scale.x;
  const sy = scale.y;
  const sz = scale.z;
  const px = position.x;
  const py = position.y;
  const pz = position.z;
  return out.set(
    sx,
    sy * tiltX,
    0,
    px + py * tiltX,
    0,
    sy,
    0,
    py,
    0,
    sy * tiltZ,
    sz,
    pz + py * tiltZ,
    0,
    0,
    0,
    1
  );
}
