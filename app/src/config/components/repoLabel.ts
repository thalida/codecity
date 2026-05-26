// config/components/repoLabel.ts — Floating repo-name label configuration.
// One nanostore drives the createRepoLabel() factory's transform uniforms
// via the hot-reloadable applyTheme() path.
//
//   ENABLED           — master visibility toggle. Hides the group without
//                       disposing geometry.
//   HEIGHT_ABOVE_CITY — world units lifted above max(cityHeight, gem.y).
//                       Also drives the beam length so the beam reaches
//                       from the gem up to the label panel.
//   ANIMATION_SPEED   — multiplier on glitch / pulse rates.
//   OPACITY           — 0..1, master opacity applied to all materials.

import { map } from 'nanostores';

export interface RepoLabelConfig {
  ENABLED: boolean;
  HEIGHT_ABOVE_CITY: number;
  ANIMATION_SPEED: number;
  OPACITY: number;
}

export const REPO_LABEL = map<RepoLabelConfig>({
  ENABLED: true,
  HEIGHT_ABOVE_CITY: 18,
  ANIMATION_SPEED: 1.0,
  OPACITY: 0.9,
});
