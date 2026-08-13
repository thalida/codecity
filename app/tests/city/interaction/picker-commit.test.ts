// picker-commit.test.ts — verifies interpretHit produces a CommitTarget
// for merged tree-chunk hits, and that selection-key derivation +
// re-resolution work through the Commit branch.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import { createCityState } from '@/city/state';
import { makeCityState } from '../../_helpers/cityFixtures';
import { commitSeries } from '../../_helpers/commits';

const SERIES = commitSeries(3);
import { NodeKind } from '@/types';
import type { CommitEntry, PickerWorld, CommitTarget } from '@/types';

const FAKE_CAMERA = {} as unknown as THREE.Camera;

function makeChunkMesh(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  m.userData.meshKind = 'trees';
  return m;
}

interface FakeTrees {
  group: THREE.Group;
  commitForFace: (
    mesh: THREE.Object3D,
    faceIndex: number | null | undefined
  ) => { commit: CommitEntry; placementIndex: number } | null;
  findTreeBySha: (sha: string) => {
    mesh: THREE.Mesh;
    instanceId: number;
    commit: CommitEntry;
  } | null;
  getInstanceTransform: (sha: string, out: THREE.Matrix4) => boolean;
  colorForSha: (sha: string) => string | null;
  isScrubHidden: (placementIndex: number) => boolean;
}

// Fake merged renderer: face f is tree f (the real face→range math is
// pinned by treeRenderer.test's commitForFace coverage).
function makeFakeTrees(chunk: THREE.Mesh, commits: CommitEntry[]): FakeTrees {
  const group = new THREE.Group();
  group.add(chunk);
  return {
    group,
    commitForFace(mesh, faceIndex) {
      if (mesh !== chunk || faceIndex == null) return null;
      const commit = commits[faceIndex];
      return commit ? { commit, placementIndex: faceIndex } : null;
    },
    findTreeBySha(sha) {
      const idx = commits.findIndex((c) => c.sha === sha);
      if (idx === -1) return null;
      return { mesh: chunk, instanceId: idx, commit: commits[idx] };
    },
    getInstanceTransform(sha, _out) {
      const idx = commits.findIndex((c) => c.sha === sha);
      return idx !== -1;
    },
    colorForSha(sha) {
      const idx = commits.findIndex((c) => c.sha === sha);
      return idx === -1 ? null : '#abcdef';
    },
    isScrubHidden: () => false,
  };
}

function makeWorld(initialTrees: FakeTrees | null): PickerWorld & {
  cityState: ReturnType<typeof createCityState>;
  triggerRebuild(): void;
  triggerDecoration(): void;
  setTrees(t: FakeTrees | null): void;
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
    setTrees(t: FakeTrees | null) {
      currentTrees = t;
    },
  });
}

