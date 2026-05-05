// types/scene.ts — composite scene-wide shapes. The output of the
// layout step (CityLayout) and the bbox enclosing it (CityBbox).

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
