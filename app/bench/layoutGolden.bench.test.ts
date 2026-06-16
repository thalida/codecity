// layoutGolden.bench.test.ts — bit-identical output guard for the #63 perf
// refactor. Computes a stable digest of layoutCity's full output for a set of
// deterministic trees and compares it against the captured baseline below. Any
// coordinate/dimension drift fails the test, so the perf refactor can prove it
// kept output identical. The digests are tied to the production settings
// defaults; an intentional default change is a real output change and would
// (correctly) require recapturing EXPECTED.

import { describe, it, expect } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
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
    children.length + children.reduce((acc, c) => acc + (c.descendants_count || 0), 0);
  return { name, type: NodeKind.Directory, path, children_count: children.length, descendants_count, children };
}
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
    children.push(genDir(`d${i}`, `${path}/d${i}`, share, depth + 1, rng));
  }
  return mkDir(name, children, path);
}

// Stable digest: round every coordinate to 4 decimals (kills sub-ULP FP noise
// that's already below the layout's OVERLAP_EPS) and roll into a 32-bit hash.
function digest(layout: CityLayout): string {
  let h = 2166136261 >>> 0;
  const push = (v: number | string) => {
    const s = typeof v === 'number' ? Math.round(v * 1e4).toString() : v;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 124; // field separator
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (const b of layout.buildings) {
    push(b.x); push(b.y); push(b.w); push(b.d); push(b.h); push(b.floors); push(String(b.orient));
  }
  for (const s of layout.streets) {
    push(s.x); push(s.y); push(s.length); push(s.width); push(String(s.orientation));
  }
  return `${layout.buildings.length}/${layout.streets.length}/${(h >>> 0).toString(16)}`;
}

const CASES: Array<[string, number]> = [
  ['t-2k', 2000],
  ['t-10k', 10000],
  ['t-30k', 30000],
];

// Captured against main before the #63 perf work. Format: `${nBuildings}/${nStreets}/${hash}`.
const EXPECTED: Record<string, string> = {
  't-2k': '2000/644/a47ac69',
  't-10k': '10000/3190/83797bd1',
  't-30k': '30000/8129/14c61670',
};

describe('layoutCity golden (bit-identical guard)', () => {
  it('output digests match the captured baseline', () => {
    const digests: Record<string, string> = {};
    for (const [label, budget] of CASES) {
      const rng = makeRng(0xc0ffee);
      const tree = genDir('root', 'root', budget, 0, rng);
      digests[label] = digest(layoutCity({ tree }));
    }
    expect(digests).toEqual(EXPECTED);
  });
});
