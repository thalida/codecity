// city/components/buildings/seed.ts — per-building deterministic seed.

/**
 * Per-instance random seed derived from a file path. Deterministic across
 * rebuilds, so a building's facade pattern doesn't shuffle on every
 * live-update poll. Output is normalized to [0, 1).
 */
export function seedFromPath(path: string): number {
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime, 32-bit safe via imul
  }
  return (h >>> 0) / 4294967296;
}
