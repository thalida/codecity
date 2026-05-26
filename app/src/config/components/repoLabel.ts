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

import { map } from 'nanostores';

export interface RepoLabelConfig {
  ENABLED: boolean;
  HEIGHT: number;
  FONT_SIZE: number;
  ANIMATION_SPEED: number;
  OPACITY: number;
}

export const REPO_LABEL = map<RepoLabelConfig>({
  ENABLED: true,
  // Default elevation: high enough that the label sits well above a
  // typical city silhouette but the user immediately sees how the
  // slider behaves (try 0 → label on floor; try 1500 → label way up
  // past the tallest possible building).
  HEIGHT: 200,
  // Tracks BUILDING_DIMENSIONS.MAX_WIDTH default (96). Update both if
  // either ever drifts — they're tied by design, not by import (the
  // import would force a module-load order that adds no real value).
  FONT_SIZE: 96,
  ANIMATION_SPEED: 1.0,
  OPACITY: 0.9,
});
