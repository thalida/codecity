// Bit-identical guard for the decoration pass: digests placeTrees, placeFireflies,
// and the tree renderer's instance buffers against the captured baseline.

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { layoutCity } from '../src/layout/algorithm.js';
import { placeTrees } from '../src/components/trees/treePlacement';
import { createTreeRenderer } from '../src/components/trees/treeRenderer';
import { placeFireflies } from '../src/components/fireflies/firefliesPlacement';
import {
  makeRng,
  genNestedTree,
  bboxOf,
  genCommits,
  makeDigestHasher,
} from './_helpers/layoutTreeFixtures';
import { commitStats, fileStats } from './_helpers/statsFixtures';
import { layoutCfg, settingsStore, treeCfg } from './_helpers/citySettings';

const CFG = layoutCfg();
const SETTINGS = settingsStore();
// The polygon rejection pass off, its shape still setting the sampling
// extent - what islandGeoOverride: null used to mean.
const TREE_CFG = treeCfg({ ISLAND: { ENABLED: false } });

// Settings-default-sensitive: TREES defaults legitimately move the hash, so it
// gets recaptured (last: the world-unit ceiling on city clearance).
const EXPECTED = '12k:trees43000:orbs51600:9d413584';

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
    const layout = layoutCity({ tree, stats }, CFG);
    const bbox = bboxOf(layout);

    const placements = placeTrees(layout as any, bbox, {
      commitCount: 43000,
      settings: TREE_CFG,
    });
    const orbs = placeFireflies(SETTINGS, placements, commits, stats);
    const renderer = createTreeRenderer(SETTINGS, placements, commits, busyness, stats);

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
