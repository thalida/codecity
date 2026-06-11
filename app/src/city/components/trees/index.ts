// city/components/trees/index.ts — Trees COMPONENT (public door).
//
// Self-contained scene component: owns a persistent group, swaps the inner
// instanced tree meshes (one tree per commit) in via rebuild() on the
// deferred decoration pass of every applyManifest, reacts to TREES settings
// via its own theme effect (canopy/trunk recolor + outline materials), and
// absorbs the tree hover/selected outline renderer (./outline — formerly an
// effects module constructed in renderLoop).
//
// Construction-time bridge (Strategy A): trees are built inside world.ts
// BEFORE the picker/camera/renderer exist. The theme effect reads only TREES
// signals, so it's safe at construction. The outline renderer subscribes to
// picker.hover/selection inside its factory, so it is NOT constructed at
// component construction (ctx.picker is null there — its effects would track
// NO signal and never re-fire). It is ARMED on the first tick(), once
// renderLoop has populated ctx.picker/ctx.renderer.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { TREES } from '@/state/stores/settings/trees';
import type { BusynessThresholds, CommitEntry } from '@/types';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { createTreeRenderer, type Trees } from './treeRenderer';
import { createTreeOutlineRenderer } from './outline';
import type { TreePlacement } from './treePlacement';

export type { Trees };

/** Public contract for the trees component. */
export interface TreesComponent extends SceneComponent {
  /** Build (or rebuild) the inner instanced tree meshes. Called from world's
   *  deferred decoration pass — NOT scenic-gated (trees rebuild every
   *  applyManifest). */
  rebuild(
    placements: TreePlacement[],
    commits: CommitEntry[] | null,
    busyness: BusynessThresholds
  ): void;
  /** Dispose the inner meshes + null the handle. Called by world at the same
   *  point the old code disposed _trees (before the first onChange emit). */
  clear(): void;
  /** Inner renderer handle, or null pre-rebuild / post-clear. Preserves
   *  world.getTrees()'s null-until-built contract (picker pickables,
   *  RightSidebar colorForSha, cameraRig getTreeBoundsBySha all consume it). */
  handle(): Trees | null;
  /** Window-resize hook — forwards to the outline LineMaterial resolutions. */
  onResize(): void;
}

export function createTrees(ctx: SceneContext): TreesComponent {
  // Persistent outer group — added to the scene once by world.ts. rebuild()
  // swaps the inner tree renderer's group in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-trees';

  let _inner: Trees | null = null;
  // Declared BEFORE the theme effect below — the effect body runs
  // synchronously at creation and reads _outline (TDZ otherwise).
  let _outline: ReturnType<typeof createTreeOutlineRenderer> | null = null;

  function clear(): void {
    if (_inner) {
      // treeRenderer.dispose() removes its group from the parent (this group).
      _inner.dispose();
      _inner = null;
    }
  }

  function rebuild(
    placements: TreePlacement[],
    commits: CommitEntry[] | null,
    busyness: BusynessThresholds
  ): void {
    clear();
    _inner = createTreeRenderer(placements, commits, busyness);
    group.add(_inner.group);
  }

  // TREES theme effect — reacts to TREES Save. Replaces applyTheme()'s
  // `world.getTrees()?.refresh()` (per-instance canopy/trunk recolor) +
  // `treeOutlineRenderer.refreshMaterials()` (outline width/color/opacity).
  // Reads only TREES signals, so it's safe at construction (pre-picker);
  // both refs null-guard pre-rebuild / pre-arming.
  const stopTheme = effect(() => {
    void TREES.value;
    _inner?.refresh();
    _outline?.refreshMaterials();
  });

  // Outline renderer — ARMED on the first tick(), NOT at construction. Its
  // factory creates the two picker-driven effects internally, so constructing
  // it at arming (ctx.picker live) is what makes them live; at construction
  // ctx.picker is null and the effects would be permanently dead. getTrees is
  // a dynamic closure over _inner so the outline survives rebuilds.
  // armOnFirstTick's sticky armed flag (not `if (_outline)`) survives
  // dispose() nulling _outline, so a stray post-dispose tick() can't re-arm a
  // dead component (same pattern as streets/buildings/fireflies).
  const _arm = armOnFirstTick(
    ctx,
    () => {
      _outline = createTreeOutlineRenderer({
        canvas: ctx.renderer!.domElement,
        scene: ctx.scene,
        picker: ctx.picker!,
        getTrees: () => _inner,
      });
      return [
        () => {
          _outline?.dispose();
          _outline = null;
        },
      ];
    },
    { needsRenderer: true }
  );

  // tick() — arms the outline on the first call, then drives its per-frame
  // transform snap + rainbow chase (the old renderLoop
  // `treeOutlineRenderer.update(0)` slot).
  function tick(_dt: number, _frame: FrameContext): void {
    _arm.arm();
    _outline?.update(0);
  }

  function onResize(): void {
    _outline?.onResize();
  }

  function dispose(): void {
    clear();
    stopTheme();
    _arm.dispose();
  }

  return {
    group,
    rebuild,
    clear,
    handle: () => _inner,
    tick,
    onResize,
    dispose,
  };
}
