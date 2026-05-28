// scene/fireflies/firefliesPlacement.ts — given a TreePlacement[]
// and the manifest commit list, emit exactly 1 firefly orb per tree.
// Position is deterministic (seeded by commit SHA + orb index) so
// world rebuilds don't re-randomize the orb field.
//
// TreePlacement has { x, y, seed, commitIndex } — no height or radius.
// We derive canopy height and radius from commits using the same
// encoding functions as treeRenderer, and read config defaults from TREES.

import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import { TREES } from '@/config/components/trees.js';
import { FIREFLIES } from '@/config/components/fireflies.js';
import {
  computeAgeRange,
  computeSizeRange,
  ageT,
  sizeT,
} from '@/scene/components/trees/treeEncoding.js';
import { colorForAuthor } from './authorColor.js';

// (no more const ORBS_PER_TREE export; controlled via FIREFLIES.get().ORBS_PER_TREE)

export interface FireflyPlacement {
  /** Orbit center, world X. */
  treeX: number;
  /** Vertical height above ground. */
  height: number;
  /** Orbit center, world Z. */
  treeZ: number;
  /** Horizontal radius of the orbit around the tree's vertical axis. */
  orbitRadius: number;
  /** Initial angle [0, 2π) of the orbit. */
  orbitStartAngle: number;
  /** Tilt of the orbital plane around the X axis, in radians. Range ±π/6. */
  orbitTilt: number;
  /** Per-instance phase offset for the bob animation, in [0, 2π). */
  phase: number;
  /** Phase offset for the brightness-pulse shader animation, in [0, 2π). */
  pulsePhase: number;
  /** Color hex string for the orb. Same across all orbs of a given author. */
  colorHex: string;
  /** Linear-RGB components (0..1) — for InstancedMesh setColorAt. */
  rgb: [number, number, number];
  /** Per-instance scale derived from author commit count, mapped to [SCALE_MIN..SCALE_MAX]. */
  scale: number;
  /** Index of the commit (in manifest.commits) this orb belongs to. */
  commitIndex: number;
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
  commits: CommitEntry[] | null
): FireflyPlacement[] {
  if (!commits || commits.length === 0) return [];

  const fireflyConfig = FIREFLIES.get();
  const ORBS_PER_TREE = 1;

  // Tally commits per author and compute per-author scale.
  const counts = new Map<string, number>();
  for (const c of commits) {
    counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  }
  let minCount = Infinity;
  let maxCount = -Infinity;
  for (const n of counts.values()) {
    if (n < minCount) minCount = n;
    if (n > maxCount) maxCount = n;
  }
  const authorScale = new Map<string, number>();
  // Degenerate case: every author has the same count (most commonly: only
  // one author, or all authors tied). There's no meaningful ranking, so
  // everyone gets SCALE_MAX — the lone/tied contributor is the "top" of
  // a distribution of one. Otherwise, lerp [minCount..maxCount] →
  // [SCALE_MIN..SCALE_MAX].
  if (maxCount === minCount) {
    for (const author of counts.keys()) {
      authorScale.set(author, fireflyConfig.SCALE_MAX);
    }
  } else {
    const range = maxCount - minCount;
    for (const [author, n] of counts) {
      const t = (n - minCount) / range;
      authorScale.set(
        author,
        fireflyConfig.SCALE_MIN + t * (fireflyConfig.SCALE_MAX - fireflyConfig.SCALE_MIN)
      );
    }
  }

  const cfg = TREES.get();
  const minHeight = cfg.TREE_MIN_HEIGHT;
  const maxHeight = cfg.TREE_MAX_HEIGHT;
  const minRadius = cfg.TREE_MIN_WIDTH / 2;
  const maxRadius = cfg.TREE_MAX_WIDTH / 2;

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
    const color = colorForAuthor(commit.author);

    for (let i = 0; i < ORBS_PER_TREE; i++) {
      const rng = seededRng(`${commit.sha}:${i}`);
      const pulseRng = seededRng(`${commit.sha}:p:${i}`); // independent stream
      const orbitStartAngle = rng() * Math.PI * 2;
      // Just outside the canopy — between 1.05× and 1.4× the canopy radius.
      const orbitRadius = canopyRadius * (1.05 + rng() * 0.35);
      const orbHeight = rng() * (height * 1.3);
      const phase = rng() * Math.PI * 2;
      // Tilt the orbital plane up to ±30° (= ±π/6) for visual variety.
      // Most trees end up nearly horizontal; some tilt noticeably.
      const orbitTilt = (rng() - 0.5) * (Math.PI / 3);
      const pulsePhase = pulseRng() * Math.PI * 2;
      out.push({
        treeX: p.x,
        treeZ: p.y,
        height: orbHeight,
        orbitRadius,
        orbitStartAngle,
        orbitTilt,
        phase,
        pulsePhase,
        colorHex: color.hex,
        rgb: color.rgb,
        scale: authorScale.get(commit.author) ?? 1.0,
        commitIndex: p.commitIndex,
      });
    }
  }

  return out;
}
