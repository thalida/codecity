// city/utils/neutralPolygonOffset.ts — spread into any material whose draws
// come AFTER the polygonOffset users (streets, island, facade panels) in
// render order. Enabling the offset with zero factor/units is visually
// identical to disabling it, but forces the renderer to program the depth
// bias explicitly for these draws. Some mobile drivers (Samsung Xclipse via
// ANGLE-on-Vulkan) intermittently fail to reset the bias on the disable
// path, drawing later meshes with a stale/garbage bias — trees and fireflies
// randomly punching through the whole scene as full-screen color flashes.
export const NEUTRAL_POLYGON_OFFSET = {
  polygonOffset: true,
  polygonOffsetFactor: 0,
  polygonOffsetUnits: 0,
} as const;
