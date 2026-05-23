// scene/trees/treeRenderer.ts — turns a TreePlacement[] + the manifest's
// commit list into two InstancedMeshes:
//
//   tree-canopy — 4-sided cone (pyramid). Per-instance scale is set by
//                 (commit-age) → height and (commit-files) → XZ radius.
//                 Color interpolates between TREE_COLOR_OLD and
//                 TREE_COLOR_NEW by commit age. A baked vertex-color
//                 gradient (darker at base, lighter at top) adds depth.
//   tree-trunk  — short matte cylinder centered under each canopy.
//                 Height = TRUNK_HEIGHT_FRAC × canopy height; radius =
//                 TRUNK_RADIUS_FRAC_OF_CANOPY × canopy radius.
//
// `refresh()` rewrites per-instance color attributes + visibility +
// trunk color from TREES without rebuilding the meshes. Anything that
// changes geometry sizes (height/radius range, trunk fractions,
// shading strength) goes through the rebuild path in hotReload.ts.

import * as THREE from 'three';
import { TREES } from '@/config/trees.js';
import { RENDER_ORDERS } from '@/constants';
import type { TreePlacement } from './treePlacement.js';
import type { CommitEntry } from '@/types';
import {
  computeAgeRange,
  computeSizeRange,
  ageT,
  sizeT,
  type AgeRange,
  type SizeRange,
} from './treeEncoding.js';

export interface Trees {
  group: THREE.Group;
  refresh(): void;
  dispose(): void;
}

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

/** Bake per-vertex color attribute on a unit-height canopy geometry.
 *  Two effects combined, both scaled by `strength` ∈ [0,1]:
 *
 *  1. Vertical gradient — dark at y=0 (base), full bright at y=1 (top).
 *     Reads as "the bottom of the canopy sits in its own shadow."
 *  2. Directional face shading — dot the vertex normal against a fixed
 *     pseudo-light in object XZ. On a low-poly cone each face has its
 *     own outward normal, so this gives every face a distinct base
 *     brightness — adjacent faces no longer blend into a single
 *     uniform silhouette.
 *
 *  `vertexColors: true` on the canopy material multiplies these per-
 *  vertex colors with the per-instance color (age lerp), so the same
 *  tree gets both an age-driven hue AND clear face definition. */
