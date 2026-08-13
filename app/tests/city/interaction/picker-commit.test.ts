// picker-commit.test.ts — the Commit branch of the picker, driven by the REAL
// tree renderer: its meshes, its meshKind stamp, its face→commit mapping. A
// stub here would just restate the contract and pass while the two drifted.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import { createCityState } from '@/city/state';
import { makeCityState, treePlacement } from '../../_helpers/cityFixtures';
import { commitSeries } from '../../_helpers/commits';
import { renderTrees, treeFaceIndex, treeSlot } from '../../_helpers/renderTrees';
import type { Trees } from '@/city/components/trees/treeRenderer';
import { VERTS_PER_TRIANGLE } from '@/city/utils/bufferLayout';
import { NodeKind } from '@/types';
import type { PickerWorld, CommitTarget } from '@/types';

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
  triggerDecoration(): void;
  setTrees(t: Trees | null): void;
} {
  // A city rebuild bumps cityRevision; the deferred trees-attach bumps
  // decorationRevision. The picker reacts to both.
  const cityState = makeCityState();
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
      cityState.cityRevision.value++;
    },
    triggerDecoration() {
      cityState.decorationRevision.value++;
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
  PICKER_SELECTION_KEY.value = null;
});

describe('picker: tree commit picking', () => {
  it('interpretHit on a tree chunk returns the commit that grew that tree', () => {
    const { trees, commits } = makeTrees();
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

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
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });
    expect(p.interpretHit(treeHit(trees, 0))).toBeNull();
    trees.dispose();
    p.dispose();
  });

  it('interpretHit returns null for a face past the last tree', () => {
    const BEYOND_LAST_TREE = 99; // tree slots this test never renders
    const { trees } = makeTrees();
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

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
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    p.setSelection(p.interpretHit(treeHit(trees, 1)));

    expect(PICKER_SELECTION_KEY.value).toEqual({
      kind: NodeKind.Commit,
      sha: commits[1].sha,
    });
    trees.dispose();
    p.dispose();
  });

  it('hydrating a Commit key re-resolves the selection via findTreeBySha', () => {
    const { trees, commits } = makeTrees(2);
    const world = makeWorld(trees);

    PICKER_SELECTION_KEY.value = { kind: NodeKind.Commit, sha: commits[1].sha };
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    const sel = p.selection.value as CommitTarget | null;
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
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });
    p.setSelection(p.interpretHit(treeHit(treesA, 1)));

    // Same commits, freshly rendered: the sha still resolves, to new meshes.
    const placements = commits.map((_, i) => treePlacement(i, i * 40, 0));
    const treesB = renderTrees(placements, commits, BUSY);
    world.setTrees(treesB);
    world.triggerRebuild();

    const sel = p.selection.value as CommitTarget | null;
    expect(sel!.commit).toEqual(commits[1]);
    expect(sel!.mesh).toBe(treeSlot(treesB, 1).mesh);
    expect(sel!.mesh).not.toBe(treeSlot(treesA, 1).mesh);
    treesA.dispose();
    treesB.dispose();
    p.dispose();
  });

  it('refreshes pickables when trees attach asynchronously after a rebuild', () => {
    const { trees: treesA, commits } = makeTrees(1);
    const world = makeWorld(treesA);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    // The window between street/building rebuild and async placement finishing.
    world.setTrees(null);
    world.triggerRebuild();
    const placements = commits.map((_, i) => treePlacement(i, i * 40, 0));
    const treesB = renderTrees(placements, commits, BUSY);
    world.setTrees(treesB);
    world.triggerDecoration();

    expect(p.interpretHit(treeHit(treesB, 0))).not.toBeNull();
    treesA.dispose();
    treesB.dispose();
    p.dispose();
  });

  it('hydrating a Commit key for a missing sha clears the selection + key', () => {
    const { trees } = makeTrees(1);
    const world = makeWorld(trees);

    PICKER_SELECTION_KEY.value = { kind: NodeKind.Commit, sha: 'f'.repeat(40) };
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    expect(p.selection.value).toBeNull();
    expect(PICKER_SELECTION_KEY.value).toBeNull();
    trees.dispose();
    p.dispose();
  });
});
