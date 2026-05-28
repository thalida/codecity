// scene/fireflies/firefliesPlacement.ts — given a TreePlacement[]
// and the manifest commit list, emit 3 firefly orbs per tree.
// Positions are deterministic (seeded by commit SHA + orb index) so
// world rebuilds don't re-randomize the orb field.
//
// TreePlacement has { x, y, seed, commitIndex } — no height or radius.
// We derive canopy height and radius from commits using the same
// encoding functions as treeRenderer, and read config defaults from TREES.

import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import { TREES } from '@/config/components/trees.js';
import {
  computeAgeRange,
  computeSizeRange,
  ageT,
  sizeT,
} from '@/scene/components/trees/treeEncoding.js';
import { colorForAuthor } from './authorColor.js';

export const ORBS_PER_TREE = 3;

export interface FireflyPlacement {
  /** World X (matches tree.x). */
  x: number;
  /** World Y (vertical height above ground). */
  height: number;
  /** World Z (matches tree.y — the trees module uses y for the XZ-plane Z). */
  z: number;
  /** Per-instance phase offset for the bob animation, in [0, 2π). */
  phase: number;
  /** Color hex string for the orb. Same across all orbs of a given author. */
  colorHex: string;
  /** Linear-RGB components (0..1) — for InstancedMesh setColorAt. */
  rgb: [number, number, number];
}

/** Tiny deterministic PRNG seeded by a string. Mulberry32 on top of FNV-1a. */
function seededRng(seed: string): () => number {
  // FNV-1a → 32-bit seed
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeFireflies(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
): FireflyPlacement[] {
  if (!commits || commits.length === 0) return [];

  const cfg = TREES.get();
  const minHeight = cfg.TREE_MIN_HEIGHT;
  const maxHeight = cfg.TREE_MAX_HEIGHT;
  const minRadius = cfg.TREE_MIN_WIDTH / 2;
  const maxRadius = cfg.TREE_MAX_WIDTH / 2;
  const trunkRadiusFrac = cfg.TRUNK_RADIUS_FRAC_OF_CANOPY;

  const ageRange = computeAgeRange(commits);
  const sizeRange = computeSizeRange(commits);

  // NOTE: treeHeight and treeRadius below mirror perTreeHeight / perTreeRadius in
  // scene/components/trees/treeRenderer.ts. Keep in sync — if the renderer's size
  // formulas change, this module must change too, otherwise fireflies drift away
  // from their trees.

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
    const floor = Math.max(0, Math.min(1, cfg.TREE_WIDTH_AGE_FLOOR));
    const ageAttenuation = floor + (1 - floor) * heightRatio;
    return baseRadius * ageAttenuation;
  }

  const out: FireflyPlacement[] = [];

  for (const p of placements) {
    const commit = commits[p.commitIndex];
    if (!commit) continue;

    const canopyRadius = treeRadius(p.commitIndex);
    const height = treeHeight(p.commitIndex);
    const trunkRadius = trunkRadiusFrac * canopyRadius;
    const color = colorForAuthor(commit.author);

    for (let i = 0; i < ORBS_PER_TREE; i++) {
      const rng = seededRng(`${commit.sha}:${i}`);
      const angle = rng() * Math.PI * 2;
      const radius = trunkRadius + rng() * canopyRadius * 1.2;
      const orbHeight = rng() * (height * 1.3);
      const phase = rng() * Math.PI * 2;
      out.push({
        x: p.x + Math.cos(angle) * radius,
        z: p.y + Math.sin(angle) * radius,
        height: orbHeight,
        phase,
        colorHex: color.hex,
        rgb: color.rgb,
      });
    }
  }

  return out;
}
