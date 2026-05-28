// scene/committerSoil/soilPlacement.ts — derive one ring per tree.
// Color comes from colorForAuthor(commit.author), shared with the
// fireflies subsystem.

import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import { colorForAuthor } from '@/scene/components/fireflies/authorColor.js';

export interface SoilPlacement {
  /** Tree center, world X (ring is centered here). */
  treeX: number;
  /** Tree center, world Z. */
  treeZ: number;
  /** Color hex string for the ring. */
  colorHex: string;
  /** Linear-RGB components (0..1) — for setColorAt. */
  rgb: [number, number, number];
}

export function placeSoil(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
): SoilPlacement[] {
  if (!commits || commits.length === 0) return [];
  const out: SoilPlacement[] = [];
  for (const p of placements) {
    const commit = commits[p.commitIndex];
    if (!commit) continue;
    const color = colorForAuthor(commit.author);
    out.push({
      treeX: p.x,
      treeZ: p.y,        // tree-module convention: y holds XZ-plane Z
      colorHex: color.hex,
      rgb: color.rgb,
    });
  }
  return out;
}
