// layout.bench.test.ts — perf smoke harness for layoutCity.
//
// Builds synthetic trees of various shapes, times layoutCity, logs ms.
// This is a smoke harness — no assertions on absolute timings (those vary
// per machine), but a future regression that 10×s the time will be
// visible in the test output.
//
// File is named .bench.test.ts (not just .bench.ts) so vitest's
// `tests/**/*.test.{js,ts}` include glob picks it up. Vitest's dedicated
// `bench()` API is overkill for what we need here — a single timed run
// per shape is enough to flag a regression.

import { describe, it } from 'vitest';
import { layoutCity } from '@/scene/layout.js';
import { NodeKind } from '@/types';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const files = Array.from({ length: n }, (_, i) =>
    mkFile(`f${String(i).padStart(4, '0')}.ts`, 0)
  );
  return mkDir('root', files);
}

// Builds a balanced tree producing exactly fan^depth files. The labels in
// the spec ("d4f5 (625 files)") follow this convention: depth==1 means a
// single level of fanning out files under root. Each non-leaf level
// branches into `fan` subdirectories; the leaf level (depth==1 in the
// recursion) holds `fan` files.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepChildren(depth: number, fan: number, basePath: string): any[] {
  if (depth === 1) {
    return Array.from({ length: fan }, (_, i) => mkFile(`f${i}.ts`, 0));
  }
  return Array.from({ length: fan }, (_, i) => {
    const childPath = `${basePath}/d${i}`;
    return mkDir(`d${i}`, deepChildren(depth - 1, fan, childPath), childPath);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepTree(depth: number, fan: number): any {
  return mkDir('root', deepChildren(depth, fan, 'root'), 'root');
}

// 60s ceiling per case — generous upper bound so a slow CI machine still
// passes, but a 100×s regression that pushes a case past the ceiling will
// fail loudly. Absolute timings are still useful (logged below) for spotting
// smaller regressions in the printed test output.
const PERF_TIMEOUT_MS = 60_000;

describe('layoutCity perf smoke', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function runOne(label: string, tree: any) {
    const t0 = performance.now();
    const layout = layoutCity({ tree });
    const t1 = performance.now();
    const ms = (t1 - t0).toFixed(1);
    const nBuildings = layout.buildings.length;
    // eslint-disable-next-line no-console
    console.log(`  ${label}: ${ms} ms (${nBuildings} buildings)`);
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
