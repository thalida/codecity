// config/trees.ts — Commit-driven tree configuration.
//
// One tree per commit. Trees are scattered uniformly across the world
// floor, sorted by distance to the gem (oldest commit closest),
// rejected from overlapping layout rects. Color encodes commit age
// (oldest → TREE_COLOR_OLD, newest → TREE_COLOR_NEW). Height encodes
// commit size (fewest files → TREE_MIN_HEIGHT_FLOORS, most → MAX).
// Canopy shape is picked deterministically per tree from the enabled
// SHAPE_* set.

import { map } from 'nanostores';

export interface TreesConfig {
  /** Master toggle — when false no trees are placed or rendered. */
  TREES_ENABLED: boolean;

  /** Foliage stops short of the plane edge by this percentage of the
   *  SHORTER plane half-extent. */
  EDGE_INSET_PERCENT: number;

  /** Smallest tree height (commit with the fewest changed files),
   *  expressed as a number of "building floors". */
  TREE_MIN_HEIGHT_FLOORS: number;

  /** Largest tree height (commit with the most changed files). */
  TREE_MAX_HEIGHT_FLOORS: number;

  /** Canopy XZ radius as a fraction of canopy height. Multiplied by
   *  the per-shape radius coefficient inside the renderer. */
  TREE_RADIUS_FRAC_OF_HEIGHT: number;

  /** Rejection-sampling footprint half-size as a fraction of
   *  BUILDING_DIMENSIONS.MAX_WIDTH. */
  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: number;

  /** Color for the oldest commit (interpolation endpoint, t=0). */
  TREE_COLOR_OLD: string;

  /** Color for the newest commit (interpolation endpoint, t=1). */
  TREE_COLOR_NEW: string;

  /** 0 = flat canopy (no vertex shading); 1 = base of canopy is fully
   *  darkened (vertex color 0,0,0). Linear interpolation along canopy Y. */
  TREE_SHADING_STRENGTH: number;

  /** Trunk cylinder color. */
  TREE_TRUNK_COLOR: string;

  /** Shape toggles — at least one must be true for any tree to render. */
  SHAPE_POINTY_ENABLED: boolean;
  SHAPE_ROUNDED_ENABLED: boolean;
  SHAPE_FIR_ENABLED: boolean;
  SHAPE_NARROW_ENABLED: boolean;
}

export const TREES = map<TreesConfig>({
  TREES_ENABLED: true,

  EDGE_INSET_PERCENT: 5,

  TREE_MIN_HEIGHT_FLOORS: 3,
  TREE_MAX_HEIGHT_FLOORS: 9,
  TREE_RADIUS_FRAC_OF_HEIGHT: 0.3,

  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,

  TREE_COLOR_OLD: '#1f5a2f',
  TREE_COLOR_NEW: '#a8d68a',
  TREE_SHADING_STRENGTH: 0.35,
  TREE_TRUNK_COLOR: '#4a3220',

  SHAPE_POINTY_ENABLED: true,
  SHAPE_ROUNDED_ENABLED: true,
  SHAPE_FIR_ENABLED: true,
  SHAPE_NARROW_ENABLED: true,
});
