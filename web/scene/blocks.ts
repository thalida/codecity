// scene/blocks.ts — Group buildings into per-directory "blocks" for
// per-block InstancedMesh rendering and LOD swapping.
//
// A SceneBlock is the rendering unit: it owns its detail mesh, label
// mesh, outline mesh, ghost mesh, and placeholder cuboid. The data
// model defined here is filled in by the InstancedMesh builders (see
// scene/instanced/*.ts) and consumed by the picker, fader,
// outlineRenderer, and lodController.

import * as THREE from 'three';
import type { Building, Street } from '@/types/index.js';
import type { DirNode } from '@/types/manifest.js';
import { parentDirPath } from './path.js';

export interface SceneBlock {
  dir: DirNode;
  bbox: THREE.Box3;
  meanColor: THREE.Color;
  primaryStreet: Street;
  buildings: Building[]; // ordered; index = per-block instanceId

  // Scene-graph references (set by builders during applyManifest):
  detailMesh?: THREE.InstancedMesh;
  labelsMesh?: THREE.InstancedMesh;
  outlineMesh?: THREE.Object3D; // Line2-instanced; opaque type
  ghostMesh?: THREE.InstancedMesh;
  placeholderMesh?: THREE.Mesh;
  /**
   * Ad-panel meshes for media files (image/video) in this block — one
   * textured Plane per file, mounted on the front face of its building.
   * Each carries userData.building so the picker resolves clicks anywhere
   * on the ad to the same file selection a regular building click would.
   * (Media buildings themselves now render through detailMesh like every
   * other building; ads are an additive decoration.)
   */
  adPanels?: THREE.Mesh[];

  // LOD state (managed by lodController):
  lodCurrent: 'detail' | 'placeholder' | 'hidden';
}

/**
 * Group buildings by their parent directory (= the street that names them).
 * Buildings carry their file's `path`; the directory is the path's parent.
 * The loop iterates `streets` directly to produce blocks in street order.
 *
 * Order of returned blocks matches the order of `streets` input.
 * Within a block, building order matches the input `buildings` order.
 */
export function groupBuildingsByDirectory(
  buildings: Building[],
  streets: Street[]
): SceneBlock[] {
  const buildingsByDirPath = new Map<string, Building[]>();
  for (const b of buildings) {
    if (!b.file) continue;
    const dirPath = parentDirPath(b.file.path) ?? '.';
    if (!buildingsByDirPath.has(dirPath)) buildingsByDirPath.set(dirPath, []);
    buildingsByDirPath.get(dirPath)!.push(b);
  }

  const blocks: SceneBlock[] = [];
  for (const street of streets) {
    if (!street.dir) continue;
    const dirPath = street.dir.path;
    const buildingsInBlock = buildingsByDirPath.get(dirPath) ?? [];
    blocks.push(buildBlock(street, buildingsInBlock));
  }
  return blocks;
}

function buildBlock(street: Street, buildings: Building[]): SceneBlock {
  return {
    dir: street.dir!,
    bbox: computeBlockBBox(buildings),
    meanColor: computeMeanColor(buildings, street),
    primaryStreet: street,
    buildings,
    lodCurrent: 'hidden', // overwritten on first lodController.update
  };
}

/** Bounding box of all buildings in a block. Empty block → empty box. */
function computeBlockBBox(buildings: Building[]): THREE.Box3 {
  const bbox = new THREE.Box3();
  for (const b of buildings) {
    // Layout (x, y) maps to scene (x, z); building.h is scene-Y.
    bbox.expandByPoint(new THREE.Vector3(b.x - b.w / 2, 0, b.y - b.d / 2));
    bbox.expandByPoint(new THREE.Vector3(b.x + b.w / 2, b.h, b.y + b.d / 2));
  }
  return bbox;
}

/** Average building color in a block. Empty block → fallback to street label hash. */
function computeMeanColor(buildings: Building[], street: Street): THREE.Color {
  if (buildings.length === 0) {
    // Fallback: hash the street label to a hue.
    const hash = [...(street.label || '')].reduce(
      (a, c) => (a * 31 + c.charCodeAt(0)) >>> 0,
      0
    );
    return new THREE.Color().set(`hsl(${hash % 360}, 40%, 50%)`);
  }
  let r = 0, g = 0, b = 0;
  const tmp = new THREE.Color();
  for (const bd of buildings) {
    tmp.set(bd.color);
    r += tmp.r;
    g += tmp.g;
    b += tmp.b;
  }
  return new THREE.Color(r / buildings.length, g / buildings.length, b / buildings.length);
}
