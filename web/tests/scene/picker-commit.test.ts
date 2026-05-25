// picker-commit.test.ts — verifies interpretHit produces a CommitTarget
// for canopy + trunk mesh hits, and that selection-key derivation +
// re-resolution work through the Commit branch.

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPicker, PICKER_SELECTION_KEY } from '@/scene/system/picker.js';
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
  m.userData.placementOrder = [0, 1, 2];
  return m;
}

function makeTrunk(): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
    3,
  );
  m.userData.meshKind = 'tree-trunk';
  m.userData.placementOrder = [0, 1, 2];
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
  };
}

function makeWorld(trees: FakeTrees | null): PickerWorld {
  const listeners: Array<() => void> = [];
  return {
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
    getTrees: () => trees,
  };
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
