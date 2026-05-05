// constants/render.ts — three.js renderOrder values. Lower draws first;
// higher draws on top. Tweaking risks z-fighting on coplanar / overlapping
// transparent meshes — treat as an implementation detail.

export const RENDER_ORDERS = {
  SIDEWALK: 1, // baseline ground layer
  PATH_CONNECTOR: 2, // building→street walkways
  ASPHALT: 3, // street stripe (drawn over sidewalks)
  PATH_LINE: 4, // neon gem→selection line
  HOVER_OUTLINE: 5, // building hover wireframe
  BUILDING_OUTLINE: 5, // per-building default wireframe
  STREET_LABEL: 6, // baked road-name plane
  SELECTED_OUTLINE: 7, // chasing-rainbow selected wireframe
} as const;
