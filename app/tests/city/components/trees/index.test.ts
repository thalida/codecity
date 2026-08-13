// createCity builds trees before the picker exists, so the picker-driven
// effects are armed on the first tick() instead of at construction. Effects
// armed at construction would track no signal and never fire again.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { createTrees } from '@/city/components/trees';
import {
  commitTarget,
  makeCityState,
  makePickableSceneContext,
  treePlacement,
} from '../../../_helpers/cityFixtures';
import { TREES } from '@/state/stores/settings/trees';
import { commits as buildCommits } from '../../../_helpers/commits';
import { commitStats } from '../../../_helpers/statsFixtures';
import type { Picker } from '@/city/interaction/picker';
import type { SceneContext } from '@/city/types';

const SHA_A = 'a'.repeat(40);

const COMMITS = buildCommits({ date: '2026-01-01', files: 1, sha: SHA_A, authors: ['Alice'] });
const PLACEMENTS = [treePlacement(0)];

const BUSY = { avg: 1, busy: 1 };

const _origTrees = TREES.value;

// SceneContext with controllable picker signals + a fake canvas with client
// dims, which the outline LineMaterial reads during arming.

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

  it('theme effect is inert while the picker is still null', () => {
    // createTrees runs before the picker exists, so the effect fires against a
    // null inner renderer. Its optional chaining is what holds here.
    trees = createTrees(makePrePickerCtx());
    TREES.value = { ...TREES.value };
    expect(trees.getRenderer()).toBeNull();
    expect(trees.group.children).toHaveLength(0);
  });

  it('signal-driven rebuild runs without a cycle (clears + bumps decorationRevision)', async () => {
    const { ctx } = makePickableSceneContext();
    const cs = ctx.cityState;
    trees = createTrees(ctx);
    const before = cs.decorationRevision.value;
    // bbox stays null so run takes the clear+Idle early return, exercising
    // the synchronous prefix that must not self-subscribe ("Cycle detected").
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
    // The inner renderer carries the merged tree chunk meshes.
    const meshes = handle!.group.children.filter((c) => c.userData?.meshKind === 'trees');
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

    trees.clear(); // idempotent: a second clear leaves the same state
    expect(trees.getRenderer()).toBeNull();
    expect(trees.group.children).toHaveLength(0);
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

  it('tick() with a null picker does not arm', () => {
    const ctx = makePrePickerCtx();
    trees = createTrees(ctx);
    trees.tick(0, FRAME(new THREE.PerspectiveCamera()));
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
    // A TREES save after teardown must not reach the renderer.
    TREES.value = { ...TREES.value, TRUNK_COLOR: '#00ff00' };
    selection.value = commitTarget(SHA_A);
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});
