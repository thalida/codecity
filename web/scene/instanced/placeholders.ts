// scene/instanced/placeholders.ts — Build a colored BoxGeometry cuboid
// for each SceneBlock. Used as the far-LOD representation: when a block
// is small enough on screen the lodController hides the detail
// InstancedMesh and shows this single cheap mesh instead.
//
// Edge case: empty bbox (block has no buildings) → clamp size to 1×1×1
// so the placeholder still participates in raycasting and scene-graph
// traversal without producing a degenerate zero-volume geometry.

import * as THREE from 'three';
import type { SceneBlock } from '../blocks.js';

export function createPlaceholderMesh(block: SceneBlock): THREE.Mesh {
  const size = new THREE.Vector3();
  block.bbox.getSize(size);
  const center = new THREE.Vector3();
  block.bbox.getCenter(center);

  // Clamp degenerate (zero-volume) bboxes to 1×1×1 so raycasting
  // always has a valid target even for empty blocks.
  if (size.x === 0) size.x = 1;
  if (size.y === 0) size.y = 1;
  if (size.z === 0) size.z = 1;

  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const mat = new THREE.MeshBasicMaterial({ color: block.meanColor });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(center);
  mesh.userData.kind = 'placeholder';
  mesh.userData.block = block;
  mesh.visible = false; // lodController will toggle
  return mesh;
}
