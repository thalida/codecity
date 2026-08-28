// picker-commit.test.ts — the Commit branch of the picker, driven by the REAL
// tree renderer: its meshes, its meshKind stamp, its face→commit mapping. A
// stub here would just restate the contract and pass while the two drifted.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker } from '../../src/interaction/picker';
import { createCityState } from '../../src/state';
import { drivableCityState, treePlacement } from '../_helpers/cityFixtures';
import { commitSeries } from '../_helpers/commits';
import { renderTrees, treeFaceIndex, treeSlot } from '../_helpers/renderTrees';
import type { Trees } from '../../src/components/trees/treeRenderer';
import { VERTS_PER_TRIANGLE } from '../../src/utils/bufferLayout';
import { NodeKind } from '../../src/types/manifest';
import { CommitTarget, PickerWorld } from '../../src/types/picker';
import { createEmitter } from '../_helpers/cityEvents';
import { createTimelineState } from '../../src/timeline/state';

const TIMELINE = createTimelineState();

const FAKE_CAMERA = {} as unknown as THREE.Camera;
const BUSY = { avg: 1, busy: 1 };

/** Three commits, three trees, one real renderer. */
function makeTrees(count = 3): { trees: Trees; commits: ReturnType<typeof commitSeries> } {
  const commits = commitSeries(count);
  const placements = commits.map((_, i) => treePlacement(i, i * 40, 0));
  return { trees: renderTrees(placements, commits, BUSY), commits };
}

function makeWorld(initialTrees: Trees | null): PickerWorld & {
  cityState: ReturnType<typeof createCityState>;
  triggerRebuild(): void;
  setTrees(t: Trees | null): void;
} {
  // A city rebuild bumps cityRevision, which is what the picker re-resolves on.
  const cityState = drivableCityState();
  let currentTrees = initialTrees;
  const api: PickerWorld = {
    getStreetPickables: () => [],
    getRootGem: () => null,
    getBuildingByPath: () => null,
    getSidewalkByDir: () => null,
    getStreetByDir: () => null,
    getBuildingIndex: () => null,
    getCells: () => new Map(),
    getTrees: () => currentTrees,
  };
  return Object.assign(api, {
    cityState,
    triggerRebuild() {
      cityState.publish('published');
    },
    setTrees(t: Trees | null) {
      currentTrees = t;
    },
  });
}

/** A hit shaped like the raycaster's, on the chunk that renders `placement`. */
function treeHit(trees: Trees, placement: number): THREE.Intersection<THREE.Object3D> {
  return {
    object: treeSlot(trees, placement).mesh,
    faceIndex: treeFaceIndex(trees, placement),
    distance: 1,
    point: new THREE.Vector3(),
  } as unknown as THREE.Intersection<THREE.Object3D>;
}

let canvas: HTMLCanvasElement;
beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
});

