// scene/raycastBvh.ts — Install three-mesh-bvh's accelerated raycaster as
// the default for THREE.Mesh / BufferGeometry. Called once at boot.
//
// Why: with per-block InstancedMesh and ~hundreds of blocks, the default
// O(N) per-instance raycast walks every instance bbox on every pointermove.
// three-mesh-bvh builds a bounding-volume hierarchy on the geometry so
// raycasts become O(log N). For 15k buildings this is the difference
// between a snappy hover and visible lag.
//
// API installed (idempotent — safe to call once at boot):
//   THREE.BufferGeometry.prototype.computeBoundsTree() / .disposeBoundsTree()
//   THREE.Mesh.prototype.raycast → acceleratedRaycast
//
// Per-mesh: after creating an InstancedMesh, call mesh.geometry.computeBoundsTree()
// once. The BVH lives on the geometry; clone the BVH dispose into your
// dispose path alongside .geometry.dispose() if you need cleanup.

import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

let _installed = false;

export function installAcceleratedRaycast(): void {
  if (_installed) return;
  _installed = true;
  // The three-mesh-bvh prototypes augment THREE; cast through unknown so
  // TS accepts the assignment without us pulling in their ambient module.
  (THREE.BufferGeometry.prototype as unknown as {
    computeBoundsTree: typeof computeBoundsTree;
  }).computeBoundsTree = computeBoundsTree;
  (THREE.BufferGeometry.prototype as unknown as {
    disposeBoundsTree: typeof disposeBoundsTree;
  }).disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}
