// constants/lighting.ts — the scene's sun, fixed in code rather than a store:
// no Settings control was ever exposed for it.

/** Compass bearing: 0° is +Z, increasing clockwise. */
export const LIGHTING_SUN_AZIMUTH_DEG = 51;
/** Above the horizon: 0° horizon, 90° overhead. */
export const LIGHTING_SUN_ELEVATION_DEG = 58;
/** Ambient dominates, so the dark side stays readable rather than black. */
export const LIGHTING_AMBIENT = 0.72;
export const LIGHTING_SUN_CONTRAST = 0.5;
