// city/components/fireflies/firefliesPlacement.ts — given a TreePlacement[]
// and the manifest commit list, emit one firefly orb per distinct
// author of each commit (primary + Co-authored-by trailers).
// Position is deterministic (seeded by commit SHA + author name) so
// world rebuilds don't re-randomize the orb field.
//
// TreePlacement has { x, y, seed, commitIndex } — no height or radius.
// We derive canopy height and radius from commits using the same
// encoding functions as treeRenderer, and read config defaults from TREES.

import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import { TREES } from '@/state/stores/settings/trees';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import {
  computeAgeRange,
  computeSizeRange,
  treeHeight,
  treeRadius,
} from '@/city/components/trees/treeEncoding';
import { colorForAuthor, lightColorForAuthor } from './authorColor';

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
  /** Linear-RGB components (0..1) — for InstancedMesh setColorAt. Same
   *  across all orbs of a given author. */
  rgb: [number, number, number];
  /** Pastel variant of `rgb` — same hue, higher lightness. Used by the
   *  hover orbit-ring highlight so a hovered multi-author tree shows
   *  one tinted ring per author. */
  lightRgb: [number, number, number];
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

  const fireflyConfig = FIREFLIES.value;

  // Tally per-author commit count. A co-authored commit increments
  // each distinct author's count by 1 — co-authorship counts as full
  // credit toward firefly scale.
  const counts = new Map<string, number>();
  for (const c of commits) {
    for (const author of c.authors ?? []) {
      counts.set(author, (counts.get(author) ?? 0) + 1);
    }
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

  const cfg = TREES.value;

  const ageRange = computeAgeRange(commits);
  const sizeRange = computeSizeRange(commits);

  const out: FireflyPlacement[] = [];

  for (const p of placements) {
    const commit = commits[p.commitIndex];
    if (!commit) continue;

    // Canopy radius/height come from treeEncoding — the same source the
    // tree renderer uses — so orbs stay pinned to their trees.
    const canopyRadius = treeRadius(commit, ageRange, sizeRange, cfg);
    const height = treeHeight(commit, ageRange, cfg);

    for (const author of commit.authors ?? []) {
      const rng = seededRng(`${commit.sha}:${author}`);
      const pulseRng = seededRng(`${commit.sha}:p:${author}`);
      const color = colorForAuthor(author);
      const lightColor = lightColorForAuthor(author);
      const orbitStartAngle = rng() * Math.PI * 2;
      // Just outside the canopy — between 1.05× and 1.4× the canopy radius.
      const orbitRadius = canopyRadius * (1.05 + rng() * 0.35);
      const orbHeight = rng() * (height * 1.3);
      const phase = rng() * Math.PI * 2;
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
        rgb: color.rgb,
        lightRgb: lightColor.rgb,
        scale: authorScale.get(author) ?? 1.0,
        commitIndex: p.commitIndex,
      });
    }
  }

  return out;
}
