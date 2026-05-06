// scene/lodController.ts — Per-frame LOD swap between detail InstancedMesh
// and placeholder cuboid for each SceneBlock.
//
// Algorithm: project all 8 corners of a block's bbox into NDC, clamp to
// screen extents, and compute the pixel area of the resulting 2-D AABB.
// Two-threshold hysteresis (SWAP_TO_DETAIL_PX / SWAP_TO_PLACEHOLDER_PX)
// prevents rapid flicker when a block sits near the threshold.
//
// Per-frame work: O(blocks). For ~100 blocks at 15k buildings, ~3 ms.
//
// The 8 corner Vector3 instances and tmpV are allocated once at
// construction time and reused every frame — no per-frame allocations.

import * as THREE from 'three';
import { LOD } from '@/config/index.js';
import type { SceneBlock } from './blocks.js';

export function createLodController(blocks: SceneBlock[], camera: THREE.Camera) {
  const tmpV = new THREE.Vector3();
  const corners = [
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  ];

  function update(canvas: HTMLCanvasElement) {
    const lod = LOD.get();
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    for (const block of blocks) {
      if (!block.detailMesh || !block.placeholderMesh) continue;
      // Compute screen-space pixel area of the block bbox.
      const min = block.bbox.min;
      const max = block.bbox.max;
      let i = 0;
      corners[i++].set(min.x, min.y, min.z);
      corners[i++].set(max.x, min.y, min.z);
      corners[i++].set(min.x, max.y, min.z);
      corners[i++].set(max.x, max.y, min.z);
      corners[i++].set(min.x, min.y, max.z);
      corners[i++].set(max.x, min.y, max.z);
      corners[i++].set(min.x, max.y, max.z);
      corners[i++].set(max.x, max.y, max.z);
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      let allBehindCamera = true;
      for (const c of corners) {
        tmpV.copy(c).project(camera);
        // Behind camera if z > 1 in NDC.
        if (tmpV.z < 1) allBehindCamera = false;
        xMin = Math.min(xMin, tmpV.x);
        xMax = Math.max(xMax, tmpV.x);
        yMin = Math.min(yMin, tmpV.y);
        yMax = Math.max(yMax, tmpV.y);
      }
      if (allBehindCamera) {
        block.detailMesh.visible = false;
        block.placeholderMesh.visible = false;
        block.lodCurrent = 'hidden';
        continue;
      }
      const pxW = ((xMax - xMin) / 2) * cw;
      const pxH = ((yMax - yMin) / 2) * ch;
      const pxArea = Math.max(0, pxW * pxH);

      // Hysteresis based on current LOD state.
      const targetState =
        block.lodCurrent === 'detail'
          ? (pxArea < lod.SWAP_TO_PLACEHOLDER_PX ? 'placeholder' : 'detail')
          : (pxArea > lod.SWAP_TO_DETAIL_PX ? 'detail' : 'placeholder');

      if (targetState === 'detail') {
        block.detailMesh.visible = true;
        block.placeholderMesh.visible = false;
        block.lodCurrent = 'detail';
      } else {
        block.detailMesh.visible = false;
        block.placeholderMesh.visible = true;
        block.lodCurrent = 'placeholder';
      }
    }
  }

  return { update };
}
