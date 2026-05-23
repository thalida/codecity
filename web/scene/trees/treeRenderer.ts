// scene/trees/treeRenderer.ts — turns a TreePlacement[] + the
// manifest's commit list into one InstancedMesh per enabled canopy
// shape (pointy / rounded / fir / narrow) plus a shared trunk
// InstancedMesh.
//
// Each canopy geometry is built at UNIT HEIGHT and carries a baked
// per-vertex color gradient (darker at the base, brighter at the top)
// for cheap volumetric shading on top of MeshBasicMaterial. Per-tree
// height is applied via the instance matrix Y-scale; per-tree color
// is a two-color interpolation between TREE_COLOR_OLD and
// TREE_COLOR_NEW based on commit age.
//
// `refresh()` rewrites per-instance color attributes + visibility +
// trunk color from TREES without rebuilding the meshes. Anything that
// changes geometry sizes or per-shape instance counts (height range,
// shape toggles, shading strength) goes through the rebuild path in
// hotReload.ts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TREES } from '@/config/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
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

type ShapeKey = 'pointy' | 'rounded' | 'fir' | 'narrow';

const SHAPE_ORDER: ShapeKey[] = ['pointy', 'rounded', 'fir', 'narrow'];

/** Build unit-height canopy geometries. Each geometry occupies Y ∈ [0, 1]
 *  with the canopy base at y=0 and the canopy top at y=1. */
function buildShapeGeometries(): Record<ShapeKey, THREE.BufferGeometry> {
  const pointy = new THREE.ConeGeometry(1.0, 1.0, 4);
  pointy.translate(0, 0.5, 0);

  const rounded = new THREE.IcosahedronGeometry(0.5, 0);
  rounded.translate(0, 0.5, 0);

  const firBase = new THREE.ConeGeometry(1.0, 0.6, 4);
  firBase.translate(0, 0.3, 0);
  const firTop = new THREE.ConeGeometry(0.6, 0.5, 4);
  firTop.translate(0, 0.75, 0);
  const firMerged = mergeGeometries([firBase, firTop], false);
  if (!firMerged) {
    throw new Error('mergeGeometries returned null for fir shape');
  }
  firBase.dispose();
  firTop.dispose();

  const narrow = new THREE.ConeGeometry(1.0, 1.0, 8);
  narrow.translate(0, 0.5, 0);

  return { pointy, rounded, fir: firMerged, narrow };
}

const RADIUS_COEFS: Record<ShapeKey, number> = {
  pointy: 1.0,
  rounded: 0.85,
  fir: 1.0,
  narrow: 0.45,
};

function enabledShapes(): ShapeKey[] {
  const c = TREES.get();
  const out: ShapeKey[] = [];
  if (c.SHAPE_POINTY_ENABLED) out.push('pointy');
  if (c.SHAPE_ROUNDED_ENABLED) out.push('rounded');
  if (c.SHAPE_FIR_ENABLED) out.push('fir');
  if (c.SHAPE_NARROW_ENABLED) out.push('narrow');
  return out;
}

function knuth(seed: number): number {
  return Math.imul(seed | 0, 0x9e3779b1) >>> 0;
}

function pickShapeIdx(placement: TreePlacement, shapeCount: number): number {
  if (shapeCount <= 0) return 0;
  return knuth(placement.seed ^ placement.commitIndex) % shapeCount;
}

function setColorFromHex(target: THREE.Color, hex: string): void {
  target.setStyle(hex, THREE.LinearSRGBColorSpace);
}

/** Bake per-vertex color attribute on a unit-height canopy geometry:
 *  darker at y=0, lighter at y=1. `strength` ∈ [0,1]. */
