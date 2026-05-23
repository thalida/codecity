// config/bushes.ts — Decorative bush configuration.
//
// Bushes are decorative scatter (not commit-driven). They use a
// density-gradient approach and render as emissive icosahedra that
// push into HDR bloom.

import { map } from 'nanostores';

export interface BushesConfig {
  /** Master toggle — when false no bushes are placed or rendered. */
  BUSHES_ENABLED: boolean;

  /** Bush icosphere radius as a fraction of the tree canopy radius. */
  BUSH_RADIUS_FRAC_OF_TREE: number;

  /** Neon color palette for bush icosahedra. */
  BUSH_NEON_COLORS: string[];

  /** Emission multiplier pushed to the HDR bloom pass. >1 means the
   *  color exceeds the [0,1] range and triggers bloom. */
  BUSH_EMISSION_BOOST: number;
}

export const BUSHES = map<BushesConfig>({
  BUSHES_ENABLED: false,

  BUSH_RADIUS_FRAC_OF_TREE: 0.4,

  BUSH_NEON_COLORS: ['#00ff88', '#ff2bd6', '#b400ff', '#00d9ff', '#ffd400'],
  BUSH_EMISSION_BOOST: 1.5,
});
