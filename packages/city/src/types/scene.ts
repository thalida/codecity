// types/scene.ts — composite scene-wide shapes. The output of the
// layout step (CityLayout) and the bbox enclosing it (CityBbox).

import type { Building } from './building';
import type { Street } from './street';
import type { FileStats, RangeStat } from './manifest';

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

/** layoutCity's output: world-space, no DOM or three.js. lineStats/byteStats
 *  are project-wide, so a building normalizes into its own project's range. */
export interface CityLayout {
  buildings: Building[];
  streets: Street[];
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

/** A building in both the prior and current build. The old transform is
 *  present only when the prior manifest had it, so nothing tweens from zero. */
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
