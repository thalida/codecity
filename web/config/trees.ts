// config/trees.ts — Commit-driven tree configuration.
//
// One tree per commit. Trees are scattered around the world floor with
// a density falloff (denser near the city, sparser far away), sorted
// by distance to the gem (oldest commit closest).
//
// Visual signals per tree:
//   - HEIGHT (canopy + trunk): driven by commit AGE — older commits
//     grow taller. Range:
//       TREE_MIN_HEIGHT_FLOORS × FLOOR_HEIGHT  →  smallest tree
//       TREE_MAX_HEIGHT_FLOORS × FLOOR_HEIGHT  →  tallest tree
//   - WIDTH (canopy diameter): driven by commit FILES — bigger commits
//     are wider, scaled to the BUILDING width range:
//       TREE_MIN_WIDTH_FRAC × BUILDING_DIMENSIONS.MIN_WIDTH  →  narrowest
//       TREE_MAX_WIDTH_FRAC × BUILDING_DIMENSIONS.MAX_WIDTH  →  widest
//   - COLOR (canopy): two-color interpolation by AGE — newer commits
//     interpolate toward TREE_COLOR_NEW, older toward TREE_COLOR_OLD
//     (deep dark green).
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

  /** Smallest canopy height (newest commit) in "building floors". */
  TREE_MIN_HEIGHT_FLOORS: number;

  /** Largest canopy height (oldest commit) in "building floors". */
  TREE_MAX_HEIGHT_FLOORS: number;

  /** Smallest canopy diameter (commit with fewest files) as a
   *  fraction of BUILDING_DIMENSIONS.MIN_WIDTH. */
  TREE_MIN_WIDTH_FRAC: number;

  /** Largest canopy diameter (commit with most files) as a fraction
   *  of BUILDING_DIMENSIONS.MAX_WIDTH. */
  TREE_MAX_WIDTH_FRAC: number;

  /** Trunk height as a fraction of canopy height. */
  TRUNK_HEIGHT_FRAC: number;

  /** Trunk XZ radius as a fraction of canopy XZ radius. */
  TRUNK_RADIUS_FRAC_OF_CANOPY: number;

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

  EDGE_INSET_PERCENT: 5,
  TREE_DENSITY_FALLOFF: 1.5,

  TREE_MIN_HEIGHT_FLOORS: 3,
  TREE_MAX_HEIGHT_FLOORS: 9,

  TREE_MIN_WIDTH_FRAC: 0.5,
  TREE_MAX_WIDTH_FRAC: 0.5,

  TRUNK_HEIGHT_FRAC: 0.25,
  TRUNK_RADIUS_FRAC_OF_CANOPY: 0.15,

  TREE_COLOR_OLD: '#0a2613',
  TREE_COLOR_NEW: '#a8d68a',
  TREE_SHADING_STRENGTH: 0.35,
  TREE_TRUNK_COLOR: '#4a3220',

  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
});
