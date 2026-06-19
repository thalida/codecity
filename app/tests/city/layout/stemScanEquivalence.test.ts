// stemScanEquivalence.test.ts — findSmallestValidStem has two scan paths: the
// allocation-free iterative-max used in production (layoutCity) and the sorted
// scan kept for the diagnostic trace (layoutCityWithTrace). They must compute
// identical stems for every tree, so the full layouts must be byte-for-byte
// equal. This pins that invariant — especially for a big flat directory, the
// worst case for the iterative-max's chain length.

import { describe, it, expect } from 'vitest';
import { layoutCity, layoutCityWithTrace } from '@/city/layout/algorithm';
import type { CityLayout } from '@/types';
import { makeRng, flatTree, genNestedTree } from '../../_helpers/layoutTreeFixtures';

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
    ['flat 3000 (long-chain worst case)', () => flatTree(3000, makeRng(1))],
    ['flat 200', () => flatTree(200, makeRng(7))],
    ['skewed 4000', () => genNestedTree('root', 'root', 4000, 0, makeRng(0xc0ffee))],
    ['skewed 800', () => genNestedTree('root', 'root', 800, 0, makeRng(42))],
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
