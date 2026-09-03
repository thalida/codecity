// createCity builds trees before the picker exists, so the picker-driven
// effects are armed on the first tick() instead of at construction. Effects
// armed at construction would track no signal and never fire again.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { createTrees } from '../../../src/components/trees';
import { createCityState } from '../../../src/state';
import {
  commitTarget,
  makeCityState,
  makePickableSceneContext,
  stubPlacementClient,
  treePlacement,
} from '../../_helpers/cityFixtures';
import { commits as buildCommits } from '../../_helpers/commits';
import { commitStats } from '../../_helpers/statsFixtures';
import type { Picker } from '../../../src/interaction/picker';
import type { SceneContext } from '../../../src/types';
import { createTestCityResources } from '../../_helpers/cityResources';
import { NodeKind } from '../../../src/types/manifest';
import { StreetAxis } from '../../../src/types/street';
import { settingsStore } from '../../_helpers/citySettings';
import type { CitySettingsStore } from '../../../src/settings/store';
import { createEmitter } from '../../_helpers/cityEvents';

const SETTINGS = settingsStore();

const SHA_A = 'a'.repeat(40);

const COMMITS = buildCommits({ date: '2026-01-01', files: 1, sha: SHA_A, authors: ['Alice'] });
const PLACEMENTS = [treePlacement(0)];

const BUSY = { avg: 1, busy: 1 };

// One street, one building: enough of a city for an apply to publish.
const TREE_LAYOUT = {
  buildings: [{ x: 0, y: 0, w: 10, d: 10, h: 20 }],
  streets: [
    {
      x: 0,
      y: 0,
      width: 32,
      length: 200,
      orientation: StreetAxis.X,
      isRoot: true,
      dir: { name: 'root', path: '.', type: NodeKind.Directory },
    },
  ],
  bbox: { minX: -100, minY: -16, maxX: 100, maxY: 16, cx: 0, cy: 0, width: 200, depth: 32 },
};

/** The packer, stubbed to a fixed layout: this file is about what the trees do
 *  with what the build publishes, not about how the packer arrives at it. */
function layoutClientFor(layout: unknown) {
  return { compute: async () => layout, dispose: () => {} };
}

function manifestWith(commits: unknown) {
  return {
    tree: { type: 'directory', name: 'repo', path: '.', children: [] },
    structure_signature: 'sig',
    layout_signature: 'sig',
    commits,
    busyness: BUSY,
    dateRanges: { minCreated: null, maxCreated: null, minModified: null, maxModified: null },
  } as never;
}

// SceneContext with controllable picker signals + a fake canvas with client
// dims, which the outline LineMaterial reads during arming.

// Pre-picker ctx: picker null (the construction-time window).
function makePrePickerCtx(settings: CitySettingsStore): SceneContext {
  return {
    scene: new THREE.Scene(),
    canvas: document.createElement('canvas'),
    picker: null as unknown as Picker,
    cityState: makeCityState(settings),
    settings,
  } as unknown as SceneContext;
}

// A throwaway camera for tick() frames where the camera value doesn't matter.
const CAMERA = new THREE.PerspectiveCamera();

const FRAME = (camera: THREE.PerspectiveCamera) => ({ dt: 0, time: 0, camera });

