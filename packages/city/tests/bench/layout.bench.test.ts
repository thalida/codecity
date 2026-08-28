// layout.bench.test.ts — times layoutCity over synthetic trees of several
// shapes and logs the milliseconds. No absolute assertions: they vary per
// machine, and a regression that 10x's the time shows up in the output. One
// timed run per shape, so vitest's bench() API buys nothing here.

import { describe, it } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import { NodeKind } from '@/city/types/manifest';
import { layoutCfg } from '../_helpers/citySettings';

const CFG = layoutCfg();

function mkFile(name: string, depth: number) {
  return {
    name,
    type: NodeKind.File,
    path: `${depth}/${name}`,
    extension: '.ts',
    size: 500 + name.length * 100,
    lines: 20,
    created: '2024-01-01T00:00:00Z',
    modified: '2024-01-01T00:00:00Z',
  };
}

function mkDir(name: string, children: any[], path = name): any {
  return {
    name,
    type: NodeKind.Directory,
    path,
    children_count: children.length,
    descendants_count:
      children.length + children.reduce((acc, c) => acc + (c.descendants_count || 0), 0),
    descendants_size: 1000,
    children,
  };
}

function flatTree(n: number) {
  const files = Array.from({ length: n }, (_, i) => mkFile(`f${String(i).padStart(4, '0')}.ts`, 0));
  return mkDir('root', files);
}

// A balanced tree of exactly fan^depth files: every non-leaf level branches
// into `fan` dirs, and the leaf level holds `fan` files.
function deepChildren(depth: number, fan: number, basePath: string): any[] {
  if (depth === 1) {
    return Array.from({ length: fan }, (_, i) => mkFile(`f${i}.ts`, 0));
  }
  return Array.from({ length: fan }, (_, i) => {
    const childPath = `${basePath}/d${i}`;
    return mkDir(`d${i}`, deepChildren(depth - 1, fan, childPath), childPath);
  });
}

function deepTree(depth: number, fan: number): any {
  return mkDir('root', deepChildren(depth, fan, 'root'), 'root');
}

// Generous enough that a slow machine passes, tight enough that a 100x
// regression fails loudly. Smaller ones show up in the logged timings.
const PERF_TIMEOUT_MS = 60_000;

describe('layoutCity perf smoke', () => {
  function runOne(label: string, tree: any) {
    const t0 = performance.now();
    const layout = layoutCity({ tree }, CFG);
    const t1 = performance.now();
    const ms = (t1 - t0).toFixed(1);
    const nBuildings = layout.buildings.length;

    // A compactness baseline, logged rather than asserted: it moves with the
    // synthetic tree's shape.
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    for (const b of layout.buildings) {
      if (b.x - b.w / 2 < xMin) xMin = b.x - b.w / 2;
      if (b.x + b.w / 2 > xMax) xMax = b.x + b.w / 2;
      if (b.y - b.d / 2 < yMin) yMin = b.y - b.d / 2;
      if (b.y + b.d / 2 > yMax) yMax = b.y + b.d / 2;
    }
    for (const s of layout.streets) {
      const sw = s.orientation === 'x' ? s.length : s.width;
      const sd = s.orientation === 'x' ? s.width : s.length;
      if (s.x - sw / 2 < xMin) xMin = s.x - sw / 2;
      if (s.x + sw / 2 > xMax) xMax = s.x + sw / 2;
      if (s.y - sd / 2 < yMin) yMin = s.y - sd / 2;
      if (s.y + sd / 2 > yMax) yMax = s.y + sd / 2;
    }
    const W = xMax - xMin;
    const H = yMax - yMin;
    const maxDim = Math.max(W, H).toFixed(0);
    const aspect = (Math.max(W, H) / Math.max(1, Math.min(W, H))).toFixed(2);
    console.log(
      `  ${label}: ${ms} ms (${nBuildings} buildings, bbox max=${maxDim} aspect=${aspect})`
    );
  }

  it(
    'flat 1000 files',
    () => {
      runOne('flat-1k', flatTree(1000));
    },
    PERF_TIMEOUT_MS
  );
  it(
    'flat 5000 files',
    () => {
      runOne('flat-5k', flatTree(5000));
    },
    PERF_TIMEOUT_MS
  );
  it(
    'depth 4 fan 5 (625 files)',
    () => {
      runOne('d4f5', deepTree(4, 5));
    },
    PERF_TIMEOUT_MS
  );
  it(
    'depth 5 fan 5 (3125 files)',
    () => {
      runOne('d5f5', deepTree(5, 5));
    },
    PERF_TIMEOUT_MS
  );
  it(
    'depth 4 fan 10 (10000 files)',
    () => {
      runOne('d4f10', deepTree(4, 10));
    },
    PERF_TIMEOUT_MS
  );
});
