// scene/instanced/buildingTilt.ts — single source of truth for the
// per-building lean angle.
//
// The lean is implemented as a Y-driven XZ shear in building.vert.glsl:
//
//   worldPos.xz += worldPos.y × tiltAngle × (cos(theta), sin(theta))
//
// where
//   tiltAngle = createdAge × uTiltMaxRad
//   theta     = seed × 2π   (seed = seedFromPath(file.path), in [0, 1))
//
// The shader path is fast and toggle-friendly (uTiltMaxRad goes to 0
// when BUILDING_AGING.TILT_ENABLED flips off). But the outline mesh and
// the picker raycast both need the SAME shear on the CPU side — the
// outline must visibly skew with the building, and click targets need
// to hit the leaned silhouette, not the un-leaned AABB.
//
// `getBuildingTilt(building)` returns the precomputed (tiltX, tiltZ)
// pair — multiply by worldY to get the XZ offset for any point on the
// building. Consumers compose this into either a shear matrix (outline)
// or an inverse-shear ray transform (picker).

import * as THREE from 'three';
import { BUILDING_AGING } from '@/config/components/buildings.js';
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
 * Compute the (tiltX, tiltZ) shear coefficients for a building, matching
 * exactly what the vertex shader applies. Returns `{0, 0}` when
 * BUILDING_AGING.TILT_ENABLED is off, when the building has no file (no
 * stable seed source), or when the building has no createdAge signal.
 */
export function getBuildingTilt(b: Building): BuildingTilt {
  const aging = BUILDING_AGING.get();
  if (!aging.TILT_ENABLED) return ZERO_TILT;
  if (!b.file) return ZERO_TILT;
  const createdAge = b.createdAge ?? 0;
  if (createdAge <= 0) return ZERO_TILT;

  const tiltMaxRad = (aging.TILT_DEGREES * Math.PI) / 180;
  const tiltAngle = createdAge * tiltMaxRad;
  const theta = seedFromPath(b.file.path) * 2 * Math.PI;
  return {
    tiltX: tiltAngle * Math.cos(theta),
    tiltZ: tiltAngle * Math.sin(theta),
  };
}

/**
 * Override `mesh.raycast` so the picker honors the per-instance Y-shear
 * the vertex shader applies. For each instance we read createdAge + seed
 * from the iIconUV attribute, reconstruct the same (tiltX, tiltZ) the
 * shader uses, compose a full TRS+shear matrix, and test the ray against
 * the unit AABB in that instance's local space. The closest leaned hit
 * wins, matching the visible silhouette.
 *
 * Without this the picker tests against the un-leaned (axis-aligned)
 * instance box, which misses clicks near a leaning building's top.
 */
export function attachLeanAwareRaycast(mesh: THREE.InstancedMesh): void {
  const UNIT_BOX = new THREE.Box3(
    new THREE.Vector3(-0.5, -0.5, -0.5),
    new THREE.Vector3(0.5, 0.5, 0.5),
  );

  // Scratch — allocated once per mesh, reused across raycast calls.
  const tmpInstanceMatrix = new THREE.Matrix4();
  const tmpMatrix = new THREE.Matrix4();
  const invMatrix = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpRay = new THREE.Ray();
  const tmpLocalHit = new THREE.Vector3();
  const tmpWorldHit = new THREE.Vector3();

  mesh.raycast = function (raycaster, intersects) {
    if (!mesh.visible) return;

    const aging = BUILDING_AGING.get();
    const tiltMaxRad = aging.TILT_ENABLED
      ? (aging.TILT_DEGREES * Math.PI) / 180
      : 0;

    const iIconUV = mesh.geometry.getAttribute('iIconUV') as
      | THREE.InstancedBufferAttribute
      | undefined;

    // Pull ray into the mesh's local space (matrixWorld may have been
    // touched even though detail cells normally render at identity).
    mesh.updateMatrixWorld();
    invMatrix.copy(mesh.matrixWorld).invert();
    const localRay = new THREE.Ray()
      .copy(raycaster.ray)
      .applyMatrix4(invMatrix);

    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, tmpInstanceMatrix);
      tmpInstanceMatrix.decompose(tmpPos, tmpQuat, tmpScale);

      let tiltX = 0;
      let tiltZ = 0;
      if (tiltMaxRad > 0 && iIconUV) {
        const off = i * 4;
        const seed = iIconUV.array[off + 2]; // .z
        const createdAge = iIconUV.array[off + 3]; // .w
        if (createdAge > 0) {
          const tiltAngle = createdAge * tiltMaxRad;
          const theta = seed * 2 * Math.PI;
          tiltX = tiltAngle * Math.cos(theta);
          tiltZ = tiltAngle * Math.sin(theta);
        }
      }

      // Full per-instance TRS + shear matrix. World-pos of local
      // vertex (lx, ly, lz):
      //   X = lx·sx + px + (ly·sy + py)·tiltX
      //   Y = ly·sy + py
      //   Z = lz·sz + pz + (ly·sy + py)·tiltZ
      const sx = tmpScale.x;
      const sy = tmpScale.y;
      const sz = tmpScale.z;
      const px = tmpPos.x;
      const py = tmpPos.y;
      const pz = tmpPos.z;
      tmpMatrix.set(
        sx,  sy * tiltX, 0,    px + py * tiltX,
        0,   sy,         0,    py,
        0,   sy * tiltZ, sz,   pz + py * tiltZ,
        0,   0,          0,    1,
      );

      // Transform the local-space ray into instance-local (unit-box)
      // space and run a standard ray-AABB test.
      invMatrix.copy(tmpMatrix).invert();
      tmpRay.copy(localRay).applyMatrix4(invMatrix);
      const hit = tmpRay.intersectBox(UNIT_BOX, tmpLocalHit);
      if (!hit) continue;

      // Map the local hit back to world and record the Intersection.
      tmpWorldHit.copy(hit).applyMatrix4(tmpMatrix).applyMatrix4(mesh.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(tmpWorldHit);
      if (distance < raycaster.near || distance > raycaster.far) continue;

      intersects.push({
        distance,
        point: tmpWorldHit.clone(),
        object: mesh,
        instanceId: i,
      });
    }
  };
}
