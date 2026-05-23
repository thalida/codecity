// config/trees.ts — Commit-driven tree configuration.
//
// One tree per commit. Trees are scattered uniformly across the world
// floor, sorted by distance to the gem (oldest commit closest),
// rejected from overlapping layout rects.

import { map } from 'nanostores';

export interface TreesConfig {
  /** Master toggle — when false no trees are placed or rendered. */
  TREES_ENABLED: boolean;

  /** Foliage stops short of the plane edge by this percentage of the
   *  SHORTER plane half-extent. Using the shorter axis guarantees the
   *  absolute bare-ground margin is equal on all four sides of a
   *  rectangular plane. 0 = trees right up to the edge; 25 = wide
   *  bare-ground margin all around. */
  EDGE_INSET_PERCENT: number;

  /** Tree canopy height expressed as a number of "building floors"
   *  (multiplied by BUILDING_DIMENSIONS.FLOOR_HEIGHT at render time). */
  TREE_HEIGHT_FLOORS: number;

  /** Canopy cone radius as a fraction of tree height. */
  TREE_RADIUS_FRAC_OF_HEIGHT: number;

  /** Rejection-sampling footprint half-size as a fraction of
   *  BUILDING_DIMENSIONS.MAX_WIDTH. Candidates within this radius
   *  of a layout rect are discarded. */
  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: number;

  /** Tree canopy color palette (dark forest greens). */
  TREE_GREENS: string[];

  /** Trunk cylinder color. */
  TREE_TRUNK_COLOR: string;
}

export const TREES = map<TreesConfig>({
  TREES_ENABLED: true,

  // 5% of the shorter plane half-extent — a clean, even grass border
  // that reads the same on square and wide-rectangular planes.
  EDGE_INSET_PERCENT: 5,

  TREE_HEIGHT_FLOORS: 6,
  TREE_RADIUS_FRAC_OF_HEIGHT: 0.3,

  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,

  TREE_GREENS: ['#2a6a4a', '#3a7a3a', '#4a8a4a', '#1f5a2f'],
  TREE_TRUNK_COLOR: '#4a3220',
});
