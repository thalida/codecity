// config/trees.ts — Commit-driven tree configuration.
//
// One tree per commit. Trees are scattered around the world floor with
// a density falloff (denser near the city, sparser far away), sorted
// by distance to the gem (oldest commit closest).
//
// Visual signals per tree:
//   - HEIGHT (canopy + trunk): driven by commit AGE — older commits
//     grow taller. Range in world units (independent of buildings):
//       TREE_MIN_HEIGHT  →  newest commit
//       TREE_MAX_HEIGHT  →  oldest commit
//   - WIDTH (canopy diameter): driven by commit FILES — bigger commits
//     are wider. Range in world units (independent of buildings):
//       TREE_MIN_WIDTH  →  fewest files
//       TREE_MAX_WIDTH  →  most files
//   - COLOR (canopy): two-color interpolation by COMMIT GAP (days
//     since the previous commit). Long gaps ("comeback" commits
//     after a quiet period) lean toward TREE_COLOR_NEW; short gaps
//     (routine daily cadence) lean toward TREE_COLOR_OLD.
//     Log-normalized.
//   - TRUNK: height = TRUNK_HEIGHT_FRAC × canopy height; radius =
//     TRUNK_RADIUS_FRAC_OF_CANOPY × canopy radius.

import { map } from 'nanostores';

export interface TreesConfig {
  /** Master toggle — when false no trees are placed or rendered. */
  TREES_ENABLED: boolean;

  /** Foliage stops short of the plane edge by this percentage of the
   *  SHORTER plane half-extent. */
  EDGE_INSET_PERCENT: number;

  /** Density falloff exponent applied to distance from the city bbox.
   *  0 = uniform (no falloff); higher = trees cluster tighter near the
   *  city. Acceptance probability per candidate is
   *  `(1 - dist/maxDist)^TREE_DENSITY_FALLOFF`. */
  TREE_DENSITY_FALLOFF: number;

  /** Smallest canopy height (newest commit) in world units. */
  TREE_MIN_HEIGHT: number;

  /** Largest canopy height (oldest commit) in world units. */
  TREE_MAX_HEIGHT: number;

  /** Smallest canopy diameter (commit with fewest files) in world units. */
  TREE_MIN_WIDTH: number;

  /** Largest canopy diameter (commit with most files) in world units. */
  TREE_MAX_WIDTH: number;

  /** Trunk height as a fraction of canopy height. */
  TRUNK_HEIGHT_FRAC: number;

  /** Trunk XZ radius as a fraction of canopy XZ radius. */
  TRUNK_RADIUS_FRAC_OF_CANOPY: number;

  /** How much of the trunk's top is hidden inside the canopy, as a
   *  fraction of trunk height. 0 = canopy sits exactly on top of the
   *  trunk (canopy bottom point touches trunk top). 1 = canopy bottom
   *  reaches the ground, hiding the entire trunk. Stretches the
   *  canopy down without changing its overall height. */
  CANOPY_TRUNK_OVERLAP_FRAC: number;

  /** Color for the oldest commit (interpolation endpoint, t=0). */
  TREE_COLOR_OLD: string;

  /** Color for the newest commit (interpolation endpoint, t=1). */
  TREE_COLOR_NEW: string;

  /** 0 = flat canopy (no vertex shading); 1 = base of canopy fully dark. */
  TREE_SHADING_STRENGTH: number;

  /** Trunk cylinder color. */
  TREE_TRUNK_COLOR: string;

  /** Rejection-sampling footprint half-size as a fraction of
   *  BUILDING_DIMENSIONS.MAX_WIDTH. */
  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: number;
}

export const TREES = map<TreesConfig>({
  TREES_ENABLED: true,

  EDGE_INSET_PERCENT: 1,
  TREE_DENSITY_FALLOFF: 1.5,

  TREE_MIN_HEIGHT: 16,
  TREE_MAX_HEIGHT: 64,

  TREE_MIN_WIDTH: 32,
  TREE_MAX_WIDTH: 48,

  TRUNK_HEIGHT_FRAC: 0.35,
  TRUNK_RADIUS_FRAC_OF_CANOPY: 0.15,
  CANOPY_TRUNK_OVERLAP_FRAC: 0.10,

  TREE_COLOR_OLD: '#0a2613',
  TREE_COLOR_NEW: '#a8d68a',
  TREE_SHADING_STRENGTH: 0.65,
  TREE_TRUNK_COLOR: '#231810',

  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
});