function bakeVertexShading(
  geom: THREE.BufferGeometry,
  strength: number,
): void {
  // Pseudo-light direction in object XZ. Picked off-axis so all four
  // faces of the pyramid land at distinct dot-product values rather
  // than two pairs of equally-lit faces.
  const lightX = 0.55;
  const lightZ = 0.84;
  // Shadow side dims to (1 - DIRECTIONAL_RANGE × strength); lit side stays at 1.
  // 0.55 gives a ~30% spread between dimmest and brightest face at
  // strength=0.55 (default), enough to read crisply at city scale.
  const DIRECTIONAL_RANGE = 0.55;

  const pos = geom.getAttribute('position');
  const nrm = geom.getAttribute('normal');
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    const yClamped = y < 0 ? 0 : y > 1 ? 1 : y;
    const heightShade = 1 - strength * (1 - yClamped);

    // Use vertex normal to pick a face brightness. Geometries without
    // a normal attribute fall back to uniform 1 (no face shading).
    let faceShade = 1;
    if (nrm) {
      const dot = nrm.getX(i) * lightX + nrm.getZ(i) * lightZ; // [-1,1]
      const faceFactor = (dot + 1) * 0.5;                       // [0,1]
      faceShade = 1 - strength * DIRECTIONAL_RANGE * (1 - faceFactor);
    }

    const c = heightShade * faceShade;
    colors[i * 3 + 0] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function createTreeRenderer(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
): Trees {
  const cfg = TREES.get();

  // Height and width are configured in absolute world units —
  // independent of building dimensions so they're easy to tune.
  // Config exposes DIAMETER for width; convert to radius for the cone.
  const minHeight = cfg.TREE_MIN_HEIGHT;
  const maxHeight = cfg.TREE_MAX_HEIGHT;
  const minRadius = cfg.TREE_MIN_WIDTH / 2;
  const maxRadius = cfg.TREE_MAX_WIDTH / 2;
  const trunkHeightFrac = cfg.TRUNK_HEIGHT_FRAC;
  const trunkRadiusFrac = cfg.TRUNK_RADIUS_FRAC_OF_CANOPY;

  const ageRange: AgeRange = computeAgeRange(commits);
  const sizeRange: SizeRange = computeSizeRange(commits);

  // Canopy geometry: 4-sided pyramid at unit height (Y ∈ [0,1]) and
  // unit XZ radius. Per-instance matrix scales it to the per-tree
  // height and radius.
  const canopyGeometry = new THREE.ConeGeometry(1.0, 1.0, 4);
  canopyGeometry.translate(0, 0.5, 0);
  bakeVertexShading(canopyGeometry, cfg.TREE_SHADING_STRENGTH);

  // Trunk geometry: unit-height (Y ∈ [0,1]), unit XZ radius cylinder.
  // Per-instance Y scale = canopy height × TRUNK_HEIGHT_FRAC; XZ scale
  // = canopy radius × TRUNK_RADIUS_FRAC_OF_CANOPY.
  const trunkGeometry = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 4);
  trunkGeometry.translate(0, 0.5, 0);

  const trunkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });
  setColorFromHex(trunkMaterial.color, cfg.TREE_TRUNK_COLOR);

  const canopyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    vertexColors: true,
  });

  const tmpMatrix = new THREE.Matrix4();
  const tmpV3 = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpColor = new THREE.Color();
  const oldColor = new THREE.Color();
  const newColor = new THREE.Color();
  setColorFromHex(oldColor, cfg.TREE_COLOR_OLD);
  setColorFromHex(newColor, cfg.TREE_COLOR_NEW);

  // HEIGHT is driven by AGE: older commits grow taller. ageT=0 (oldest)
  // → max height; ageT=1 (newest) → min height. Degenerate cases
  // (null commits, missing commit, zero-span) collapse to midpoint.
  function perTreeHeight(i: number): number {
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      const t = ageT(commits[placements[i].commitIndex], ageRange);
      return maxHeight - t * (maxHeight - minHeight);
    }
    return (minHeight + maxHeight) * 0.5;
  }

  // WIDTH (canopy XZ radius) is driven by FILES: more files = wider.
  function perTreeRadius(i: number): number {
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      const t = sizeT(commits[placements[i].commitIndex], sizeRange);
      return minRadius + t * (maxRadius - minRadius);
    }
    return (minRadius + maxRadius) * 0.5;
  }

  // COLOR follows AGE: newer commits interpolate toward TREE_COLOR_NEW.
  function perTreeColor(i: number, target: THREE.Color): void {
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      const t = ageT(commits[placements[i].commitIndex], ageRange);
      target.lerpColors(oldColor, newColor, t);
      return;
    }
    target.lerpColors(oldColor, newColor, 0.5);
  }

  const totalTrees = placements.length;

  const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, totalTrees);
  canopyMesh.name = 'tree-canopy';
  canopyMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  canopyMesh.frustumCulled = false;
  canopyMesh.visible = cfg.TREES_ENABLED;

  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, totalTrees);
  trunkMesh.name = 'tree-trunk';
  trunkMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  trunkMesh.frustumCulled = false;
  trunkMesh.visible = cfg.TREES_ENABLED;

  for (let i = 0; i < totalTrees; i++) {
    const p = placements[i];
    const h = perTreeHeight(i);
    const r = perTreeRadius(i);
    const trunkH = h * trunkHeightFrac;
    const trunkR = r * trunkRadiusFrac;

    // Trunk: rooted at ground, scales to (trunkR, trunkH, trunkR).
    tmpV3.set(p.x, 0, p.y);
    tmpScale.set(trunkR, trunkH, trunkR);
    tmpMatrix.compose(tmpV3, tmpQ, tmpScale);
    trunkMesh.setMatrixAt(i, tmpMatrix);

    // Canopy: base sits at top of trunk; scales to (r, h, r).
    tmpV3.set(p.x, trunkH, p.y);
    tmpScale.set(r, h, r);
    tmpMatrix.compose(tmpV3, tmpQ, tmpScale);
    canopyMesh.setMatrixAt(i, tmpMatrix);

    perTreeColor(i, tmpColor);
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

  function refresh(): void {
    const c = TREES.get();
    group.visible = c.TREES_ENABLED;
    canopyMesh.visible = c.TREES_ENABLED;
    trunkMesh.visible = c.TREES_ENABLED;

    setColorFromHex(trunkMaterial.color, c.TREE_TRUNK_COLOR);
    setColorFromHex(oldColor, c.TREE_COLOR_OLD);
    setColorFromHex(newColor, c.TREE_COLOR_NEW);

    for (let i = 0; i < totalTrees; i++) {
      perTreeColor(i, tmpColor);
      canopyMesh.setColorAt(i, tmpColor);
    }
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    canopyMesh.geometry.dispose();
    trunkMesh.geometry.dispose();
    canopyMaterial.dispose();
    trunkMaterial.dispose();
  }

  return { group, refresh, dispose };
}
