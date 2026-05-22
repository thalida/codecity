// scene/parks/parksPalette.ts — deterministic palette pickers for the
// parks layer. Each plot is assigned a seed during placement; the
// renderer then asks for tree / bush / flower colors with seeds derived
// from that plot seed (plotSeed, plotSeed+1, plotSeed+2, ...). Same
// layout → same plot seeds → same colors across reloads.
//
// Pickers read the live PARKS_PALETTE store on every call so a Settings
// UI change immediately flows through to the next renderer rebuild.
// Pure functions — no caching, no class, no factory.

import { PARKS_PALETTE } from '@/config/parks.js';

/**
 * Knuth multiplicative hash: 32-bit multiply by the golden ratio
 * constant 0x9E3779B1 distributes consecutive integers across the
 * 32-bit range so that `hashSeed(n) % paletteLen` lands evenly across
 * palette slots even when seeds are sequential plot indices.
 * `Math.imul` performs the multiplication mod 2^32; `>>> 0` coerces
 * back to an unsigned 32-bit integer for the modulo.
 */
function hashSeed(seed: number): number {
  return Math.imul(seed | 0, 0x9e3779b1) >>> 0;
}

function pickFrom(palette: string[], seed: number): string {
  return palette[hashSeed(seed) % palette.length];
}

export function pickTreeGreen(seed: number): string {
  return pickFrom(PARKS_PALETTE.get().TREE_GREENS, seed);
}

export function pickBushNeon(seed: number): string {
  return pickFrom(PARKS_PALETTE.get().BUSH_NEON_COLORS, seed);
}

export function pickFlowerColor(seed: number): string {
  return pickFrom(PARKS_PALETTE.get().FLOWER_COLORS, seed);
}
