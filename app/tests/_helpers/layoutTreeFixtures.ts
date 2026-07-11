// Shared deterministic generators for the layout/decoration bench + golden
// suites. These build manifest-shaped trees and commit lists with an
// `(name, path, rng)` signature (distinct from cityFixtures.ts's simpler
// `(name)` fixtures), and a rolling-hash digester. The golden digests depend on
// these byte-for-byte, so change them only intentionally (and recapture the
// EXPECTED constants).

import { NodeKind } from '@/types';
import type { CityBbox, CityLayout, CommitEntry, RepoStats } from '@/types';

/** Deterministic LCG so tree shape (and thus digests/timings) reproduce. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function mkFile(name: string, path: string, rng: () => number): any {
  return {
    name,
    type: NodeKind.File,
    path: `${path}/${name}`,
    extension: '.c',
    size: 200 + Math.floor(rng() * 40000),
    lines: 5 + Math.floor(rng() * 1500),
  };
}

export function mkDir(name: string, children: any[], path: string): any {
  const descendants_count =
    children.length + children.reduce((a, c) => a + (c.descendants_count || 0), 0);
  return {
    name,
    type: NodeKind.Directory,
    path,
    children_count: children.length,
    descendants_count,
    children,
  };
}

/** Root directory holding `n` files and no subdirectories. */
export function flatTree(n: number, rng: () => number): any {
  const files = Array.from({ length: n }, (_, i) =>
    mkFile(`f${String(i).padStart(5, '0')}.c`, 'root', rng)
  );
  return mkDir('root', files, 'root');
}

// genWeightedTree — a few loose files plus power-law-weighted subdirectories
// (first child gets the lion's share). Reproduces a real source tree's skew.
export function genWeightedTree(
  name: string,
  path: string,
  budget: number,
  depth: number,
  rng: () => number
): any {
  if (budget <= 8 || depth >= 7) {
    const files = [];
    for (let i = 0; i < budget; i++) files.push(mkFile(`f${i}.c`, path, rng));
    return mkDir(name, files, path);
  }
  const children: any[] = [];
  const loose = 1 + Math.floor(rng() * 6);
  for (let i = 0; i < loose; i++) children.push(mkFile(`a${i}.c`, path, rng));
  let remaining = budget - loose;
  const nSub = 2 + Math.floor(rng() * 6);
  const weights: number[] = [];
  let wsum = 0;
  for (let i = 0; i < nSub; i++) {
    const w = 1 / (i + 1);
    weights.push(w);
    wsum += w;
  }
  for (let i = 0; i < nSub && remaining > 0; i++) {
    const last = i === nSub - 1;
    let share = last ? remaining : Math.max(1, Math.round((weights[i] / wsum) * (budget - loose)));
    share = Math.min(share, remaining);
    remaining -= share;
    children.push(genWeightedTree(`d${i}`, `${path}/d${i}`, share, depth + 1, rng));
  }
  return mkDir(name, children, path);
}

// genNestedTree — one loose file plus subdirectories sharing the remaining
// budget by a decaying fraction. Deeper, more uniform nesting than weighted.
export function genNestedTree(
  name: string,
  path: string,
  budget: number,
  depth: number,
  rng: () => number
): any {
  if (budget <= 8 || depth >= 6) {
    return mkDir(
      name,
      Array.from({ length: budget }, (_, i) => mkFile(`f${i}.c`, path, rng)),
      path
    );
  }
  const children: any[] = [mkFile('a.c', path, rng)];
  let remaining = budget - 1;
  const nSub = 2 + Math.floor(rng() * 5);
  for (let i = 0; i < nSub && remaining > 0; i++) {
    const share =
      i === nSub - 1 ? remaining : Math.max(1, Math.round(remaining / (nSub - i) / (i + 1)));
    remaining -= share;
    children.push(genNestedTree(`d${i}`, `${path}/d${i}`, share, depth + 1, rng));
  }
  return mkDir(name, children, path);
}

// Reconstruct the two building-size normalization ranges the layout reads from
// RepoStats: min/max of non-zero file lines/bytes across the tree. The server
// computes these for real repos; without them layoutCity falls back to
// SAFE_RANGE and every building gets the same (degenerate) size — so the bench
// must supply them to exercise real dimensions. Only lineCountRange /
// byteSizeRange are read by the layout; the rest of RepoStats is Info-tab data.
export function statsFromTree(root: any): RepoStats {
  let minL = Infinity;
  let maxL = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  const walk = (n: any): void => {
    if (n.type === NodeKind.File) {
      if (n.lines > 0) {
        minL = Math.min(minL, n.lines);
        maxL = Math.max(maxL, n.lines);
      }
      if (n.size > 0) {
        minB = Math.min(minB, n.size);
        maxB = Math.max(maxB, n.size);
      }
    } else if (n.children) {
      for (const c of n.children) walk(c);
    }
  };
  walk(root);
  return {
    lineCountRange: { min: minL === Infinity ? 0 : minL, max: maxL === -Infinity ? 0 : maxL },
    byteSizeRange: { min: minB === Infinity ? 0 : minB, max: maxB === -Infinity ? 0 : maxB },
  } as RepoStats;
}

/** Axis-aligned bbox of a laid-out city's buildings, with derived center/size. */
export function bboxOf(layout: CityLayout): CityBbox {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const b of layout.buildings) {
    minX = Math.min(minX, b.x - b.w / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    minY = Math.min(minY, b.y - b.d / 2);
    maxY = Math.max(maxY, b.y + b.d / 2);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    depth: maxY - minY,
  };
}

// Several authors per commit (with repetition so distinct authors << orbs) so
// the firefly author-color memoization is exercised.
const AUTHORS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];

export function genCommits(n: number, rng: () => number): CommitEntry[] {
  const out: CommitEntry[] = [];
  const base = Date.UTC(2016, 2, 1);
  for (let i = 0; i < n; i++) {
    const day = Math.floor((i / n) * 2000) + Math.floor(rng() * 4);
    const date = new Date(base + day * 86400000).toISOString().slice(0, 10);
    const a = AUTHORS[i % AUTHORS.length];
    const authors = i % 5 === 0 ? [a, AUTHORS[(i + 2) % AUTHORS.length]] : [a];
    out.push({
      date,
      files: 1 + Math.floor(rng() * 200),
      sha: `${i.toString(16).padStart(8, '0')}beef`.repeat(4).slice(0, 40),
      authors,
      subject: 'x',
      same_day_total: 1 + Math.floor(rng() * 12),
    });
  }
  return out;
}

// FNV-1a rolling digester: numbers rounded to 4 decimals (below the layout's
// OVERLAP_EPS), strings hashed raw, with a field separator between values.
export function makeDigestHasher() {
  let h = 2166136261 >>> 0;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 124; // field separator
    h = Math.imul(h, 16777619) >>> 0;
  };
  return {
    num: (v: number) => mix(Math.round(v * 1e4).toString()),
    str: (v: string) => mix(v),
    arr: (a: ArrayLike<number>) => {
      for (let i = 0; i < a.length; i++) mix(Math.round(a[i] * 1e4).toString());
    },
    hex: () => (h >>> 0).toString(16),
  };
}
