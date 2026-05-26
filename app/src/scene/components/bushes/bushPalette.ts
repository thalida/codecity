// scene/bushes/bushPalette.ts — deterministic bush color picker.
// Reads the live BUSHES store on every call so Settings UI changes
// flow through immediately.

import { BUSHES } from '@/config/components/bushes.js';

function hashSeed(seed: number): number {
  return Math.imul(seed | 0, 0x9e3779b1) >>> 0;
}

function pickFrom(palette: string[], seed: number): string {
  return palette[hashSeed(seed) % palette.length];
}

export function pickBushNeon(seed: number): string {
  return pickFrom(BUSHES.get().BUSH_NEON_COLORS, seed);
}
