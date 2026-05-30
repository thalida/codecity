// state/settings/components/repoLabel.ts — Floating repo-name label configuration.
// One nanostore drives the createRepoLabel() factory's transform uniforms
// via applyTheme() on Save — see configCommitReactions.ts.
//
//   ENABLED         — master visibility toggle. Hides the group without
//                     disposing geometry.
//   HEIGHT_PCT      — percent of max allowed building height
//                     (MAX_FLOORS × FLOOR_HEIGHT) at which the panel's
//                     bottom sits above the floor. 0 = panel sits flush
//                     with the island floor (no beam visible); 100 =
//                     level with the tallest possible building; 200 =
//                     double that. Default 85 ≈ inside the silhouette
//                     band of an extreme-tall city.
//   FONT_SIZE       — panel (= text) height in world units. Default
//                     matches BUILDING_DIMENSIONS.MAX_WIDTH (96), so
//                     the label reads as roughly the same scale as the
//                     biggest single building in the scene — a banner,
//                     not a sticker. Panel width = FONT_SIZE ×
//                     textureAspect, so long repo names get wider
//                     panels instead of squished text.
//   ANIMATION_SPEED — multiplier on glitch / pulse rates.
//   OPACITY         — 0..1, master opacity applied to all materials.
//   BEAM_COLOR      — hex color for the light beam rising from the gem.
//                     Defaults to cyan (#33ffff).
//   TEXT_COLOR      — hex tint applied to the holographic text panel.
//                     White (#ffffff) preserves the chromatic-aberration
//                     look; other colors fold the aberration into the
//                     chosen hue.

import { signal } from '@preact/signals';

export interface RepoLabelConfig {
  ENABLED: boolean;
  HEIGHT_PCT: number;
  FONT_SIZE: number;
  ANIMATION_SPEED: number;
  OPACITY: number;
  BEAM_COLOR: string;
  TEXT_COLOR: string;
}

export const REPO_LABEL = signal<RepoLabelConfig>({
  ENABLED: true,
  HEIGHT_PCT: 85,
  // Tuned by eye to feel like a substantial banner above the city
  // at default camera framing — roughly 1.3× BUILDING_DIMENSIONS.MAX_WIDTH
  // (96 × 1.33 ≈ 128) so the label scales bigger than the biggest
  // single building.
  FONT_SIZE: 128,
  ANIMATION_SPEED: 1.0,
  OPACITY: 0.9,
  BEAM_COLOR: '#bfb3ff',
  TEXT_COLOR: '#ffffff',
});
