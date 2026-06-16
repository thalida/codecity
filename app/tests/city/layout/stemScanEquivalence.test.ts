// stemScanEquivalence.test.ts — findSmallestValidStem has two scan paths: the
// allocation-free iterative-max used in production (layoutCity) and the sorted
// scan kept for the diagnostic trace (layoutCityWithTrace). They must compute
// identical stems for every tree, so the full layouts must be byte-for-byte
// equal. This pins that invariant — especially for a big flat directory, the
// worst case for the iterative-max's chain length.

import { describe, it, expect } from 'vitest';
import { layoutCity, layoutCityWithTrace } from '@/city/layout/algorithm';
import { NodeKind } from '@/types';
import type { CityLayout } from '@/types';

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
function flat(n: number, rng: () => number): any {
  const files = Array.from({ length: n }, (_, i) =>
    mkFile(`f${String(i).padStart(5, '0')}.c`, 'root', rng)
  );
  return mkDir('root', files, 'root');
}
function skewed(name: string, path: string, budget: number, depth: number, rng: () => number): any {
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
    children.push(skewed(`d${i}`, `${path}/d${i}`, share, depth + 1, rng));
  }
  return mkDir(name, children, path);
}

function serialize(layout: CityLayout): string {
  const b = layout.buildings
    .map((x) => `${x.x.toFixed(4)},${x.y.toFixed(4)},${x.w},${x.d},${x.h},${x.floors},${x.orient}`)
    .join('|');
  const s = layout.streets
    .map((x) => `${x.x.toFixed(4)},${x.y.toFixed(4)},${x.length},${x.width},${x.orientation}`)
    .join('|');
  return `B[${b}]S[${s}]`;
}

describe('findSmallestValidStem: iterative-max scan matches the sorted scan', () => {
  const cases: Array<[string, () => any]> = [
    ['flat 3000 (long-chain worst case)', () => flat(3000, makeRng(1))],
    ['flat 200', () => flat(200, makeRng(7))],
    ['skewed 4000', () => skewed('root', 'root', 4000, 0, makeRng(0xc0ffee))],
    ['skewed 800', () => skewed('root', 'root', 800, 0, makeRng(42))],
  ];
  for (const [label, build] of cases) {
    it(label, () => {
      const tree = build();
      const hot = layoutCity({ tree });
      const traced = layoutCityWithTrace({ tree }).layout;
      expect(serialize(hot)).toEqual(serialize(traced));
    });
  }
});
