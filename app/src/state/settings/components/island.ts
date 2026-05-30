// state/settings/island.ts — Floating-island world-plane configuration.
//
// Replaces the visual fields previously in WORLD (GROUND_COLOR,
// GROUND_ENABLED, ENABLED). Sizing config (GROUND_BUFFER_PERCENT)
// stays in WORLD since it pairs with worldBounds.
//
// All fields applied on Save via applyTheme() — islandMesh.applyConfig() pulls fresh values.

import { signal } from '@preact/signals';

export interface IslandGeometryConfig {
  ENABLED: boolean;
  SIDES: number;
  IRREGULARITY: number; // 0.0–0.5
  TIERS: number; // 1–4
  DEPTH: number; // fraction of island radius
  ROUNDNESS: number; // 0–1; controls underside taper exponent
  GRASS_THICKNESS: number; // 0–0.1; vertical grass band as fraction of island radius
}

export interface IslandMaterialsConfig {
  GRASS_COLOR: string;
  GRASS_SIDE_COLOR: string; // vertical band wrapping the top edge — tuned independently because hemispheric lighting hits side faces very differently than the top
  ROCK_COLOR: string;
  HEMI_SKY_COLOR: string; // warm "from above" tone
  HEMI_GROUND_COLOR: string; // cool "from below" tone
}

export const ISLAND_GEOMETRY = signal<IslandGeometryConfig>({
  ENABLED: true,
  SIDES: 32,
  IRREGULARITY: 0.12,
  TIERS: 5,
  DEPTH: 1.2,
  ROUNDNESS: 0.7, // exp = 2.0 - 0.7*1.93 ≈ 0.649 ≈ the previous hardcoded 0.65
  GRASS_THICKNESS: 0.025, // 2.5% of island radius — visible but subtle band
});

export const ISLAND_MATERIALS = signal<IslandMaterialsConfig>({
  GRASS_COLOR: '#18341f', // deep forest green
  GRASS_SIDE_COLOR: '#214529', // brighter than GRASS_COLOR to compensate for sideways-facing hemi lighting
  ROCK_COLOR: '#71778e', // cool slate/granite
  HEMI_SKY_COLOR: '#e8f6fc', // cool pale sky-blue from-above tone
  HEMI_GROUND_COLOR: '#031117', // very deep teal-black from-below tone
});
