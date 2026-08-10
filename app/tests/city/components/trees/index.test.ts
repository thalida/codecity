// createCity builds trees before the picker exists, so the picker-driven
// effects are armed on the first tick() instead of at construction. Effects
// armed at construction would track no signal and never fire again.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { createTrees } from '@/city/components/trees';
import { makeCityState, makePickableSceneContext } from '../../../_helpers/cityFixtures';
import { TREES } from '@/state/stores/settings/trees';
import { NodeKind } from '@/types';
import type { CommitEntry } from '@/types';
import { commitStats } from '../../../_helpers/statsFixtures';
import type { PickTarget } from '@/types/picker';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import type { Picker } from '@/city/interaction/picker';
import type { SceneContext } from '@/city/types';

const SHA_A = 'a'.repeat(40);

const COMMITS: CommitEntry[] = [
  {
    date: '2026-01-01',
    files: 1,
    sha: SHA_A,
    authors: ['Alice'],
    subject: 'a',
    same_day_total: 1,
  },
];

const PLACEMENTS: TreePlacement[] = [{ x: 0, y: 0, seed: 0, commitIndex: 0 } as TreePlacement];

const BUSY = { avg: 1, busy: 1 };

const _origTrees = TREES.value;

// A SceneContext whose picker exposes controllable selection + hover signals,
// and a fake renderer.domElement canvas (with resizable client dims) so the
// outline LineMaterial can read clientWidth/Height during arming.

// Pre-picker ctx: picker null (the construction-time window).
function makePrePickerCtx(): SceneContext {
  return {
    scene: new THREE.Scene(),
    canvas: document.createElement('canvas'),
    picker: null as unknown as Picker,
    cityState: makeCityState(),
  } as unknown as SceneContext;
}

// A throwaway camera for tick() frames where the camera value doesn't matter.
const CAMERA = new THREE.PerspectiveCamera();

function commitTarget(sha: string): PickTarget {
  return {
    kind: NodeKind.Commit,
    mesh: new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 1),
    instanceId: 0,
    commit: { sha, date: '2026-01-01', files: 1, authors: ['Alice'], subject: 'a' },
  } as unknown as PickTarget;
}

const FRAME = (camera: THREE.PerspectiveCamera) => ({ dt: 0, time: 0, camera });

