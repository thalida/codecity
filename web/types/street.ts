// types/street.ts — pairs with config/street.ts (the tunables).
// Defines the Street shape the layout step produces.

import type { DirNode } from './manifest';

/** Street long-axis. 'x' = runs along world-X, 'y' = along world-Z. */
export enum StreetAxis {
  X = 'x',
  Y = 'y',
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
