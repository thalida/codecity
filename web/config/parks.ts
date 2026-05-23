// config/parks.ts — Cyberpunk Valley parks configuration.
//
// One unified model: scatter foliage across the entire visible
// ground plane (a circle of radius CAMERA_PERSPECTIVE.FAR around the
// city center). Three knobs control how much / where:
//
//   DENSITY_PERCENT          — overall density of the scene. 100%
//                              ≈ the plane is fully populated; 50%
//                              ≈ half density; 0% = no trees.
//   CITY_DENSITY_PERCENT     — density INSIDE the city as a
//                              percentage of the OUTSKIRTS density.
//                              100 = uniform, 50 = city plazas have
//                              half as many trees as the forest,
//                              0 = no trees inside the city at all.
//   GRADIENT_REACH_PERCENT   — how far the gradient transitions from
//                              CITY_DENSITY to full density, as a
//                              percentage of the plane. 0 = no
//                              gradient (hard switch at the city
//                              edge); 100 = density rises gradually
//                              all the way to the plane edge.
//
// The "city distance" used by the gradient is each candidate's
// distance to the nearest layout rect (building / street / path).
// At d=0 (inside or touching a building) → city density; at
// d ≥ gradient reach → full density.

import { map } from 'nanostores';

export interface ParksConfig {
  ENABLED: boolean;

  /** Overall density of the visible plane, 0–100. 100 ≈ "every
   *  candidate accepted"; effectively fills the plane.  */
  DENSITY_PERCENT: number;
  /** Density INSIDE the city as a percentage of the OUTSKIRTS
   *  density, 0–100. 100 = uniform across the plane; 0 = no trees
   *  inside the city. */
  CITY_DENSITY_PERCENT: number;
  /** Range over which density transitions from CITY_DENSITY to full
   *  density, as a percentage of the plane (CAMERA_PERSPECTIVE.FAR).
   *  Smaller = sharper transition near the city edge; larger =
   *  smoother fade across the plane. */
  GRADIENT_REACH_PERCENT: number;

  // ── Mix: what fraction of placements are each element kind. The
  //    three values should sum to ≤ 1.0; any remainder = empty. ──
  MIX_TREE_FRAC: number;
  MIX_BUSH_FRAC: number;
  MIX_FLOWER_FRAC: number;

  // ── Sizing (multipliers of BUILDING_DIMENSIONS) ──
  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: number;
  TREE_HEIGHT_FLOORS: number;
  TREE_RADIUS_FRAC_OF_HEIGHT: number;
  BUSH_RADIUS_FRAC_OF_TREE: number;
  FLOWER_SIZE_FRAC_OF_TREE: number;
  FLOWERS_PER_BUSH: number;
  FLOWERS_PER_CLUSTER: number;

  /** Foliage stops short of the plane edge by this percentage of the
   *  SHORTER plane half-extent. Using the shorter axis guarantees the
   *  absolute bare-ground margin is equal on all four sides of a
   *  rectangular plane. 0 = trees right up to the edge; 25 = wide
   *  bare-ground margin all around. */
  EDGE_INSET_PERCENT: number;
}

export const PARKS = map<ParksConfig>({
  ENABLED: true,

  // Density knobs are kept at 100% (uniform full coverage) by default.
  // The UI controls have been removed — trees are commit-driven, and
  // bushes/flowers (off by default) pack uniformly at full density
  // when re-enabled. Adjust here if you want non-uniform scatter.
  DENSITY_PERCENT: 100,
  CITY_DENSITY_PERCENT: 100,
  GRADIENT_REACH_PERCENT: 100,

  // 65% trees, 25% bushes, 10% flower clusters.
  MIX_TREE_FRAC: 0.65,
  MIX_BUSH_FRAC: 0.25,
  MIX_FLOWER_FRAC: 0.10,

  SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
  TREE_HEIGHT_FLOORS: 6,
  TREE_RADIUS_FRAC_OF_HEIGHT: 0.3,
  BUSH_RADIUS_FRAC_OF_TREE: 0.4,
  FLOWER_SIZE_FRAC_OF_TREE: 0.08,
  FLOWERS_PER_BUSH: 4,
  FLOWERS_PER_CLUSTER: 8,

  // 5% of the shorter plane half-extent — a clean, even grass border
  // that reads the same on square and wide-rectangular planes.
  EDGE_INSET_PERCENT: 5,
});

export interface ParksPaletteConfig {
  // Per-mesh visibility toggles — flip mesh.visible only.
  GROUND_ENABLED: boolean;
  TREES_ENABLED: boolean;
  BUSHES_ENABLED: boolean;
  FLOWERS_ENABLED: boolean;

  /** Color of the world floor mesh — the actual ground the camera sees
   *  within the world bounds. A large flat plane world-anchored at y=0
   *  beneath the gem, tinted to give the ground a forest color. */
  GROUND_COLOR: string;

  /** Padding past the city's bounding box as a percentage of the city's
   *  longest dimension. 0 = plane exactly fits the city; 15 = default
   *  generous halo of bare ground; 50 = very wide margin. */
  GROUND_BUFFER_PERCENT: number;

  TREE_GREENS: string[];
  TREE_TRUNK_COLOR: string;
  BUSH_NEON_COLORS: string[];
  BUSH_EMISSION_BOOST: number;   // >1 → HDR bloom
  FLOWER_COLORS: string[];
  FLOWER_EMISSION_BOOST: number; // >1 → HDR bloom
}

export const PARKS_PALETTE = map<ParksPaletteConfig>({
  GROUND_ENABLED: true,
  TREES_ENABLED: true,
  BUSHES_ENABLED: false,
  FLOWERS_ENABLED: false,

  // Dark forest tone — what the camera sees as "the floor of the
  // world" anywhere there isn't city geometry or a discrete tree.
  GROUND_COLOR: '#030706',

  // 30% of the city's longest dimension (including vertical extent for
  // small-but-tall cities) — a generous halo of bare ground past the
  // city, capped at an absolute floor in worldBounds so tiny cities
  // still feel airy.
  GROUND_BUFFER_PERCENT: 30,

  TREE_GREENS: ['#2a6a4a', '#3a7a3a', '#4a8a4a', '#1f5a2f'],
  TREE_TRUNK_COLOR: '#4a3220',

  BUSH_NEON_COLORS: ['#00ff88', '#ff2bd6', '#b400ff', '#00d9ff', '#ffd400'],
  BUSH_EMISSION_BOOST: 1.5,

  FLOWER_COLORS: ['#ff2bd6', '#ffd400', '#00d9ff', '#00ff88', '#b400ff'],
  FLOWER_EMISSION_BOOST: 1.8,
});
