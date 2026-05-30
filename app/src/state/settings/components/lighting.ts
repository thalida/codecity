// state/settings/lighting.ts — Scene-level directional lighting controls.
// Replaces hardcoded SUN_DIR_WORLD / AMBIENT / DIFFUSE_GAIN consts in the
// building fragment shader. Persisted via attachPersistence(Config) at boot
// and wired through refreshBuildingMaterial() on every change.

import { map } from 'nanostores';

// Sun direction expressed in spherical coordinates rather than a raw vec3
// because users tweak "where the sun is" more naturally as
// (compass bearing, height) than as cartesian components.
//
//   SUN_AZIMUTH_DEG — compass bearing in degrees. 0° points the sun along
//                     +Z (south, in world coords); increases clockwise (east).
//   SUN_ELEVATION_DEG — angle above the horizon. 0° = on horizon,
//                       90° = directly overhead.
//
// The previous hard-coded direction was normalize(0.5, 1.0, 0.4), which
// corresponds to azimuth ≈ 51.34° and elevation ≈ 57.69°. We round to
// 51° / 58° as the default so the city looks the same out of the box.
//
//   AMBIENT       — base illumination on faces facing away from the sun.
//                   Cyberpunk lighting model: ambient dominates so the dark
//                   side stays atmospheric / readable rather than crushed
//                   to black.
//   SUN_CONTRAST  — additional brightening multiplier on sun-facing walls.
//                   Was DIFFUSE_GAIN in the shader. Renamed to SUN_CONTRAST
//                   for clarity in the UI.
export interface LightingConfig {
  SUN_AZIMUTH_DEG: number;
  SUN_ELEVATION_DEG: number;
  AMBIENT: number;
  SUN_CONTRAST: number;
}

export const LIGHTING = map<LightingConfig>({
  SUN_AZIMUTH_DEG: 51,
  SUN_ELEVATION_DEG: 58,
  AMBIENT: 0.72,
  SUN_CONTRAST: 0.5,
});
