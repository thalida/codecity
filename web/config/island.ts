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
  SOIL_COLOR: string;
  ROCK_LIGHT: string;
  ROCK_MID: string;
  ROCK_DARK: string;
  SUN_CONTRAST: number;
  AMBIENT: number;
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
  IRREGULARITY: 0.18,
  TIERS: 2,
  DEPTH: 0.6,
});

export const ISLAND_MATERIALS = map<IslandMaterialsConfig>({
  GRASS_COLOR: '#1a2620',
  SOIL_COLOR: '#2a1f24',
  ROCK_LIGHT: '#1a1a22',
  ROCK_MID: '#12121a',
  ROCK_DARK: '#0a0a10',
  SUN_CONTRAST: 0.7,
  AMBIENT: 0.45,
});

export const ISLAND_UNDERGLOW = map<IslandUnderglowConfig>({
  ENABLED: true,
  COLOR: '#ff3a5c',
  STRENGTH: 0.9,
  CORE_ENABLED: true,
  CORE_INTENSITY: 2.4,
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
