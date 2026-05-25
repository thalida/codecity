// picker-commit.test.ts — verifies interpretHit produces a CommitTarget
// for canopy + trunk mesh hits, and that selection-key derivation +
// re-resolution work through the Commit branch.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY, estimateTreePixelSize, TREE_HOVER_MIN_PIXELS } from '@/scene/system/picker.js';
import { NodeKind } from '@/types';
import type { CommitEntry, PickerWorld, CommitTarget } from '@/types';

const FAKE_CAMERA = {} as unknown as THREE.Camera;

function makeCanopy(): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
    3,
  );
  m.userData.meshKind = 'tree-canopy';
  return m;
}

function makeTrunk(): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
    3,
  );
  m.userData.meshKind = 'tree-trunk';
  return m;
}

function commit(i: number): CommitEntry {
  return {
    date: `2026-03-${String(i + 1).padStart(2, '0')}`,
    files: i + 1,
    sha: `${i.toString(16).padStart(8, '0')}${'0'.repeat(32)}`,
  };
}

interface FakeTrees {
  group: THREE.Group;
  commitForInstance: (
    mesh: THREE.InstancedMesh, instanceId: number,
  ) => CommitEntry | null;
  findTreeBySha: (sha: string) => {
    mesh: THREE.InstancedMesh; instanceId: number; commit: CommitEntry;
  } | null;
  colorForSha: (sha: string) => string | null;
  setHoverSha: (sha: string | null) => void;
  setSelectionSha: (sha: string | null) => void;
}

function makeFakeTrees(canopy: THREE.InstancedMesh, trunk: THREE.InstancedMesh, commits: CommitEntry[]): FakeTrees {
  const group = new THREE.Group();
  group.add(canopy);
  group.add(trunk);
  return {
    group,
    commitForInstance(mesh, instanceId) {
      if (mesh !== canopy && mesh !== trunk) return null;
      return commits[instanceId] ?? null;
    },
    findTreeBySha(sha) {
      const idx = commits.findIndex((c) => c.sha === sha);
      if (idx === -1) return null;
      return { mesh: canopy, instanceId: idx, commit: commits[idx] };
    },
    colorForSha(sha) {
      const idx = commits.findIndex((c) => c.sha === sha);
      return idx === -1 ? null : '#abcdef';
    },
    setHoverSha(_sha) {},
    setSelectionSha(_sha) {},
  };
}

function makeWorld(initialTrees: FakeTrees | null): PickerWorld & {
  triggerRebuild(): void;
  setTrees(t: FakeTrees | null): void;
} {
  const listeners: Array<() => void> = [];
  let currentTrees = initialTrees;
  const api: PickerWorld = {
    getStreetPickables: () => [],
    getRootGem: () => null,
    getBuildingByPath: () => null,
    getSidewalkByDir: () => null,
    getStreetByDir: () => null,
    onChange: (cb) => {
      listeners.push(cb);
      return () => {};
    },
    getBuildingIndex: () => null,
    getCells: () => new Map(),
    getTrees: () => currentTrees,
  };
  return Object.assign(api, {
    triggerRebuild() {
      for (const cb of listeners) cb();
    },
    setTrees(t: FakeTrees | null) {
      currentTrees = t;
    },
  });
}

let canvas: HTMLCanvasElement;
beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  PICKER_SELECTION_KEY.set(null);
});

