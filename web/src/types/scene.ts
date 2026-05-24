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
  /** Slot index within the CellTile (same as building.slotId). */
  instanceId: number;
  /** The Building object, carrying cellId + slotId back-pointers. */
  building?: Building;
  /** Full-size scale components (w, h, d). */
  newScaleX: number;
  newScaleY: number;
  newScaleZ: number;
  /** World-space center position (x, h/2, z). */
  newPosX: number;
  newPosY: number;
  newPosZ: number;
}

/** Street entering the scene this rebuild. */
export interface EnteringStreet {
  mesh: THREE.Mesh;
}

/**
 * Building or street that disappeared this rebuild. For streets this
 * still carries a mesh reference; for buildings the exiting bucket is
 * informational only (no exit animation in V1 — the instance is simply
 * no longer drawn once its block is rebuilt).
 */
export interface ExitingEntry {
  mesh?: THREE.Mesh;
}

/**
 * Building present in both the prior and current build. Always carries
 * the new transform; old transform fields are present when the prior
 * manifest had this building (so first-render staying buildings don't
 * get a spurious tween from zero).
 */
export interface StayingBuilding {
  /** Slot index within the CellTile (same as building.slotId). */
  instanceId: number;
  /** The Building object, carrying cellId + slotId back-pointers. */
  building?: Building;
  /** New (post-rebuild) scale components (w, h, d). */
  newScaleX: number;
  newScaleY: number;
  newScaleZ: number;
  /** New world-space center position (x, h/2, z). */
  newPosX: number;
  newPosY: number;
  newPosZ: number;
  /** Prior scale components — undefined if no prior transform was captured. */
  oldScaleX?: number;
  oldScaleY?: number;
  oldScaleZ?: number;
  /** Prior world-space center position — undefined if no prior transform. */
  oldPosX?: number;
  oldPosY?: number;
  oldPosZ?: number;
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