describe('createTrees() component door', () => {
  let trees: ReturnType<typeof createTrees>;

  beforeEach(() => {
    TREES.value = { ..._origTrees };
  });

  afterEach(() => {
    trees?.dispose();
    TREES.value = { ..._origTrees };
  });

  it('constructs with an empty named group and a null handle (pre-rebuild)', () => {
    const { ctx } = makePickableSceneContext();
    trees = createTrees(ctx);
    expect(trees.group).toBeInstanceOf(THREE.Group);
    expect(trees.group.name).toBe('city-trees');
    expect(trees.group.children).toHaveLength(0);
    expect(trees.getRenderer()).toBeNull();
  });

  it('theme effect runs at construction with a null picker without throwing', () => {
    expect(() => {
      trees = createTrees(makePrePickerCtx());
      TREES.value = { ...TREES.value };
    }).not.toThrow();
  });

  it('signal-driven rebuild runs without a cycle (clears + bumps decorationRevision)', async () => {
    const { ctx } = makePickableSceneContext();
    const cs = ctx.cityState;
    trees = createTrees(ctx);
    const before = cs.decorationRevision.value;
    // Drive the reactive deferred pass the way applyManifest does. bbox stays
    // null → sceneBbox null → run takes the clear+Idle early return (no rAF / no
    // worker), exercising the synchronous prefix that must NOT subscribe the
    // effect to the signals it writes (regression: "Cycle detected").
    cs.manifest.value = { tree: { name: 'x' }, commits: [] } as never;
    cs.layout.value = { buildings: [], streets: [] } as never;
    await Promise.resolve();
    await Promise.resolve();
    expect(cs.treePlacements.value).toBeNull();
    expect(cs.decorationRevision.value).toBeGreaterThan(before);
  });

  it('rebuild() builds the inner renderer under the group; getRenderer() is live', () => {
    const { ctx } = makePickableSceneContext();
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    const handle = trees.getRenderer();
    expect(handle).not.toBeNull();
    expect(handle!.group.parent).toBe(trees.group);
    // The inner renderer carries the trunk + canopy InstancedMeshes.
    const meshes = handle!.group.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBeGreaterThan(0);
    expect(handle!.findTreeBySha(SHA_A)).not.toBeNull();
  });

  it('clear() disposes the inner renderer, empties the group, nulls the handle', () => {
    const { ctx } = makePickableSceneContext();
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    trees.clear();
    expect(trees.getRenderer()).toBeNull();
    expect(trees.group.children).toHaveLength(0);
    // Idempotent.
    expect(() => trees.clear()).not.toThrow();
  });

  it('rebuild() disposes the prior inner renderer (no accumulation)', () => {
    const { ctx } = makePickableSceneContext();
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    const first = trees.getRenderer()!;
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    expect(trees.getRenderer()).not.toBe(first);
    expect(first.group.parent).toBeNull();
    expect(trees.group.children).toHaveLength(1);
  });

  it('theme effect refreshes the inner renderer on TREES Save', () => {
    const { ctx } = makePickableSceneContext();
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    const refreshSpy = vi.spyOn(trees.getRenderer()!, 'refresh');
    TREES.value = { ...TREES.value, TRUNK_COLOR: '#ff0000' };
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT show an outline for a selection set before the first tick (not yet armed)', () => {
    const { ctx, selection } = makePickableSceneContext();
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    selection.value = commitTarget(SHA_A);
    // No outline meshes were added to the scene — the renderer isn't built.
    const outlines = ctx.scene.children.filter((c) => c instanceof LineSegments2);
    expect(outlines).toHaveLength(0);
  });

  it('arms the outline on first tick; the pending Commit selection becomes visible', () => {
    const { ctx, selection } = makePickableSceneContext();
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    selection.value = commitTarget(SHA_A);

    trees.tick(0, FRAME(CAMERA));
    // Arming constructs the outline renderer: its selection effect runs
    // immediately and resolves the pending selection via the live handle.
    const outlines = ctx.scene.children.filter(
      (c): c is LineSegments2 => c instanceof LineSegments2
    );
    expect(outlines).toHaveLength(2);
    expect(outlines.filter((o) => o.visible)).toHaveLength(1);

    // Clearing the selection hides it (live effect).
    selection.value = null;
    expect(outlines.filter((o) => o.visible)).toHaveLength(0);
  });

  it('tick() with a null picker does not arm (and does not throw)', () => {
    const ctx = makePrePickerCtx();
    trees = createTrees(ctx);
    expect(() => trees.tick(0, FRAME(new THREE.PerspectiveCamera()))).not.toThrow();
    expect(ctx.scene.children.filter((c) => c instanceof LineSegments2)).toHaveLength(0);
  });

  it('onResize() pushes fresh canvas dimensions into the outline materials', () => {
    const { ctx, size } = makePickableSceneContext();
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    trees.tick(0, FRAME(CAMERA)); // arm
    size.w = 1024;
    size.h = 768;
    trees.onResize();
    const outline = ctx.scene.children.find((c): c is LineSegments2 => c instanceof LineSegments2)!;
    const mat = outline.material as unknown as { resolution: THREE.Vector2 };
    expect(mat.resolution.x).toBe(1024);
    expect(mat.resolution.y).toBe(768);
  });

  it('dispose() clears the inner renderer, stops the theme effect, removes outlines', () => {
    const { ctx, selection } = makePickableSceneContext();
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    trees.tick(0, FRAME(CAMERA)); // arm
    const refreshSpy = vi.spyOn(trees.getRenderer()!, 'refresh');

    trees.dispose();
    expect(trees.getRenderer()).toBeNull();
    expect(trees.group.children).toHaveLength(0);
    expect(ctx.scene.children.filter((c) => c instanceof LineSegments2)).toHaveLength(0);
    // Theme effect stopped — a later TREES Save no longer refreshes.
    expect(() => {
      TREES.value = { ...TREES.value, TRUNK_COLOR: '#00ff00' };
      selection.value = commitTarget(SHA_A);
    }).not.toThrow();
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});
