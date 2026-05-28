// config/committerSoil.ts — flat colored disc on the ground beneath
// each commit-tree, color-tinted to match the committer. Companion to
// the fireflies subsystem; same author-color signal, different visual.

import { map } from 'nanostores';

export interface CommitterSoilConfig {
  /** Master toggle — when false no rings are placed or rendered. */
  COMMITTER_SOIL_ENABLED: boolean;
  /** Ring radius as a multiplier of each tree's trunk radius. Minimum 1.0
   *  (= ring is the same size as the trunk); scales up to envelop more
   *  ground around the trunk. */
  SOIL_RADIUS_MULTIPLIER: number;
  /** Disc opacity, 0..1. Lower = blends more with ground. */
  SOIL_OPACITY: number;
}

export const COMMITTER_SOIL = map<CommitterSoilConfig>({
  COMMITTER_SOIL_ENABLED: true,
  SOIL_RADIUS_MULTIPLIER: 1.5,
  SOIL_OPACITY: 0.5,
});