describe('createTrees() component door', () => {
  let trees: ReturnType<typeof createTrees>;
  // A fresh store per case starts at stock values, so nothing needs restoring.
  let store: ReturnType<typeof settingsStore>;

  beforeEach(() => {
    store = settingsStore();
  });

  afterEach(() => {
    trees?.dispose();
  });

  it('constructs with an empty named group and a null handle (pre-rebuild)', () => {
    const { ctx } = makePickableSceneContext(undefined, store);
    trees = createTrees(ctx);
    expect(trees.group).toBeInstanceOf(THREE.Group);
    expect(trees.group.name).toBe('city-trees');
    expect(trees.group.children).toHaveLength(0);
    expect(trees.getRenderer()).toBeNull();
  });

  it('theme effect is inert while the picker is still null', () => {
    // createTrees runs before the picker exists, so the effect fires against a
    // null inner renderer. Its optional chaining is what holds here.
    trees = createTrees(makePrePickerCtx(store));
    store.update({ TREES: { OUTLINE_WIDTH: 7 } });
    expect(trees.getRenderer()).toBeNull();
    expect(trees.group.children).toHaveLength(0);
  });

  // Driven through applyManifest, the way trees really arrive. Assigning
  // treePlacements by hand would pass even if the build stopped placing them.
  it('renders the placements an apply published, in the same flush as the city', async () => {
    const cityState = createCityState(
      layoutClientFor(TREE_LAYOUT) as never,
      stubPlacementClient(PLACEMENTS) as never,
      createTestCityResources(SETTINGS),
      SETTINGS,
      createEmitter()
    );
    const { ctx } = makePickableSceneContext(cityState);
    trees = createTrees(ctx);
    expect(trees.getRenderer()).toBeNull();

    await cityState.applyManifest(manifestWith(COMMITS));

    expect(cityState.treePlacements).toEqual(PLACEMENTS);
    expect(trees.getRenderer()).not.toBeNull();
    expect(trees.group.children.length).toBeGreaterThan(0);
  });

  it('rebuild() builds the inner renderer under the group; getRenderer() is live', () => {
    const { ctx } = makePickableSceneContext(undefined, store);
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
    const { ctx } = makePickableSceneContext(undefined, store);
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
    const { ctx } = makePickableSceneContext(undefined, store);
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    const first = trees.getRenderer()!;
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    expect(trees.getRenderer()).not.toBe(first);
    expect(first.group.parent).toBeNull();
    expect(trees.group.children).toHaveLength(1);
  });

  it('theme effect refreshes the inner renderer on TREES Save', () => {
    const { ctx } = makePickableSceneContext(undefined, store);
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    const refreshSpy = vi.spyOn(trees.getRenderer()!, 'refresh');
    store.update({ TREES: { TRUNK_COLOR: '#ff0000' } });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT show an outline for a selection set before the first tick (not yet armed)', () => {
    const { ctx, picker } = makePickableSceneContext(undefined, store);
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    picker.setSelection(commitTarget(SHA_A));
    // No outline meshes were added to the scene — the renderer isn't built.
    const outlines = ctx.scene.children.filter((c) => c instanceof LineSegments2);
    expect(outlines).toHaveLength(0);
  });

  it('arms the outline on first tick; the pending Commit selection becomes visible', () => {
    const { ctx, picker } = makePickableSceneContext(undefined, store);
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    picker.setSelection(commitTarget(SHA_A));

    trees.tick(0, FRAME(CAMERA));
    // Arming constructs the outline renderer: its selection effect runs
    // immediately and resolves the pending selection via the live handle.
    const outlines = ctx.scene.children.filter(
      (c): c is LineSegments2 => c instanceof LineSegments2
    );
    expect(outlines).toHaveLength(2);
    expect(outlines.filter((o) => o.visible)).toHaveLength(1);

    // Clearing the selection hides it (live effect).
    picker.setSelection(null);
    expect(outlines.filter((o) => o.visible)).toHaveLength(0);
  });

  it('tick() with a null picker does not arm', () => {
    const ctx = makePrePickerCtx(store);
    trees = createTrees(ctx);
    trees.tick(0, FRAME(new THREE.PerspectiveCamera()));
    expect(ctx.scene.children.filter((c) => c instanceof LineSegments2)).toHaveLength(0);
  });

  it('onResize() pushes fresh canvas dimensions into the outline materials', () => {
    const { ctx, size } = makePickableSceneContext(undefined, store);
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
    const { ctx, picker } = makePickableSceneContext(undefined, store);
    trees = createTrees(ctx);
    trees.rebuild(PLACEMENTS, COMMITS, BUSY, commitStats(COMMITS));
    trees.tick(0, FRAME(CAMERA)); // arm
    const refreshSpy = vi.spyOn(trees.getRenderer()!, 'refresh');

    trees.dispose();
    expect(trees.getRenderer()).toBeNull();
    expect(trees.group.children).toHaveLength(0);
    expect(ctx.scene.children.filter((c) => c instanceof LineSegments2)).toHaveLength(0);
    // A TREES save after teardown must not reach the renderer.
    store.update({ TREES: { TRUNK_COLOR: '#00ff00' } });
    picker.setSelection(commitTarget(SHA_A));
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});
