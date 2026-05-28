// config/fireflies.ts — Committer-fireflies tunables.
//
// v1 has one master switch. Future revisions can tune orb count,
// drift amplitude, glow intensity, etc.

import { map } from 'nanostores';

export interface FirefliesConfig {
  /** Master toggle — when false no fireflies are placed or rendered. */
  FIREFLIES_ENABLED: boolean;
}

export const FIREFLIES = map<FirefliesConfig>({
  FIREFLIES_ENABLED: true,
});
