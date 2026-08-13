// Bit-identical guard for the decoration pass: digests placeTrees, placeFireflies,
// and the tree renderer's instance buffers against the captured baseline.

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
} from '../_helpers/layoutTreeFixtures';
import { commitStats, fileStats } from '../_helpers/statsFixtures';

// Settings-default-sensitive: TREES defaults legitimately move the hash, so
// it gets recaptured (last: clearance from the city as a share of the island).
const EXPECTED = '12k:trees43000:orbs51600:7797e578';

describe('decoration golden (bit-identical guard)', () => {
  // Explicit timeout: compute-bound like the layout golden, and CI's coverage
  // instrumentation multiplies it well past what a jsdom default assumes.
  it('placeTrees + placeFireflies + renderer buffers match baseline', () => {
    const rng = makeRng(0xc0ffee);
    const tree = genNestedTree('root', 'root', 12000, 0, rng);
    const commits = genCommits(43000, makeRng(7));
    const busyness = { avg: 3, busy: 6 };
    // Backend-precomputed in production. layoutCity MUST get the file ranges or
    // every building collapses to min-width and tree placement drifts.
    const stats = { ...commitStats(commits), ...fileStats(tree) };
    const layout = layoutCity({ tree, stats });
    const bbox = bboxOf(layout);

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
  }, 60_000);
});
