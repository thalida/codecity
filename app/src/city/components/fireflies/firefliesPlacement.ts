// city/components/fireflies/firefliesPlacement.ts — given a TreePlacement[]
// and the manifest commit list, emit one firefly orb per distinct
// author of each commit (primary + Co-authored-by trailers).
// Position is deterministic (seeded by commit SHA + author name) so
// world rebuilds don't re-randomize the orb field.
//
// TreePlacement has { x, y, seed, commitIndex } — no height or radius.
// We derive canopy height and radius from commits using the same
// encoding functions as treeRenderer, and read config defaults from TREES.

import type { CommitEntry, RepoStats } from '@/types';
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
   *  (shared, read-only) array across all orbs of a given author. */
  rgb: readonly [number, number, number];
  /** Pastel variant of `rgb` — same hue, higher lightness. Used by the
   *  hover orbit-ring highlight so a hovered multi-author tree shows
   *  one tinted ring per author. */
  lightRgb: readonly [number, number, number];
  /** Per-instance scale derived from author commit count, mapped to [SCALE_MIN..SCALE_MAX]. */
  scale: number;
  /** The author this orb belongs to, so a scrub can re-rank it on the commits
   *  made by that date rather than the whole history's. */
  author: string;
  /** `height` and `orbitRadius` as fractions of the tree's canopy height and
   *  radius, so a scrub can re-derive both against a tree that has grown. */
  heightFrac: number;
  orbitRadiusFrac: number;
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

/** Hard cap on total firefly orbs — the analogue of the trees' TREE_MAX_CELLS.
 *  Orbs are lighter than trees, so this sits above the 100k tree cap; it only
 *  bites pathological co-authorship on already-capped forests. */
const MAX_FIREFLY_ORBS = 200_000;

/** Rank authors by commit count into [SCALE_MIN..SCALE_MAX].
 *
 *  Shared with the timeline, which re-ranks on the commits made so far, so an
 *  orb's size always says the same thing: how much of the work on screen is
 *  this author's. Every author tied (most commonly: a lone author) is no
 *  ranking at all, so everyone takes SCALE_MAX — the top of a distribution
 *  of one. */
export function scaleByAuthor(
  counts: Iterable<readonly [string, number]>,
  cfg: { SCALE_MIN: number; SCALE_MAX: number }
): Map<string, number> {
  const entries = [...counts];
  const out = new Map<string, number>();
  if (entries.length === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (const [, n] of entries) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const range = max - min;
  for (const [name, n] of entries) {
    const t = range === 0 ? 1 : (n - min) / range;
    out.set(name, cfg.SCALE_MIN + t * (cfg.SCALE_MAX - cfg.SCALE_MIN));
  }
  return out;
}

export function placeFireflies(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  stats: RepoStats | null | undefined,
  scannedAt?: string | null
): FireflyPlacement[] {
  if (!commits || commits.length === 0) return [];

  const fireflyConfig = FIREFLIES.value;

  // Per-author commit counts come from the backend-precomputed stats.authors
  // (a co-authored commit credits each distinct author once — same tally the
  // scanner does). The list is sorted by count desc, so [0] is the max and the
  // last entry the min.
  const authors = stats?.authors ?? [];
  const authorScale = scaleByAuthor(
    authors.map((a) => [a.name, a.commits] as const),
    fireflyConfig
  );
  // Hue is backend-resolved (AuthorStat.hue) so the orb and the commit pane's
  // dot can't drift apart.
  const hueByAuthor = new Map(authors.map((a) => [a.name, a.hue]));

  const cfg = TREES.value;

  // Age + size ranges also come from stats (commitDates + sparsest/grandest),
  // shared with the tree renderer so orbs stay pinned to their trees. scannedAt
  // must match what the tree renderer passes so the staleness height lift agrees.
  const ageRange = computeAgeRange(stats, scannedAt);
  const sizeRange = computeSizeRange(stats);

  const out: FireflyPlacement[] = [];

  placements: for (const p of placements) {
    const commit = commits[p.commitIndex];
    if (!commit) continue;

    // Canopy radius/height come from treeEncoding — the same source the
    // tree renderer uses — so orbs stay pinned to their trees.
    const canopyRadius = treeRadius(commit, ageRange, sizeRange, cfg);
    const height = treeHeight(commit, ageRange, cfg);

    for (const author of commit.authors ?? []) {
      // Trees are capped at TREE_MAX_CELLS (100k), but orbs = trees × authors,
      // so heavy co-authorship can still balloon past that — each orb is an
      // allocation here + an instance in the renderer. Cap it so a Linux-scale
      // repo can't lock the decoration pass building millions of orbs.
      if (out.length >= MAX_FIREFLY_ORBS) break placements;
      const rng = seededRng(`${commit.sha}:${author}`);
      const pulseRng = seededRng(`${commit.sha}:p:${author}`);
      const authorHue = hueByAuthor.get(author) ?? 0;
      const color = colorForAuthor(authorHue);
      const lightColor = lightColorForAuthor(authorHue);
      const orbitStartAngle = rng() * Math.PI * 2;
      // Just outside the canopy — between 1.05× and 1.4× the canopy radius.
      const orbitRadiusFrac = 1.05 + rng() * 0.35;
      const heightFrac = rng() * 1.3;
      const phase = rng() * Math.PI * 2;
      const orbitTilt = (rng() - 0.5) * (Math.PI / 3);
      const pulsePhase = pulseRng() * Math.PI * 2;
      out.push({
        treeX: p.x,
        treeZ: p.y,
        height: heightFrac * height,
        orbitRadius: orbitRadiusFrac * canopyRadius,
        author,
        heightFrac,
        orbitRadiusFrac,
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
