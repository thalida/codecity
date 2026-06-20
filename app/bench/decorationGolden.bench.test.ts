// decorationGolden.bench.test.ts — bit-identical guard for the decoration-pass
// perf work. Digests the full output of placeTrees, placeFireflies, and the
// tree renderer's instance matrix/color buffers for deterministic inputs, and
// compares against the captured baseline. Any drift fails, so the
// memoization/compute-once/slim-payload changes can prove output is unchanged.

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import { placeTrees } from '@/city/components/trees/treePlacement';
import { createTreeRenderer } from '@/city/components/trees/treeRenderer';
import { placeFireflies } from '@/city/components/fireflies/firefliesPlacement';
import {
  makeRng,
  genNestedTree,
  bboxOf,
  genCommits,
  makeDigestHasher,
} from '../tests/_helpers/layoutTreeFixtures';
import { commitStats } from '../tests/_helpers/statsFixtures';

// Captured before the decoration-pass perf work.
const EXPECTED = '12k:trees43000:orbs51600:74166740';

describe('decoration golden (bit-identical guard)', () => {
  it('placeTrees + placeFireflies + renderer buffers match baseline', () => {
    const rng = makeRng(0xc0ffee);
    const tree = genNestedTree('root', 'root', 12000, 0, rng);
    const layout = layoutCity({ tree });
    const bbox = bboxOf(layout);
    const commits = genCommits(43000, makeRng(7));
    const busyness = { avg: 3, busy: 6 };
    // Stats are backend-precomputed; the trees + fireflies read the age/size
    // ranges + author counts from here instead of re-scanning commits.
    const stats = commitStats(commits);

    const placements = placeTrees(layout as any, bbox, {
      commitCount: 43000,
      islandGeoOverride: null,
    });
    const orbs = placeFireflies(placements, commits, stats);
    const renderer = createTreeRenderer(placements, commits, busyness, stats);

    const hasher = makeDigestHasher();
    for (const p of placements) {
      hasher.num(p.x);
      hasher.num(p.y);
      hasher.num(p.seed);
      hasher.num(p.commitIndex);
    }
    for (const o of orbs) {
      hasher.num(o.treeX);
      hasher.num(o.treeZ);
      hasher.num(o.height);
      hasher.num(o.orbitRadius);
      hasher.num(o.orbitStartAngle);
      hasher.num(o.orbitTilt);
      hasher.num(o.phase);
      hasher.num(o.pulsePhase);
      hasher.num(o.scale);
      hasher.num(o.commitIndex);
      hasher.arr(o.rgb);
      hasher.arr(o.lightRgb);
    }
    for (const child of renderer.group.children) {
      const mesh = child as THREE.InstancedMesh;
      if (mesh.instanceMatrix) hasher.arr(mesh.instanceMatrix.array);
      if (mesh.instanceColor) hasher.arr(mesh.instanceColor.array);
    }
    renderer.dispose();

    const digest = `12k:trees${placements.length}:orbs${orbs.length}:${hasher.hex()}`;
    expect(digest).toEqual(EXPECTED);
  });
});
