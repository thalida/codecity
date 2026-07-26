// Digests are tied to the production settings defaults, so an intentional
// default change is a real output change and requires recapturing EXPECTED.

import { describe, it, expect } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import type { CityLayout } from '@/types';
import {
  makeRng,
  genWeightedTree,
  makeDigestHasher,
  statsFromTree,
} from '../../_helpers/layoutTreeFixtures';

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

// Format: `${nBuildings}/${nStreets}/${hash}`. Recaptured for #98's absolute
// height/width ceiling (small-file repos no longer stretch to full height) —
// the building/street counts are unchanged, only dimensions shifted.
const EXPECTED: Record<string, string> = {
  't-2k': '2000/644/1a3845ab',
  't-10k': '10000/3190/46986f99',
  't-30k': '30000/8129/857d1160',
};

describe('layoutCity golden (bit-identical guard)', () => {
  // Explicit timeout: 30k buildings is compute-bound and CI adds coverage
  // instrumentation, which took this past the unit project's 15s default.
  it('output digests match the captured baseline', () => {
    const digests: Record<string, string> = {};
    for (const [label, budget] of CASES) {
      const rng = makeRng(0xc0ffee);
      const tree = genWeightedTree('root', 'root', budget, 0, rng);
      // Supply the file-stat ranges the layout reads (the server provides these
      // for real repos); without them dimensions fall back to SAFE_RANGE and the
      // guard would only cover a degenerate uniform-size layout.
      digests[label] = digest(layoutCity({ tree, stats: statsFromTree(tree) }));
    }
    expect(digests).toEqual(EXPECTED);
  }, 60_000);
});
