// treeDecorationProfile.bench.test.ts — times the "Adding decorations" pass:
// tree placement (placeTrees) + renderer build (createTreeRenderer), one tree
// per commit. Diagnostic driver for finding the decoration-pass bottleneck.

import { describe, it } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import { placeTrees } from '@/city/components/trees/treePlacement';
import { createTreeRenderer } from '@/city/components/trees/treeRenderer';
import { createFireflies } from '@/city/components/fireflies/fireflies';
import { placeFireflies } from '@/city/components/fireflies/firefliesPlacement';
import { createOrbitRings } from '@/city/components/fireflies/orbitRings';
import { createFireflyRenderer } from '@/city/components/fireflies/firefliesRenderer';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import { NodeKind } from '@/types';
import type { CityBbox, CommitEntry } from '@/types';

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
  };
}
function mkDir(name: string, children: any[], path: string): any {
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
function genDir(name: string, path: string, budget: number, depth: number, rng: () => number): any {
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
    children.push(genDir(`d${i}`, `${path}/d${i}`, share, depth + 1, rng));
  }
  return mkDir(name, children, path);
}

function bboxOf(layout: ReturnType<typeof layoutCity>): CityBbox {
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
  const width = maxX - minX,
    depth = maxY - minY;
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width, depth };
}

function genCommits(n: number, rng: () => number): CommitEntry[] {
  const out: CommitEntry[] = [];
  const base = Date.UTC(2015, 0, 1);
  for (let i = 0; i < n; i++) {
    const day = Math.floor((i / n) * 3000) + Math.floor(rng() * 5);
    const date = new Date(base + day * 86400000).toISOString().slice(0, 10);
    out.push({
      date,
      files: 1 + Math.floor(rng() * 200),
      sha: `${i.toString(16).padStart(8, '0')}abcdef`.repeat(3).slice(0, 40),
      authors: ['a'],
      subject: 'x',
      same_day_total: 1 + Math.floor(rng() * 12),
    });
  }
  return out;
}

describe('tree decoration profile', () => {
  function runOne(label: string, commitCount: number) {
    const rng = makeRng(0xc0ffee);
    const tree = genDir('root', 'root', 30000, 0, rng);
    const layout = layoutCity({ tree });
    const bbox = bboxOf(layout);
    const commits = genCommits(commitCount, makeRng(7));
    const busyness = { avg: 3, busy: 6 };

    const t0 = performance.now();
    const placements = placeTrees(layout as any, bbox, { commitCount, islandGeoOverride: null });
    const t1 = performance.now();
    createTreeRenderer(placements, commits, busyness);
    const t2 = performance.now();
    const firefliesEnabled = FIREFLIES.value.ENABLED;
    const tf0 = performance.now();
    createFireflies(placements, commits);
    const tf1 = performance.now();
    // Split fireflies into its three parts.
    const ts0 = performance.now();
    const orbs = placeFireflies(placements, commits);
    const ts1 = performance.now();
    createOrbitRings(orbs);
    const ts2 = performance.now();
    createFireflyRenderer(orbs);
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
        `  createFireflies:      ${(tf1 - tf0).toFixed(0)}ms (enabled=${firefliesEnabled}) → ${orbs.length} orbs\n` +
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
