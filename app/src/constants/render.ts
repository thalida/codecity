// constants/render.ts — three.js renderOrder values. Lower draws first;
// higher draws on top. Tweaking risks z-fighting on coplanar / overlapping
// transparent meshes — treat as an implementation detail.

export const RENDER_ORDERS = {
  // Cyberpunk Valley layers — drawn before everything else so the
  // existing ground / building / outline stack composites over them.
  // SKY is the wallpaper at the back of the inverted icosphere; its
  // shader paints below-horizon as a solid uGroundColor fill, so no
  // separate floor mesh is needed. Mesas (-500) and foliage (~0) will
  // slot in between SKY and SIDEWALK.
  SKY: -1000, // procedural sky icosphere (draws first; lower hemisphere
  // also acts as the visual ground via uGroundColor)
  // Valley floor — a large flat plane world-anchored at y=0 beneath
  // the gem, painted with a forest-tinted color. Sits BETWEEN sky and
  // the city's own ground tiles (sidewalks/asphalt), so the city
  // geometry layers cleanly on top.
  VALLEY_FLOOR: -500,
  // City footprint — an asphalt slab built from inflated layout rects
  // that paints a contoured ring around the city silhouette. Sits
  // between the valley floor and the city's own ground tiles so that
  // sidewalks / asphalt / paths composite cleanly on top of it.
  CITY_FOOTPRINT: -250,
  SIDEWALK: 1, // baseline ground layer
  PATH_CONNECTOR: 2, // building→street walkways
  ASPHALT: 3, // street stripe (drawn over sidewalks)
  PATH_LINE: 4, // neon gem→selection line
  HOVER_OUTLINE: 5, // building hover wireframe
  BUILDING_OUTLINE: 5, // per-building default wireframe
  STREET_LABEL: 6, // baked road-name plane
  SELECTED_OUTLINE: 7, // chasing-rainbow selected wireframe
  // Floating repo-name label — drawn above buildings/outlines so it
  // reads cleanly against any silhouette. Additive blending; depth
  // test still on so distant city geometry never punches a hole in it.
  REPO_LABEL: 9,
  // Foliage (matte tree canopies + trunks + emissive bushes) draws
  // after the city. Depth-tested normally so buildings occlude foliage
  // that's behind them.
  PARK_FOLIAGE: 10,
} as const;