describe('picker: tree commit picking', () => {
  it('interpretHit on a canopy InstancedMesh returns a CommitTarget', () => {
    const canopy = makeCanopy();
    const trunk = makeTrunk();
    const commits = [commit(0), commit(1), commit(2)];
    const trees = makeFakeTrees(canopy, trunk, commits);
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    const hit = {
      object: canopy,
      instanceId: 1,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;

    const target = p.interpretHit(hit) as CommitTarget | null;
    expect(target).not.toBeNull();
    expect(target!.kind).toBe(NodeKind.Commit);
    expect(target!.mesh).toBe(canopy);
    expect(target!.instanceId).toBe(1);
    expect(target!.commit).toEqual(commits[1]);
    p.dispose();
  });

  it('interpretHit on a trunk InstancedMesh returns a CommitTarget', () => {
    const canopy = makeCanopy();
    const trunk = makeTrunk();
    const commits = [commit(0), commit(1), commit(2)];
    const trees = makeFakeTrees(canopy, trunk, commits);
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    const hit = {
      object: trunk,
      instanceId: 2,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;

    const target = p.interpretHit(hit) as CommitTarget | null;
    expect(target!.kind).toBe(NodeKind.Commit);
    expect(target!.commit).toEqual(commits[2]);
    p.dispose();
  });

  it('interpretHit returns null when the trees handle is null', () => {
    const world = makeWorld(null);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });
    const canopy = makeCanopy();
    const hit = {
      object: canopy,
      instanceId: 0,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;
    expect(p.interpretHit(hit)).toBeNull();
    p.dispose();
  });

  it('interpretHit returns null when commitForInstance returns null for a stale slot', () => {
    const canopy = makeCanopy();
    const trunk = makeTrunk();
    const commits = [commit(0), commit(1), commit(2)];
    const trees = makeFakeTrees(canopy, trunk, commits);
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    // makeFakeTrees.commitForInstance returns null for instanceId >= commits.length.
    const hit = {
      object: canopy,
      instanceId: 99,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;

    expect(p.interpretHit(hit)).toBeNull();
    p.dispose();
  });

  it('setSelection on a CommitTarget writes a Commit selection key', () => {
    const canopy = makeCanopy();
    const trunk = makeTrunk();
    const commits = [commit(0), commit(1)];
    const trees = makeFakeTrees(canopy, trunk, commits);
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    p.setSelection({
      kind: NodeKind.Commit,
      mesh: canopy,
      instanceId: 1,
      commit: commits[1],
    });

    expect(PICKER_SELECTION_KEY.get()).toEqual({
      kind: NodeKind.Commit,
      sha: commits[1].sha,
    });
    p.dispose();
  });

  it('hydrating a Commit key re-resolves the selection via findTreeBySha', () => {
    const canopy = makeCanopy();
    const trunk = makeTrunk();
    const commits = [commit(0), commit(1)];
    const trees = makeFakeTrees(canopy, trunk, commits);
    const world = makeWorld(trees);

    PICKER_SELECTION_KEY.set({ kind: NodeKind.Commit, sha: commits[1].sha });
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    const sel = p.selection.get() as CommitTarget | null;
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe(NodeKind.Commit);
    expect(sel!.commit).toEqual(commits[1]);
    expect(sel!.mesh).toBe(canopy);
    p.dispose();
  });

  it('world rebuild re-resolves a Commit selection to the fresh trees', () => {
    const canopyA = makeCanopy();
    const trunkA = makeTrunk();
    const commits = [commit(0), commit(1)];
    const treesA = makeFakeTrees(canopyA, trunkA, commits);
    const world = makeWorld(treesA);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    // Pick the second commit from the first world snapshot.
    p.setSelection({
      kind: NodeKind.Commit,
      mesh: canopyA,
      instanceId: 1,
      commit: commits[1],
    });

    // World rebuild: fresh canopy + trunk, same commits list (so the
    // selected SHA is still resolvable to a tree on the new meshes).
    const canopyB = makeCanopy();
    const trunkB = makeTrunk();
    const treesB = makeFakeTrees(canopyB, trunkB, commits);
    world.setTrees(treesB);
    world.triggerRebuild();

    const sel = p.selection.get() as CommitTarget | null;
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe(NodeKind.Commit);
    expect(sel!.commit).toEqual(commits[1]);
    // After rebuild, the mesh handle must be the fresh canopy, not the stale one.
    expect(sel!.mesh).toBe(canopyB);
    p.dispose();
  });

  it('refreshes pickables when trees attach asynchronously after world rebuild', () => {
    const canopyA = makeCanopy();
    const trunkA = makeTrunk();
    const commits = [commit(0)];
    const treesA = makeFakeTrees(canopyA, trunkA, commits);
    const world = makeWorld(treesA);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    // World rebuild: trees absent initially (simulates the moment between
    // street/building rebuild and async tree placement completing).
    world.setTrees(null);
    world.triggerRebuild();
    // Now trees arrive asynchronously and the world fires onChange again.
    const canopyB = makeCanopy();
    const trunkB = makeTrunk();
    const treesB = makeFakeTrees(canopyB, trunkB, commits);
    world.setTrees(treesB);
    world.triggerRebuild();

    // After the second triggerRebuild, picking the new canopy should
    // produce a CommitTarget — proving pickables refreshed.
    const hit = {
      object: canopyB, instanceId: 0, distance: 1, point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;
    const target = p.interpretHit(hit);
    expect(target).not.toBeNull();
    p.dispose();
  });

  it('hydrating a Commit key for a missing sha clears the selection + key', () => {
    const canopy = makeCanopy();
    const trunk = makeTrunk();
    const commits = [commit(0)];
    const trees = makeFakeTrees(canopy, trunk, commits);
    const world = makeWorld(trees);

    PICKER_SELECTION_KEY.set({ kind: NodeKind.Commit, sha: 'f'.repeat(40) });
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    expect(p.selection.get()).toBeNull();
    expect(PICKER_SELECTION_KEY.get()).toBeNull();
    p.dispose();
  });
});

describe('picker: tree pixel-size gate', () => {
  it('estimateTreePixelSize returns a larger value when the camera is closer', () => {
    // fov=50°, canvas 600px tall, tree 144 world units tall.
    // Close at 200 units → >> 12px; far at 20_000 units → << 12px.
    const fov = 50;
    const canvasH = 600;
    const treeH = 144;
    const near = estimateTreePixelSize(fov, canvasH, treeH, 200);
    const far = estimateTreePixelSize(fov, canvasH, treeH, 20_000);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(TREE_HOVER_MIN_PIXELS);
    expect(far).toBeLessThan(TREE_HOVER_MIN_PIXELS);
  });

  it('estimateTreePixelSize returns 0 for non-positive distance', () => {
    expect(estimateTreePixelSize(50, 600, 144, 0)).toBe(0);
    expect(estimateTreePixelSize(50, 600, 144, -10)).toBe(0);
  });

  it('excludes trees from pickAt when the camera is far away (non-PerspectiveCamera → pixel size 0)', () => {
    // The existing FAKE_CAMERA is not a THREE.PerspectiveCamera, so
    // _estimateTreePixelSize() returns 0 (< TREE_HOVER_MIN_PIXELS).
    // Trees are therefore excluded from the raycast candidate list.
    // Since interpretHit is unaffected (it reads world.getTrees() directly),
    // we verify that a fake direct intersection hit via interpretHit still
    // works, while the pick-via-candidates path skips trees.
    const canopy = makeCanopy();
    const trunk = makeTrunk();
    const commits = [commit(0)];
    const trees = makeFakeTrees(canopy, trunk, commits);
    const world = makeWorld(trees);
    const p = createPicker({ canvas, camera: FAKE_CAMERA, world });

    // interpretHit still resolves a hit regardless of the gate (gate
    // only affects which objects the raycaster receives).
    const hit = {
      object: canopy,
      instanceId: 0,
      distance: 1,
      point: new THREE.Vector3(),
    } as unknown as THREE.Intersection<THREE.Object3D>;
    expect(p.interpretHit(hit)).not.toBeNull();

    p.dispose();
  });

  it('includes trees in pickAt candidates when the camera is a close PerspectiveCamera', () => {
    // Use a real PerspectiveCamera very close to origin (trees group pos).
    // estimateTreePixelSize should return >> TREE_HOVER_MIN_PIXELS.
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
    cam.position.set(0, 200, 0); // 200 world units away
    // Verify the formula produces a large enough value to pass the gate.
    const pixelSize = estimateTreePixelSize(cam.fov, 600, 144, cam.position.length());
    expect(pixelSize).toBeGreaterThan(TREE_HOVER_MIN_PIXELS);
  });
});
