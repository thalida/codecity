// layoutGolden.bench.test.ts — bit-identical output guard for the #63 perf
// refactor. Computes a stable digest of layoutCity's full output for a set of
// deterministic trees and compares it against the captured baseline below. Any
// coordinate/dimension drift fails the test, so the perf refactor can prove it
// kept output identical. The digests are tied to the production settings
// defaults; an intentional default change is a real output change and would
// (correctly) require recapturing EXPECTED.

import { describe, it, expect } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import type { CityLayout } from '@/types';
import { makeRng, genWeightedTree, makeDigestHasher } from '../tests/_helpers/layoutTreeFixtures';

// Digest: round every coordinate to 4 decimals (below the layout's OVERLAP_EPS)
// and roll buildings + streets into a 32-bit hash.
function digest(layout: CityLayout): string {
  const h = makeDigestHasher();
  for (const b of layout.buildings) {
    h.num(b.x);
    h.num(b.y);
    h.num(b.w);
    h.num(b.d);
    h.num(b.h);
    h.num(b.floors);
    h.str(String(b.orient));
  }
  for (const s of layout.streets) {
    h.num(s.x);
    h.num(s.y);
    h.num(s.length);
    h.num(s.width);
    h.str(String(s.orientation));
  }
  return `${layout.buildings.length}/${layout.streets.length}/${h.hex()}`;
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
      const tree = genWeightedTree('root', 'root', budget, 0, rng);
      digests[label] = digest(layoutCity({ tree }));
    }
    expect(digests).toEqual(EXPECTED);
  });
});
