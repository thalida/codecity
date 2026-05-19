// scene/lodEvaluator.ts — Per-cell LOD tier evaluator.
//
// Each frame (or after a forced evaluation) this module projects each
// CellTile's bounding sphere into screen-space pixel area and assigns
// one of three tiers:
//
//   detail   (large area)  — full building shader mesh visible
//   impostor (mid area)    — cheap flat-shaded box visible
//   hidden   (tiny area)   — no rendering
//
// Hysteresis: a cell already at 'detail' stays there until the area
// drops below SWAP_TO_IMPOSTOR_PX (not SWAP_TO_DETAIL_PX), preventing
// rapid toggling when a cell sits near the band boundary.
//
// Skip-eval optimisation: if neither the camera position nor the
// viewport size has changed by more than their respective epsilons,
// the evaluation loop is skipped entirely.

import * as THREE from 'three';
import type { CellTile } from './cellTile.js';
import { LOD } from '@/config/lod.js';

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Project a bounding sphere's radius into screen-space pixel area.
 *
 * Returns 0 if the sphere centre is behind (or on) the near plane
 * (centre.z >= 0 in camera space after matrixWorldInverse).
 */
export function projectedPixelArea(
  sphere: THREE.Sphere,
  camera: THREE.PerspectiveCamera,
  viewport: Viewport,
): number {
  const center = sphere.center.clone().applyMatrix4(camera.matrixWorldInverse);
  if (center.z >= 0) return 0; // behind near plane
  const dist = -center.z;
  const fovRad = (camera.fov * Math.PI) / 180;
  const r_px = (sphere.radius / dist) * (viewport.height / (2 * Math.tan(fovRad / 2)));
  return Math.PI * r_px * r_px;
}

/**
 * Stateful LOD evaluator. Construct one instance and call evaluate() each
 * frame. The instance tracks last-known camera position and viewport so it
 * can skip the evaluation loop when nothing has changed.
 */
export class LodEvaluator {
  private _lastCamPos = new THREE.Vector3(NaN, NaN, NaN);
  private _lastViewportW = -1;
  private _lastViewportH = -1;

  /**
   * Evaluate LOD tiers for all cells in the iterable.
   *
   * @param cells     Iterable of CellTile to classify.
   * @param camera    The scene's perspective camera (must have current matrices).
   * @param viewport  Current canvas pixel dimensions.
   * @param force     When true, always run the full loop regardless of epsilons.
   */
  evaluate(
    cells: Iterable<CellTile>,
    camera: THREE.PerspectiveCamera,
    viewport: Viewport,
    force = false,
  ): void {
    const lod = LOD.get();
    const moved =
      this._lastCamPos.distanceTo(camera.position) > lod.CAMERA_MOVE_EPS;
    const resized =
      Math.abs(this._lastViewportW - viewport.width) > lod.VIEWPORT_RESIZE_EPS ||
      Math.abs(this._lastViewportH - viewport.height) > lod.VIEWPORT_RESIZE_EPS;

    if (!force && !moved && !resized) return;

    this._lastCamPos.copy(camera.position);
    this._lastViewportW = viewport.width;
    this._lastViewportH = viewport.height;

    for (const cell of cells) {
      const A = projectedPixelArea(cell.boundsSphere, camera, viewport);

      let next: typeof cell.tier;
      if (A < lod.CULL_PX) {
        next = 'hidden';
      } else if (A >= lod.SWAP_TO_DETAIL_PX) {
        next = 'detail';
      } else if (A < lod.SWAP_TO_IMPOSTOR_PX) {
        next = 'impostor';
      } else {
        // Hysteresis band: SWAP_TO_IMPOSTOR_PX <= A < SWAP_TO_DETAIL_PX.
        // Stay in current tier if already detail; otherwise impostor.
        next = cell.tier === 'detail' ? 'detail' : 'impostor';
      }

      if (next !== cell.tier) {
        cell.detailMesh.visible = next === 'detail';
        cell.impostorMesh.visible = next === 'impostor';
        if (cell.labelMesh) cell.labelMesh.visible = next === 'detail';
        if (cell.streetMesh) cell.streetMesh.visible = next !== 'hidden';
        cell.prevTier = cell.tier;
        cell.tier = next;
      }
    }
  }
}
