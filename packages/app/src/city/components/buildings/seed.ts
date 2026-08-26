// city/components/buildings/seed.ts — per-building deterministic seed.

/** A seed from a file's path, so a building's facade doesn't reshuffle itself
 *  on every live-update poll. */
export function seedFromPath(path: string): number {
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime, 32-bit safe via imul
  }
  return (h >>> 0) / 4294967296;
}
