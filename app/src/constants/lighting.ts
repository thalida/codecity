// constants/lighting.ts — Scene-level directional lighting. Not user-tunable
// (no Settings control was ever exposed — the scene's sun is fixed in code), so
// plain constants rather than a persisted store. Read by the building shader
// (city/components/buildings) and the tree vertex-shading bake, both via
// city/utils/shaders/sunDir.
//
// Sun direction is expressed in spherical coords (compass bearing, height)
// rather than a raw vec3. The previous hard-coded direction was
// normalize(0.5, 1.0, 0.4) ≈ azimuth 51.34° / elevation 57.69°; rounded to
// 51° / 58° so the city looks the same out of the box.
//
//   SUN_AZIMUTH_DEG   — compass bearing. 0° points along +Z (south);
//                       increases clockwise (90° = +X / east).
//   SUN_ELEVATION_DEG — angle above the horizon. 0° = horizon, 90° = overhead.
//   AMBIENT           — base illumination on faces facing away from the sun.
//                       Cyberpunk model: ambient dominates so the dark side
//                       stays atmospheric / readable, not crushed to black.
//   SUN_CONTRAST      — extra brightening multiplier on sun-facing walls.

export const LIGHTING_SUN_AZIMUTH_DEG = 51;
export const LIGHTING_SUN_ELEVATION_DEG = 58;
export const LIGHTING_AMBIENT = 0.72;
export const LIGHTING_SUN_CONTRAST = 0.5;
