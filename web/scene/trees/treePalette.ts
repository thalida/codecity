// scene/trees/treePalette.ts — deterministic tree color picker.
// Reads the live TREES store on every call so Settings UI changes
// flow through immediately.

import { TREES } from '@/config/trees.js';

function hashSeed(seed: number): number {
  return Math.imul(seed | 0, 0x9e3779b1) >>> 0;
}

function pickFrom(palette: string[], seed: number): string {
  return palette[hashSeed(seed) % palette.length];
}

export function pickTreeGreen(seed: number): string {
  return pickFrom(TREES.get().TREE_GREENS, seed);
}
