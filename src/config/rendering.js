// config/rendering.js — renderOrder integers + transparency cutoffs.
// renderOrder controls the back-to-front draw order of overlapping
// transparent meshes. Tweaking these changes which surface wins when two
// meshes overlap; raise/lower with care.

import { map } from 'nanostores';

export const RENDER_ORDERS = map({
  SIDEWALK:         1,        // baseline ground layer
  PATH_CONNECTOR:   2,        // building→street walkways
  ASPHALT:          3,        // street stripe (drawn over sidewalks)
  PIVOT_PING:       4,        // orbit pivot flash
  PATH_LINE:        4,        // neon gem→selection line
  HOVER_OUTLINE:    5,        // building hover wireframe
  BUILDING_OUTLINE: 5,        // per-building default wireframe
  STREET_LABEL:     6,        // baked road-name plane
  SELECTED_OUTLINE: 7         // chasing-rainbow selected wireframe
});

// Materials with opacity below this go transparent (depthWrite off,
// alpha-blending on). Above it they're treated as opaque even if their
// material declares transparent: true.
export const TRANSPARENCY = map({
  OPAQUE_THRESHOLD: 0.999
});
