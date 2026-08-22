// treeDecorationProfile.bench.test.ts — times the "Adding decorations" pass:
// tree placement (placeTrees) + renderer build (createTreeRenderer), one tree
// per commit. Diagnostic driver for finding the decoration-pass bottleneck.

import { describe, it } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import { placeTrees } from '@/city/components/trees/treePlacement';
import { TREES } from '@/state/settings/fields/trees';
import { noIslandConfig } from '../_helpers/cityFixtures';
import { createTreeRenderer } from '@/city/components/trees/treeRenderer';
import { createFireflyAssembly } from '@/city/components/fireflies/fireflies';
import { placeFireflies } from '@/city/components/fireflies/firefliesPlacement';
import { createOrbitRings } from '@/city/components/fireflies/orbitRings';
import { createFireflyRenderer } from '@/city/components/fireflies/firefliesRenderer';
import { FIREFLIES } from '@/state/settings/fields/fireflies';
import { makeRng, genNestedTree, bboxOf, genCommits } from '../_helpers/layoutTreeFixtures';
import { commitStats, fileStats } from '../_helpers/statsFixtures';

describe('tree decoration profile', () => {
  function runOne(label: string, commitCount: number) {
    const rng = makeRng(0xc0ffee);
    const tree = genNestedTree('root', 'root', 30000, 0, rng);
    const commits = genCommits(commitCount, makeRng(7));
    const busyness = { avg: 3, busy: 6 };
    // Derived outside the timed regions so they exclude the stats pass;
    // layoutCity needs the ranges or every building collapses to min-width.
    const stats = { ...commitStats(commits), ...fileStats(tree) };
    const layout = layoutCity({ tree, stats });
    const bbox = bboxOf(layout);

    const t0 = performance.now();
    const placements = placeTrees(layout as any, bbox, { commitCount, config: noIslandConfig() });
    const t1 = performance.now();
    createTreeRenderer(placements, commits, busyness, stats, null, TREES);
    const t2 = performance.now();
    const firefliesEnabled = FIREFLIES.value.ENABLED;
    const tf0 = performance.now();
    createFireflyAssembly(placements, commits, stats, null, FIREFLIES, TREES);
    const tf1 = performance.now();
    // Split fireflies into its three parts.
    const ts0 = performance.now();
    const orbs = placeFireflies(placements, commits, stats, null, FIREFLIES.value, TREES.value);
    const ts1 = performance.now();
    createOrbitRings(orbs, FIREFLIES);
    const ts2 = performance.now();
    createFireflyRenderer(orbs, FIREFLIES);
    const ts3 = performance.now();

    // Simulate the worker postMessage cost: structured-clone the full layout
    // (buildings carry `file`, streets carry `dir`) vs a geometry-only slim copy.
    const tc0 = performance.now();
    structuredClone(layout);
    const tc1 = performance.now();
    const slim = {
      streets: layout.streets.map((s: any) => ({
        x: s.x,
        y: s.y,
        length: s.length,
        width: s.width,
        orientation: s.orientation,
        isRoot: s.isRoot,
      })),
      buildings: layout.buildings.map((b: any) => ({ x: b.x, y: b.y, w: b.w, d: b.d })),
    };
    const tc2 = performance.now();
    structuredClone(slim);
    const tc3 = performance.now();

    console.log(
      `\n=== ${label}: ${commitCount} commits → ${placements.length} trees (${layout.buildings.length} bld / ${layout.streets.length} streets) ===\n` +
        `  placeTrees:           ${(t1 - t0).toFixed(0)}ms\n` +
        `  createTreeRenderer:   ${(t2 - t1).toFixed(0)}ms\n` +
        `  createFireflyAssembly:      ${(tf1 - tf0).toFixed(0)}ms (enabled=${firefliesEnabled}) → ${orbs.length} orbs\n` +
        `      placeFireflies:     ${(ts1 - ts0).toFixed(0)}ms\n` +
        `      createOrbitRings:   ${(ts2 - ts1).toFixed(0)}ms\n` +
        `      createFireflyRenderer:${(ts3 - ts2).toFixed(0)}ms\n` +
        `  structuredClone FULL: ${(tc1 - tc0).toFixed(0)}ms  <-- worker postMessage cost today\n` +
        `  build slim copy:      ${(tc2 - tc1).toFixed(0)}ms\n` +
        `  structuredClone slim: ${(tc3 - tc2).toFixed(0)}ms`
    );
  }

  it('50k commits', () => runOne('50k', 50_000), 600_000);
  it('200k commits', () => runOne('200k', 200_000), 600_000);
  it('1M commits (Linux-ish)', () => runOne('1M', 1_000_000), 600_000);
});
