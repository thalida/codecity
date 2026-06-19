// layoutProfile.bench.test.ts — phase-breakdown profiler for layoutCity on a
// Linux-kernel-sized tree (~93k files / ~5k dirs). Reproduces issue #63's
// ~70–80s cold-load cost so we can see WHERE the time goes before refactoring.
//
// The Linux kernel's cost is dominated by a few enormous top-level dirs
// (drivers/, arch/, fs/), so we generate a power-law-skewed tree rather than a
// balanced one — that skew is what makes placeChild's per-directory work blow
// up. Not committed as a perf gate; it's a diagnostic driver.

import { describe, it } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import { setLayoutProfiling, getLayoutProfile } from '@/city/layout/profiling';
import { NodeKind } from '@/types';
import { makeRng, genWeightedTree } from '../tests/_helpers/layoutTreeFixtures';

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
    const tree = genWeightedTree('root', 'root', budget, 0, rng);
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
