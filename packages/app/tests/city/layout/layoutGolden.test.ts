// Digests are tied to the production settings defaults, so an intentional
// default change is a real output change and requires recapturing EXPECTED.

import { describe, it, expect } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import {
  makeRng,
  genWeightedTree,
  makeDigestHasher,
  statsFromTree,
} from '../../_helpers/layoutTreeFixtures';
import type { CityLayout } from '@codecity/city';

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

// Format: `${nBuildings}/${nStreets}/${hash}`. Recaptured for #98 (absolute
// height/width ceiling): counts unchanged, dimensions shifted.
const EXPECTED: Record<string, string> = {
  't-2k': '2000/644/4ba55bb7',
  't-10k': '10000/3190/9d9b7024',
  't-30k': '30000/8129/5a64ee5b',
};

describe('layoutCity golden (bit-identical guard)', () => {
  // Explicit timeout: 30k buildings is compute-bound and CI adds coverage
  // instrumentation, which took this past the unit project's 15s default.
  it('output digests match the captured baseline', () => {
    const digests: Record<string, string> = {};
    for (const [label, budget] of CASES) {
      const rng = makeRng(0xc0ffee);
      const tree = genWeightedTree('root', 'root', budget, 0, rng);
      // Without the file-stat ranges (server-provided in production) dimensions
      // fall back to SAFE_RANGE and the guard covers only a uniform layout.
      digests[label] = digest(layoutCity({ tree, stats: statsFromTree(tree) }));
    }
    expect(digests).toEqual(EXPECTED);
  }, 60_000);
});
