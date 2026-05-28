// scene/committerSoil/soilPlacement.ts — derive one ring per tree.
// Color comes from colorForAuthor(commit.author), shared with the
// fireflies subsystem. Ring radius is derived per-tree from the trunk
// radius (mirroring firefliesPlacement.ts) scaled by SOIL_RADIUS_MULTIPLIER.

import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import { TREES } from '@/config/components/trees.js';
import { COMMITTER_SOIL } from '@/config/components/committerSoil.js';
import {
  computeAgeRange,
  computeSizeRange,
  ageT,
  sizeT,
} from '@/scene/components/trees/treeEncoding.js';
import { colorForAuthor } from '@/scene/components/fireflies/authorColor.js';

export interface SoilPlacement {
  /** Tree center, world X (ring is centered here). */
  treeX: number;
  /** Tree center, world Z. */
  treeZ: number;
  /** Ring radius in world units (trunk radius × SOIL_RADIUS_MULTIPLIER). */
  radius: number;
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

  const cfg = COMMITTER_SOIL.get();
  const treeCfg = TREES.get();
  const minHeight = treeCfg.TREE_MIN_HEIGHT;
  const maxHeight = treeCfg.TREE_MAX_HEIGHT;
  const minRadius = treeCfg.TREE_MIN_WIDTH / 2;
  const maxRadius = treeCfg.TREE_MAX_WIDTH / 2;
  const trunkRadiusFrac = treeCfg.TRUNK_RADIUS_FRAC_OF_CANOPY;

  const ageRange = computeAgeRange(commits);
  const sizeRange = computeSizeRange(commits);

  // NOTE: trunk-radius derivation mirrors firefliesPlacement.ts and
  // treeRenderer.ts. If the renderer's perTreeRadius / trunk-radius
  // formula changes, this module must change too.

  /** Canopy height for tree at index i, mirroring treeRenderer's perTreeHeight. */
  function treeHeight(commitIndex: number): number {
    const commit = commits[commitIndex];
    if (!commit) return (minHeight + maxHeight) * 0.5;
    const t = ageT(commit, ageRange);
    // ageT=0 (oldest) → maxHeight; ageT=1 (newest) → minHeight
    return maxHeight - t * (maxHeight - minHeight);
  }

  /** Canopy XZ radius for tree at index i, mirroring treeRenderer's perTreeRadius.
   *  Includes age-attenuation (TREE_WIDTH_AGE_FLOOR) so short young trees
   *  aren't adult-wide. */
  function treeRadius(commitIndex: number): number {
    const commit = commits[commitIndex];
    let baseRadius: number;
    if (commit) {
      const t = sizeT(commit, sizeRange);
      baseRadius = minRadius + t * (maxRadius - minRadius);
    } else {
      baseRadius = (minRadius + maxRadius) * 0.5;
    }
    const heightRange = Math.max(0.001, maxHeight - minHeight);
    const h = treeHeight(commitIndex);
    const heightRatio = (h - minHeight) / heightRange;
    const floor = Math.max(0, Math.min(1, treeCfg.TREE_WIDTH_AGE_FLOOR));
    const ageAttenuation = floor + (1 - floor) * heightRatio;
    return baseRadius * ageAttenuation;
  }

  const out: SoilPlacement[] = [];
  for (const p of placements) {
    const commit = commits[p.commitIndex];
    if (!commit) continue;
    const canopyRadius = treeRadius(p.commitIndex);
    const trunkRadius = trunkRadiusFrac * canopyRadius;
    const ringRadius = trunkRadius * cfg.SOIL_RADIUS_MULTIPLIER;
    const color = colorForAuthor(commit.author);
    out.push({
      treeX: p.x,
      treeZ: p.y,        // tree-module convention: y holds XZ-plane Z
      radius: ringRadius,
      colorHex: color.hex,
      rgb: color.rgb,
    });
  }
  return out;
}
