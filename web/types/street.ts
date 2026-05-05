// types/street.ts — pairs with config/street.ts (the tunables).
// Defines the Street shape the layout step produces.

import type { DirNode } from './manifest';

/** Street long-axis. 'x' = runs along world-X, 'y' = along world-Z. */
export enum StreetAxis {
  X = 'x',
  Y = 'y',
}

/**
 * Which end(s) of a street's centerline get a rounded cap.
 *   Both — both ends rounded (only the root street)
 *   Low  — round the lower-coordinate end (closed end of a child street)
 *   High — round the higher-coordinate end (closed end of a child street)
 */
export enum CapStyle {
  Both = 'both',
  Low = 'low',
  High = 'high',
}

/**
 * Which end of a child street meets its parent T-intersection.
 * Set by layout, read by engine to decide which cap stays open
 * (the open end is where the street merges into the parent's asphalt).
 */
export enum JoinSide {
  Low = 'low',
  High = 'high',
}

/**
 * One street in the laid-out city.
 *   x, y       — center on the ground plane
 *   width      — perpendicular width (sidewalks + asphalt)
 *   length     — extent along orientation axis
 *   label      — text painted along the road
 *   dir        — manifest directory node this street represents
 *   isRoot     — true for the root-of-repo street (gets the gem)
 */
export interface Street {
  x: number;
  y: number;
  width: number;
  length: number;
  label: string;
  dir: DirNode;
  orientation: StreetAxis;
  isRoot?: boolean;
}
