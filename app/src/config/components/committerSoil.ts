// config/committerSoil.ts — flat colored disc on the ground beneath
// each commit-tree, color-tinted to match the committer. Companion to
// the fireflies subsystem; same author-color signal, different visual.

import { map } from 'nanostores';

export interface CommitterSoilConfig {
  /** Master toggle — when false no rings are placed or rendered. */
  COMMITTER_SOIL_ENABLED: boolean;
  /** Disc radius in world units. */
  SOIL_RADIUS: number;
  /** Disc opacity, 0..1. Lower = blends more with ground. */
  SOIL_OPACITY: number;
}

export const COMMITTER_SOIL = map<CommitterSoilConfig>({
  COMMITTER_SOIL_ENABLED: true,
  SOIL_RADIUS: 2.0,
  SOIL_OPACITY: 0.5,
});
