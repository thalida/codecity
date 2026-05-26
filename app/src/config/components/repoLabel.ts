// config/components/repoLabel.ts — Floating repo-name label configuration.
// One nanostore drives the createRepoLabel() factory's transform uniforms
// via the hot-reloadable applyTheme() path.
//
//   ENABLED         — master visibility toggle. Hides the group without
//                     disposing geometry.
//   HEIGHT          — world units the panel's bottom sits above the
//                     floor (= the anchor's y, = the gem position).
//                     0 → panel sits flush with the floor (no beam
//                     visible). Larger → label rises, beam grows to span
//                     the gap from floor up to panel bottom.
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

import { map } from 'nanostores';

export interface RepoLabelConfig {
  ENABLED: boolean;
  HEIGHT: number;
  FONT_SIZE: number;
  ANIMATION_SPEED: number;
  OPACITY: number;
  BEAM_COLOR: string;
  TEXT_COLOR: string;
}

export const REPO_LABEL = map<RepoLabelConfig>({
  ENABLED: true,
  // Default: 0.85 × the tallest possible building (BUILDING_DIMENSIONS
  // MAX_FLOORS × FLOOR_HEIGHT = 96 × 16 = 1536; × 0.85 ≈ 1305).
  // Sits the label inside the silhouette band of an extreme-tall city
  // but clearly above any typical one. Tied to BUILDING_DIMENSIONS by
  // design, not by import — update both if either drifts.
  HEIGHT: 1305,
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
