// city/utils/neutralPolygonOffset.ts — spread into materials that draw AFTER
// the polygonOffset users (streets, island, facade panels). A zero-factor
// offset looks identical to none, but programs the depth bias explicitly:
// some mobile drivers don't reset it on the disable path.
export const NEUTRAL_POLYGON_OFFSET = {
  polygonOffset: true,
  polygonOffsetFactor: 0,
  polygonOffsetUnits: 0,
} as const;
