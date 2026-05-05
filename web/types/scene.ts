// types/scene.ts — composite scene-wide shapes. The output of the
// layout step (CityLayout) and the bbox enclosing it (CityBbox).

import type * as THREE from 'three';
import type { Building } from './building';
import type { Street } from './street';
import type { FileStats, RangeStat } from './manifest';

/** Per-building connector strip from the door to the adjacent sidewalk. */
export interface BuildingPath {
  x: number;
  y: number;
  w: number;
  d: number;
  /** Back-pointer to the building's file (matches connector to its parent street). */
  file: import('./manifest').FileNode;
}

/** Axis-aligned bounding box around the entire laid-out city. */
export interface CityBbox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
  width: number;
  depth: number;
}

/**
 * Output of layoutCity(manifest). All world-space coordinates; no DOM /
 * three.js. The renderer (engine.ts) consumes this to build meshes.
 *
 * lineStats / byteStats are project-wide ranges computed once during
 * layout so each building can be normalized into the project's actual
 * range (smallest → MIN_*, largest → MAX_*).
 */
export interface CityLayout {
  buildings: Building[];
  streets: Street[];
  paths: BuildingPath[];
  lineStats: RangeStat;
  byteStats: RangeStat;
  bbox?: CityBbox;
}

export type { FileStats, RangeStat };

/** Building entering the scene this rebuild. Carries its target transform. */
export interface EnteringBuilding {
  mesh: THREE.Mesh;
  newPosition: THREE.Vector3;
  newScaleY: number;
}

/** Street entering the scene this rebuild. */
export interface EnteringStreet {
  mesh: THREE.Mesh;
}

/** Mesh that disappeared this rebuild (for either buildings or streets). */
export interface ExitingEntry {
  mesh: THREE.Mesh;
}

/**
 * Building present in both the prior and current build. Always carries
 * the new transform; the old transform is set only when the prior mesh
 * had a tracked position (so first-render staying meshes don't get a
 * spurious tween from origin).
 */
export interface StayingBuilding {
  oldMesh: THREE.Mesh;
  newMesh: THREE.Mesh;
  newPosition: THREE.Vector3;
  newScaleY: number;
  oldPosition?: THREE.Vector3;
  oldScaleY?: number;
}

/** Street present in both the prior and current build. */
export interface StayingStreet {
  oldMesh: THREE.Mesh;
  newMesh: THREE.Mesh;
}

/**
 * Payload published by cityScene.onChange after each applyManifest. Each
 * bucket holds the meshes that entered, exited, or stayed across the
 * rebuild — the animator uses entering/staying buildings to drive
 * grow-in / position tweens.
 */
export interface CitySceneDiff {
  entering: { buildings: EnteringBuilding[]; streets: EnteringStreet[] };
  exiting: { buildings: ExitingEntry[]; streets: ExitingEntry[] };
  staying: { buildings: StayingBuilding[]; streets: StayingStreet[] };
}
