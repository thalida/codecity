// config/components/repoLabel.ts — Floating repo-name label configuration.
// One nanostore drives the createRepoLabel() factory's style + transform
// uniforms via the hot-reloadable applyTheme() path.
//
//   STYLE             — 'ring' | 'hologram' | 'concentric'. Switches
//                       which sub-renderer paints the label. Geometry
//                       rebuild fires only when this key changes.
//   ENABLED           — master visibility toggle. Hides the group
//                       without disposing geometry.
//   HEIGHT_ABOVE_CITY — world units lifted above max(cityHeight, gem.y).
//   ANIMATION_SPEED   — multiplier on spin / glitch / pulse rates.
//   OPACITY           — 0..1, master opacity applied to all styles.

import { map } from 'nanostores';

export type RepoLabelStyle = 'ring' | 'hologram' | 'concentric';

export interface RepoLabelConfig {
  ENABLED: boolean;
  STYLE: RepoLabelStyle;
  HEIGHT_ABOVE_CITY: number;
  ANIMATION_SPEED: number;
  OPACITY: number;
}

export const REPO_LABEL = map<RepoLabelConfig>({
  ENABLED: true,
  STYLE: 'ring',
  HEIGHT_ABOVE_CITY: 18,
  ANIMATION_SPEED: 1.0,
  OPACITY: 0.9,
});