function treeHit(mesh: THREE.Object3D, faceIndex: number): THREE.Intersection<THREE.Object3D> {
  return {
    object: mesh,
    faceIndex,
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
  it('interpretHit on a merged tree chunk returns a CommitTarget', () => {
    const chunk = makeChunkMesh();
    const commits = [SERIES[0], SERIES[1], SERIES[2]];
    const trees = makeFakeTrees(chunk, commits);
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    const target = p.interpretHit(treeHit(chunk, 1)) as CommitTarget | null;
    expect(target).not.toBeNull();
    expect(target!.kind).toBe(NodeKind.Commit);
    expect(target!.mesh).toBe(chunk);
    expect(target!.instanceId).toBe(1);
    expect(target!.commit).toEqual(commits[1]);
    p.dispose();
  });

  it('interpretHit returns null when the trees handle is null', () => {
    const world = makeWorld(null);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });
    expect(p.interpretHit(treeHit(makeChunkMesh(), 0))).toBeNull();
    p.dispose();
  });

  it('interpretHit returns null when commitForFace returns null for a stale face', () => {
    const chunk = makeChunkMesh();
    const commits = [SERIES[0], SERIES[1], SERIES[2]];
    const trees = makeFakeTrees(chunk, commits);
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    // makeFakeTrees.commitForFace returns null past commits.length.
    expect(p.interpretHit(treeHit(chunk, 99))).toBeNull();
    p.dispose();
  });

  it('setSelection on a CommitTarget writes a Commit selection key', () => {
    const chunk = makeChunkMesh();
    const commits = [SERIES[0], SERIES[1]];
    const trees = makeFakeTrees(chunk, commits);
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    p.setSelection({
      kind: NodeKind.Commit,
      mesh: chunk,
      instanceId: 1,
      commit: commits[1],
    });

    expect(PICKER_SELECTION_KEY.value).toEqual({
      kind: NodeKind.Commit,
      sha: commits[1].sha,
    });
    p.dispose();
  });

  it('hydrating a Commit key re-resolves the selection via findTreeBySha', () => {
    const chunk = makeChunkMesh();
    const commits = [SERIES[0], SERIES[1]];
    const trees = makeFakeTrees(chunk, commits);
    const world = makeWorld(trees);

    PICKER_SELECTION_KEY.value = { kind: NodeKind.Commit, sha: commits[1].sha };
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    const sel = p.selection.value as CommitTarget | null;
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe(NodeKind.Commit);
    expect(sel!.commit).toEqual(commits[1]);
    expect(sel!.mesh).toBe(chunk);
    p.dispose();
  });

  it('world rebuild re-resolves a Commit selection to the fresh trees', () => {
    const chunkA = makeChunkMesh();
    const commits = [SERIES[0], SERIES[1]];
    const treesA = makeFakeTrees(chunkA, commits);
    const world = makeWorld(treesA);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    // Pick the second commit from the first world snapshot.
    p.setSelection({
      kind: NodeKind.Commit,
      mesh: chunkA,
      instanceId: 1,
      commit: commits[1],
    });

    // World rebuild: fresh chunk mesh, same commits list (so the selected
    // SHA is still resolvable to a tree on the new mesh).
    const chunkB = makeChunkMesh();
    const treesB = makeFakeTrees(chunkB, commits);
    world.setTrees(treesB);
    world.triggerRebuild();

    const sel = p.selection.value as CommitTarget | null;
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe(NodeKind.Commit);
    expect(sel!.commit).toEqual(commits[1]);
    // After rebuild, the mesh handle must be the fresh chunk, not the stale one.
    expect(sel!.mesh).toBe(chunkB);
    p.dispose();
  });

  it('refreshes pickables when trees attach asynchronously after world rebuild', () => {
    const chunkA = makeChunkMesh();
    const commits = [SERIES[0]];
    const treesA = makeFakeTrees(chunkA, commits);
    const world = makeWorld(treesA);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    // Rebuild with trees absent: the window between street/building rebuild
    // and async placement completing.
    world.setTrees(null);
    world.triggerRebuild();
    // Now trees arrive asynchronously and the world bumps decorationRevision.
    const chunkB = makeChunkMesh();
    const treesB = makeFakeTrees(chunkB, commits);
    world.setTrees(treesB);
    world.triggerDecoration();

    // Picking the new chunk should produce a CommitTarget — proving
    // pickables refreshed.
    const target = p.interpretHit(treeHit(chunkB, 0));
    expect(target).not.toBeNull();
    p.dispose();
  });

  it('hydrating a Commit key for a missing sha clears the selection + key', () => {
    const chunk = makeChunkMesh();
    const commits = [SERIES[0]];
    const trees = makeFakeTrees(chunk, commits);
    const world = makeWorld(trees);

    PICKER_SELECTION_KEY.value = { kind: NodeKind.Commit, sha: 'f'.repeat(40) };
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world, cityState: world.cityState });

    expect(p.selection.value).toBeNull();
    expect(PICKER_SELECTION_KEY.value).toBeNull();
    p.dispose();
  });
});
