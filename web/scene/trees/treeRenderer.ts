// scene/trees/treeRenderer.ts — turns a TreePlacement[] into two
// InstancedMeshes:
//
//   tree-canopy — matte cone canopies (one per tree placement)
//   tree-trunk  — small matte cylinders aligned under canopies
//
// Foliage geometry is matte (no glow). Colors are drawn from
// TREES.TREE_GREENS (deterministic per-seed picker).
//
// `refresh()` rewrites per-instance color attributes from TREES and
// updates visible flags; it never rebuilds the InstancedMeshes.
// Structural changes (anything in TREES) take the full rebuild path
// via hotReload.ts.

import * as THREE from 'three';
import { TREES } from '@/config/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { RENDER_ORDERS } from '@/constants';
import type { TreePlacement } from './treePlacement.js';

export interface Trees {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
}

function knuth(seed: number): number {
  return Math.imul(seed | 0, 0x9e3779b1) >>> 0;
}

function rand01(seed: number): number {
  return knuth(seed) / 0x100000000;
}

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

function setInstanceMatrix(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  tmpMatrix: THREE.Matrix4,
  tmpV3a: THREE.Vector3,
  tmpV3b: THREE.Vector3,
  tmpQ: THREE.Quaternion,
): void {
  tmpV3a.set(x, y, z);
  tmpV3b.set(sx, sy, sz);
  tmpMatrix.compose(tmpV3a, tmpQ, tmpV3b);
  mesh.setMatrixAt(i, tmpMatrix);
}

// rand01 is available but not used in the current renderer — suppress
// the unused warning by referencing it in a no-op.
void rand01;

export function createTreeRenderer(placements: TreePlacement[]): Trees {
  const cfg = TREES.get();
  const dims = BUILDING_DIMENSIONS.get();

  const treeHeight = cfg.TREE_HEIGHT_FLOORS * dims.FLOOR_HEIGHT;
  const treeRadius = cfg.TREE_RADIUS_FRAC_OF_HEIGHT * treeHeight;

  const totalTrees = placements.length;

  const trunkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });
  setColorFromHex(trunkMaterial.color, cfg.TREE_TRUNK_COLOR);

  const canopyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });

  const canopyGeometry = new THREE.ConeGeometry(treeRadius, treeHeight, 4);
  canopyGeometry.translate(0, treeHeight / 2, 0);

  const trunkHeight = treeHeight * 0.25;
  const trunkRadius = treeRadius * 0.12;
  const trunkGeometry = new THREE.CylinderGeometry(trunkRadius, trunkRadius, trunkHeight, 4);
  trunkGeometry.translate(0, trunkHeight / 2, 0);

  const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, totalTrees);
  canopyMesh.name = 'tree-canopy';
  canopyMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  canopyMesh.frustumCulled = false;

  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, totalTrees);
  trunkMesh.name = 'tree-trunk';
  trunkMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  trunkMesh.frustumCulled = false;

  const tmpMatrix = new THREE.Matrix4();
  const tmpV3a = new THREE.Vector3();
  const tmpV3b = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpColor = new THREE.Color();

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    setInstanceMatrix(canopyMesh, i, p.x, trunkHeight, p.y, 1, 1, 1,
      tmpMatrix, tmpV3a, tmpV3b, tmpQ);
    setInstanceMatrix(trunkMesh, i, p.x, 0, p.y, 1, 1, 1,
      tmpMatrix, tmpV3a, tmpV3b, tmpQ);
    setColorFromHex(tmpColor, pickTreeGreen(p.seed));
    canopyMesh.setColorAt(i, tmpColor);
  }

  canopyMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.instanceMatrix.needsUpdate = true;
  if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'trees';
  group.userData.cyberpunkValley = 'trees';
  group.visible = cfg.TREES_ENABLED;
  group.add(canopyMesh, trunkMesh);

  canopyMesh.visible = cfg.TREES_ENABLED;
  trunkMesh.visible = cfg.TREES_ENABLED;

  function refresh(): void {
    const c = TREES.get();

    group.visible = c.TREES_ENABLED;
    canopyMesh.visible = c.TREES_ENABLED;
    trunkMesh.visible = c.TREES_ENABLED;

    setColorFromHex(trunkMaterial.color, c.TREE_TRUNK_COLOR);

    for (let i = 0; i < placements.length; i++) {
      setColorFromHex(tmpColor, pickTreeGreen(placements[i].seed));
      canopyMesh.setColorAt(i, tmpColor);
    }
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    for (const mesh of [canopyMesh, trunkMesh]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }

  return { group, refresh, dispose };
}
