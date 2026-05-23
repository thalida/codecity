// config/island.ts — Floating-island world-plane configuration.
//
// Replaces the visual fields previously in WORLD (GROUND_COLOR,
// GROUND_ENABLED, ENABLED). Sizing config (GROUND_BUFFER_PERCENT)
// stays in WORLD since it pairs with worldBounds.
//
// All fields hot-reloadable via .listen() in islandMesh.applyConfig().

import { map } from 'nanostores';

export interface IslandGeometryConfig {
  ENABLED: boolean;
  SIDES: number;
  IRREGULARITY: number; // 0.0–0.5
  TIERS: number;        // 1–4
  DEPTH: number;        // fraction of island radius
}

export interface IslandMaterialsConfig {
  GRASS_COLOR: string;
  ROCK_COLOR: string;
  HEMI_SKY_COLOR: string;    // warm "from above" tone
  HEMI_GROUND_COLOR: string; // cool "from below" tone
}

export interface IslandUnderglowConfig {
  ENABLED: boolean;
  COLOR: string;
  STRENGTH: number;        // 0–2
  CORE_ENABLED: boolean;
  CORE_INTENSITY: number;  // HDR multiplier
}

export interface IslandAtmosphereConfig {
  DISTANCE_FOG_ENABLED: boolean;
  DISTANCE_FOG_COLOR: string;
  DISTANCE_FOG_NEAR: number;
  DISTANCE_FOG_FAR: number;
  SHADOW_DISC_ENABLED: boolean;
  SHADOW_DISC_OPACITY: number;     // 0–1
  SHADOW_DROP_DISTANCE: number;    // in island radii
}

export const ISLAND_GEOMETRY = map<IslandGeometryConfig>({
  ENABLED: true,
  SIDES: 12,
  IRREGULARITY: 0.32,
  TIERS: 4,
  DEPTH: 1.2,
});

export const ISLAND_MATERIALS = map<IslandMaterialsConfig>({
  GRASS_COLOR: '#3a7a4a',         // brighter, more saturated green
  ROCK_COLOR: '#a87a52',          // warm tan/brown (matches the lowpoly tree-island reference)
  HEMI_SKY_COLOR: '#e8d4b8',      // slightly less peachy, more cream — earthier
  HEMI_GROUND_COLOR: '#5a4a3a',   // warm dark earthy tone
});

export const ISLAND_UNDERGLOW = map<IslandUnderglowConfig>({
  // Off by default — the HDR core's bloom floods the underside no matter
  // how low STRENGTH/CORE_INTENSITY get, washing the rock color to red.
  // Users opt in via Controls if they want the glow.
  ENABLED: false,
  COLOR: '#ff5530',
  STRENGTH: 0.06,
  CORE_ENABLED: false,
  CORE_INTENSITY: 0.7,
});

export const ISLAND_ATMOSPHERE = map<IslandAtmosphereConfig>({
  DISTANCE_FOG_ENABLED: false,    // wired up in PR 3
  DISTANCE_FOG_COLOR: '#0a0612',
  DISTANCE_FOG_NEAR: 800,
  DISTANCE_FOG_FAR: 3200,
  SHADOW_DISC_ENABLED: false,     // wired up in PR 3
  SHADOW_DISC_OPACITY: 0.4,
  SHADOW_DROP_DISTANCE: 1.5,
});