describe('picker: tree commit picking', () => {
  it('interpretHit on a tree chunk returns the commit that grew that tree', () => {
    const { trees, commits } = makeTrees();
    const world = makeWorld(trees);
    const p = createPicker({
      timeline: TIMELINE,
      events: createEmitter(),
      canvas,
      camera: FAKE_CAMERA,
      world,
      cityState: world.cityState,
    });

    const target = p.interpretHit(treeHit(trees, 1)) as CommitTarget | null;
    expect(target).not.toBeNull();
    expect(target!.kind).toBe(NodeKind.Commit);
    expect(target!.mesh).toBe(treeSlot(trees, 1).mesh);
    expect(target!.instanceId).toBe(1);
    expect(target!.commit).toEqual(commits[1]);
    trees.dispose();
    p.dispose();
  });

  it('interpretHit returns null when the trees handle is null', () => {
    const { trees } = makeTrees();
    const world = makeWorld(null);
    const p = createPicker({
      timeline: TIMELINE,
      events: createEmitter(),
      canvas,
      camera: FAKE_CAMERA,
      world,
      cityState: world.cityState,
    });
    expect(p.interpretHit(treeHit(trees, 0))).toBeNull();
    trees.dispose();
    p.dispose();
  });

  it('interpretHit returns null for a face past the last tree', () => {
    const BEYOND_LAST_TREE = 99; // tree slots this test never renders
    const { trees } = makeTrees();
    const world = makeWorld(trees);
    const p = createPicker({
      timeline: TIMELINE,
      events: createEmitter(),
      canvas,
      camera: FAKE_CAMERA,
      world,
      cityState: world.cityState,
    });

    const { mesh } = treeSlot(trees, 0);
    const perTree = (mesh.userData.canopyVerts as number) + (mesh.userData.trunkVerts as number);
    const beyond = {
      object: mesh,
      faceIndex: (perTree * BEYOND_LAST_TREE) / VERTS_PER_TRIANGLE,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;
    expect(p.interpretHit(beyond)).toBeNull();
    trees.dispose();
    p.dispose();
  });

  it('setSelection on a CommitTarget writes a Commit selection key', () => {
    const { trees, commits } = makeTrees(2);
    const world = makeWorld(trees);
    const p = createPicker({
      timeline: TIMELINE,
      events: createEmitter(),
      canvas,
      camera: FAKE_CAMERA,
      world,
      cityState: world.cityState,
    });

    p.setSelection(p.interpretHit(treeHit(trees, 1)));

    expect(p.selectionKey).toEqual({
      kind: NodeKind.Commit,
      sha: commits[1].sha,
    });
    trees.dispose();
    p.dispose();
  });

  it('hydrating a Commit key re-resolves the selection via findTreeBySha', () => {
    const { trees, commits } = makeTrees(2);
    const world = makeWorld(trees);

    const p = createPicker({
      timeline: TIMELINE,
      events: createEmitter(),
      canvas,
      camera: FAKE_CAMERA,
      world,
      cityState: world.cityState,
    });

    // The key arrives before the meshes; the rebuild resolves it.
    p.setSelectionKey({ kind: NodeKind.Commit, sha: commits[1].sha });

    const sel = p.selection as CommitTarget | null;
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe(NodeKind.Commit);
    expect(sel!.commit).toEqual(commits[1]);
    expect(sel!.mesh).toBe(treeSlot(trees, 1).mesh);
    trees.dispose();
    p.dispose();
  });

  it('world rebuild re-resolves a Commit selection onto the fresh meshes', () => {
    const { trees: treesA, commits } = makeTrees(2);
    const world = makeWorld(treesA);
    const p = createPicker({
      timeline: TIMELINE,
      events: createEmitter(),
      canvas,
      camera: FAKE_CAMERA,
      world,
      cityState: world.cityState,
    });
    p.setSelection(p.interpretHit(treeHit(treesA, 1)));

    // Same commits, freshly rendered: the sha still resolves, to new meshes.
    const placements = commits.map((_, i) => treePlacement(i, i * 40, 0));
    const treesB = renderTrees(placements, commits, BUSY);
    world.setTrees(treesB);
    world.triggerRebuild();

    const sel = p.selection as CommitTarget | null;
    expect(sel!.commit).toEqual(commits[1]);
    expect(sel!.mesh).toBe(treeSlot(treesB, 1).mesh);
    expect(sel!.mesh).not.toBe(treeSlot(treesA, 1).mesh);
    treesA.dispose();
    treesB.dispose();
    p.dispose();
  });

  it('hydrating a Commit key for a missing sha clears the selection + key', () => {
    const { trees } = makeTrees(1);
    const world = makeWorld(trees);

    const p = createPicker({
      timeline: TIMELINE,
      events: createEmitter(),
      canvas,
      camera: FAKE_CAMERA,
      world,
      cityState: world.cityState,
    });

    // The key arrives before the meshes; the rebuild resolves it.
    p.setSelectionKey({ kind: NodeKind.Commit, sha: 'f'.repeat(40) });

    expect(p.selection).toBeNull();
    expect(p.selectionKey).toBeNull();
    trees.dispose();
    p.dispose();
  });
});
