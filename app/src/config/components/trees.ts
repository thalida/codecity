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
//   - COLOR (canopy): two-color interpolation by COMMITS-PER-DAY.
//     Solo-commit days lean toward TREE_COLOR_SOLO_DAY;
//     busy days (many commits sharing that day) lean toward
//     TREE_COLOR_BUSY_DAY. All commits on the same date
//     share a color. Log-normalized.
//     When TREE_AGE_DESAT_ENABLED is true, the resulting color is
//     additionally scaled in HSL.S by a factor ramped from
//     TREE_AGE_SATURATION_MIN (oldest commit) to TREE_AGE_SATURATION_MAX
//     (newest commit) — so older trees fade toward gray.
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

  /** Color trees interpolate toward on a busy day (many commits share the same date). */
  TREE_COLOR_BUSY_DAY: string;

  /** Color trees interpolate toward on a solo day (only one commit on its date). */
  TREE_COLOR_SOLO_DAY: string;

  /** 0 = flat canopy (no vertex shading); 1 = base of canopy fully dark. */
  TREE_SHADING_STRENGTH: number;

  /** Trunk cylinder color. */
  TREE_TRUNK_COLOR: string;

  /** Rejection-sampling footprint half-size as a fraction of
   *  BUILDING_DIMENSIONS.MAX_WIDTH. */
  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: number;

  /** When true, trees desaturate based on commit age — oldest commits
   *  get washed toward gray, newest keep full color. */
  TREE_AGE_DESAT_ENABLED: boolean;

  /** Fraction of base saturation retained at the OLDEST commit's age
   *  (percent, 0-100). 0 = fully gray, 100 = no desaturation.
   *  Only applied when TREE_AGE_DESAT_ENABLED. */
  TREE_AGE_SATURATION_MIN: number;

  /** Fraction of base saturation retained at the NEWEST commit's age
   *  (percent, 0-100). 100 = colors at full strength. */
  TREE_AGE_SATURATION_MAX: number;
}

export const TREES = map<TreesConfig>({
  TREES_ENABLED: true,

  EDGE_INSET_PERCENT: 1,
  TREE_DENSITY_FALLOFF: 1.5,

  TREE_MIN_HEIGHT: 16,
  TREE_MAX_HEIGHT: 96,

  TREE_MIN_WIDTH: 32,
  TREE_MAX_WIDTH: 64,

  TRUNK_HEIGHT_FRAC: 0.35,
  TRUNK_RADIUS_FRAC_OF_CANOPY: 0.15,
  CANOPY_TRUNK_OVERLAP_FRAC: 0.1,

  TREE_COLOR_BUSY_DAY: '#05140a',
  TREE_COLOR_SOLO_DAY: '#165028',
  TREE_SHADING_STRENGTH: 0.65,
  TREE_TRUNK_COLOR: '#110c08',

  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,

  TREE_AGE_DESAT_ENABLED: true,
  TREE_AGE_SATURATION_MIN: 50,
  TREE_AGE_SATURATION_MAX: 100,
});
