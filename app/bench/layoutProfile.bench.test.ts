// layoutProfile.bench.test.ts — phase-breakdown profiler for layoutCity on a
// Linux-kernel-sized tree (~93k files / ~5k dirs). Reproduces issue #63's
// ~70–80s cold-load cost so we can see WHERE the time goes before refactoring.
//
// The Linux kernel's cost is dominated by a few enormous top-level dirs
// (drivers/, arch/, fs/), so we generate a power-law-skewed tree rather than a
// balanced one — that skew is what makes placeChild's per-directory work blow
// up. Not committed as a perf gate; it's a diagnostic driver.

import { describe, it } from 'vitest';
import { layoutCity, setLayoutProfiling, getLayoutProfile } from '@/city/layout/algorithm.js';
import { NodeKind } from '@/types';

// Deterministic LCG so tree shape (and thus timings) are reproducible run-to-run.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function mkFile(name: string, path: string, rng: () => number): any {
  return {
    name,
    type: NodeKind.File,
    path: `${path}/${name}`,
    extension: '.c',
    size: 200 + Math.floor(rng() * 40000),
    lines: 5 + Math.floor(rng() * 1500),
    created: '2024-01-01T00:00:00Z',
    modified: '2024-01-01T00:00:00Z',
  };
}

function mkDir(name: string, children: any[], path: string): any {
  const descendants_count =
    children.length + children.reduce((acc, c) => acc + (c.descendants_count || 0), 0);
  return {
    name,
    type: NodeKind.Directory,
    path,
    children_count: children.length,
    descendants_count,
    descendants_size: 1000,
    children,
  };
}

// genDir(name, path, budget, depth, rng) — recursively splits a file budget
// across loose files + skewed subdirectories, mimicking a real source tree.
function genDir(name: string, path: string, budget: number, depth: number, rng: () => number): any {
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
  // Power-law weights → first child gets the lion's share (drivers/-like skew).
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
    const cname = `d${i}`;
    children.push(genDir(cname, `${path}/${cname}`, share, depth + 1, rng));
  }
  return mkDir(name, children, path);
}

function countFilesDirs(node: any): { files: number; dirs: number } {
  let files = 0;
  let dirs = 0;
  const walk = (n: any) => {
    if (n.type === NodeKind.File) files++;
    else {
      dirs++;
      for (const c of n.children || []) walk(c);
    }
  };
  walk(node);
  return { files, dirs };
}

describe('layoutCity profile (Linux-sized)', () => {
  function runOne(label: string, budget: number) {
    const rng = makeRng(0xc0ffee);
    const tree = genDir('root', 'root', budget, 0, rng);
    const { files, dirs } = countFilesDirs(tree);
    setLayoutProfiling(true);
    const t0 = performance.now();
    layoutCity({ tree });
    const t1 = performance.now();
    const buckets = getLayoutProfile();
    setLayoutProfiling(false);

    const by = (k: string) => buckets.find((b) => b.key === k) ?? { ms: 0, n: 0 };
    const phaseTotal =
      by('phase.computeFileStats').ms +
      by('phase.estimateDirReaches').ms +
      by('phase.layoutDir').ms +
      by('phase.markJoinSides').ms;
    const pct = (ms: number) => `${((ms / phaseTotal) * 100).toFixed(0)}%`.padStart(5);
    const row = (name: string, ms: number) =>
      `  ${name.padEnd(20)} ${ms.toFixed(0).padStart(7)}ms ${pct(ms)}`;
    const out = [
      `\n=== ${label}: ${files} files / ${dirs} dirs — wall ${(t1 - t0).toFixed(0)}ms (phase-sum ${phaseTotal.toFixed(0)}ms) ===`,
      row('computeFileStats', by('phase.computeFileStats').ms),
      row('estimateDirReaches', by('phase.estimateDirReaches').ms),
      row('layoutDir', by('phase.layoutDir').ms),
      row('markJoinSides', by('phase.markJoinSides').ms),
      `  -- within layoutDir --`,
      `${row('isMirrorInvariant', by('placeChild.isMirrorInvariant').ms)}  (${by('placeChild.calls').n} placeChild, ${by('placeChild.childRects').n} childRects)`,
      `${row('findSmallestStem', by('findSmallestValidStem').ms)}  (${by('findSmallestValidStem').n} calls, ${by('stem.queries').n} queries, ${by('stem.candidates').n} candidates)`,
      row('childRectsBuild', by('commit.childRectsBuild').ms),
      row('translate+insert', by('commit.translateInsert').ms),
    ].join('\n');
    console.log(out);
  }

  it('10k files', () => runOne('10k', 10_000), 600_000);
  it('30k files', () => runOne('30k', 30_000), 600_000);
  it('93k files (Linux-sized)', () => runOne('93k', 93_000), 600_000);
});