function bakeVertexShading(
  geom: THREE.BufferGeometry,
  strength: number,
): void {
  const pos = geom.getAttribute('position');
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    const yClamped = y < 0 ? 0 : y > 1 ? 1 : y;
    const c = 1 - strength * (1 - yClamped);
    colors[i * 3 + 0] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

interface ShapeMesh {
  key: ShapeKey;
  mesh: THREE.InstancedMesh;
  /** Indexes into `placements` for the trees rendered by this mesh,
   *  in the same order their instances were written. */
  placementOrder: number[];
}

export function createTreeRenderer(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
): Trees {
  const cfg = TREES.get();
  const dims = BUILDING_DIMENSIONS.get();

  const minHeight = cfg.TREE_MIN_HEIGHT_FLOORS * dims.FLOOR_HEIGHT;
  const maxHeight = cfg.TREE_MAX_HEIGHT_FLOORS * dims.FLOOR_HEIGHT;
  const radiusFrac = cfg.TREE_RADIUS_FRAC_OF_HEIGHT;

  const ageRange: AgeRange = computeAgeRange(commits);
  const sizeRange: SizeRange = computeSizeRange(commits);

  const allGeoms = buildShapeGeometries();
  for (const key of SHAPE_ORDER) {
    bakeVertexShading(allGeoms[key], cfg.TREE_SHADING_STRENGTH);
  }

  const shapesEnabled = enabledShapes();

  const buckets: Record<ShapeKey, number[]> = {
    pointy: [], rounded: [], fir: [], narrow: [],
  };
  if (shapesEnabled.length > 0) {
    for (let i = 0; i < placements.length; i++) {
      const idx = pickShapeIdx(placements[i], shapesEnabled.length);
      const key = shapesEnabled[idx];
      buckets[key].push(i);
    }
  }

  const trunkUnitHeight = 0.25;
  const trunkUnitRadius = 0.12 * radiusFrac;
  const trunkGeometry = new THREE.CylinderGeometry(
    trunkUnitRadius, trunkUnitRadius, trunkUnitHeight, 4,
  );
  trunkGeometry.translate(0, trunkUnitHeight / 2, 0);

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

  function perTreeHeight(i: number): number {
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      const t = sizeT(commits[placements[i].commitIndex], sizeRange);
      return minHeight + t * (maxHeight - minHeight);
    }
    return (minHeight + maxHeight) * 0.5;
  }

  function perTreeColor(i: number, target: THREE.Color): void {
    if (commits && placements[i].commitIndex >= 0 && placements[i].commitIndex < commits.length) {
      const t = ageT(commits[placements[i].commitIndex], ageRange);
      target.lerpColors(oldColor, newColor, t);
      return;
    }
    target.lerpColors(oldColor, newColor, 0.5);
  }

  const shapeMeshes: ShapeMesh[] = [];
  for (const key of shapesEnabled) {
    const indices = buckets[key];
    if (indices.length === 0) continue;
    const geom = allGeoms[key];
    const mesh = new THREE.InstancedMesh(geom, canopyMaterial, indices.length);
    mesh.name = `tree-canopy-${key}`;
    mesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
    mesh.frustumCulled = false;
    mesh.visible = cfg.TREES_ENABLED;

    const rCoef = RADIUS_COEFS[key];
    for (let i = 0; i < indices.length; i++) {
      const placementIdx = indices[i];
      const p = placements[placementIdx];
      const h = perTreeHeight(placementIdx);
      const xz = h * radiusFrac * rCoef;
      tmpV3.set(p.x, h * trunkUnitHeight, p.y);
      tmpScale.set(xz, h, xz);
      tmpMatrix.compose(tmpV3, tmpQ, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
      perTreeColor(placementIdx, tmpColor);
      mesh.setColorAt(i, tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    shapeMeshes.push({ key, mesh, placementOrder: indices });
  }

  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, placements.length);
  trunkMesh.name = 'tree-trunk';
  trunkMesh.renderOrder = RENDER_ORDERS.PARK_FOLIAGE;
  trunkMesh.frustumCulled = false;
  trunkMesh.visible = cfg.TREES_ENABLED;

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const h = perTreeHeight(i);
    tmpV3.set(p.x, 0, p.y);
    tmpScale.set(h, h, h);
    tmpMatrix.compose(tmpV3, tmpQ, tmpScale);
    trunkMesh.setMatrixAt(i, tmpMatrix);
  }
  trunkMesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'trees';
  group.userData.cyberpunkValley = 'trees';
  group.visible = cfg.TREES_ENABLED;
  for (const s of shapeMeshes) group.add(s.mesh);
  group.add(trunkMesh);

  function refresh(): void {
    const c = TREES.get();
    group.visible = c.TREES_ENABLED;
    for (const s of shapeMeshes) s.mesh.visible = c.TREES_ENABLED;
    trunkMesh.visible = c.TREES_ENABLED;

    setColorFromHex(trunkMaterial.color, c.TREE_TRUNK_COLOR);
    setColorFromHex(oldColor, c.TREE_COLOR_OLD);
    setColorFromHex(newColor, c.TREE_COLOR_NEW);

    for (const s of shapeMeshes) {
      for (let i = 0; i < s.placementOrder.length; i++) {
        perTreeColor(s.placementOrder[i], tmpColor);
        s.mesh.setColorAt(i, tmpColor);
      }
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
    }
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    const attachedKeys = new Set(shapeMeshes.map((s) => s.key));
    for (const s of shapeMeshes) {
      s.mesh.geometry.dispose();
    }
    for (const key of SHAPE_ORDER) {
      if (!attachedKeys.has(key)) allGeoms[key].dispose();
    }
    trunkMesh.geometry.dispose();
    canopyMaterial.dispose();
    trunkMaterial.dispose();
  }

  return { group, refresh, dispose };
}
