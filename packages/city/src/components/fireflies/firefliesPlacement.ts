// city/components/fireflies/firefliesPlacement.ts — one orb per distinct author
// of each commit, seeded by sha and name so a rebuild doesn't re-randomise the
// field. A placement carries no size, so the canopy it orbits is derived through
// treeEncoding, the same functions the renderer builds the tree from.

import type { TreePlacement } from '@/city/components/trees/treePlacement';
import { TREES } from '@/state/settings/fields/trees';
import { FIREFLIES } from '@/state/settings/fields/fireflies';
import {
  computeAgeRange,
  computeSizeRange,
  treeHeight,
  treeRadius,
} from '@/city/components/trees/treeEncoding';
import { colorForAuthor, lightColorForAuthor } from './authorColor';
import type { CommitEntry, RepoStats } from '@/city/types/manifest';

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
  /** The same hue, lighter: the hover ring, so a co-authored tree shows one
   *  tinted ring per author. */
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

/** Above the tree cap, since orbs are lighter: it only bites pathological
 *  co-authorship on a forest that is already capped. */
const MAX_FIREFLY_ORBS = 200_000;

/** An orb's size, against the busiest author's total. Absolute, not a rank: a
 *  rank over two authors never changes, so nothing would grow as time ran. */
export function scaleForCommits(
  commits: number,
  maxCommits: number,
  cfg: { SCALE_MIN: number; SCALE_MAX: number }
): number {
  const t = maxCommits > 0 ? Math.min(1, Math.max(0, commits / maxCommits)) : 1;
  return cfg.SCALE_MIN + t * (cfg.SCALE_MAX - cfg.SCALE_MIN);
}

export function placeFireflies(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  stats: RepoStats | null | undefined,
  scannedAt?: string | null
): FireflyPlacement[] {
  if (!commits || commits.length === 0) return [];

  const fireflyConfig = FIREFLIES.value;

  // Backend-precomputed, crediting each distinct author of a commit once. The
  // list is sorted by count, so [0] is the busiest.
  const authors = stats?.authors ?? [];
  const maxCommits = authors.length ? authors[0].commits : 0;
  const authorScale = new Map(
    authors.map((a) => [a.name, scaleForCommits(a.commits, maxCommits, fireflyConfig)] as const)
  );
  // Hue is backend-resolved (AuthorStat.hue) so the orb and the commit pane's
  // dot can't drift apart.
  const hueByAuthor = new Map(authors.map((a) => [a.name, a.hue]));

  const cfg = TREES.value;

  // Shared with the tree renderer, scan date included, or the orbs sit at a
  // height the trees they belong to never reach.
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
      // Orbs are trees times authors, so a capped forest can still balloon past
      // the tree cap and lock the decoration pass.
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
