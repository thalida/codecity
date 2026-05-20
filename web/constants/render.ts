// constants/render.ts — three.js renderOrder values. Lower draws first;
// higher draws on top. Tweaking risks z-fighting on coplanar / overlapping
// transparent meshes — treat as an implementation detail.

export const RENDER_ORDERS = {
  // Cyberpunk Valley layers — drawn before everything else so the
  // existing ground / building / outline stack composites over them.
  // SKY is the wallpaper at the back of the inverted icosphere; further
  // Cyberpunk Valley layers (mesas, parks) will use values between
  // SKY (-1000) and SIDEWALK (1).
  SKY: -1000, // procedural sky icosphere (draws first)
  SIDEWALK: 1, // baseline ground layer
  PATH_CONNECTOR: 2, // building→street walkways
  ASPHALT: 3, // street stripe (drawn over sidewalks)
  PATH_LINE: 4, // neon gem→selection line
  HOVER_OUTLINE: 5, // building hover wireframe
  BUILDING_OUTLINE: 5, // per-building default wireframe
  STREET_LABEL: 6, // baked road-name plane
  SELECTED_OUTLINE: 7, // chasing-rainbow selected wireframe
} as const;
