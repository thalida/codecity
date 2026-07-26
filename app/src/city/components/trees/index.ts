// city/components/trees/index.ts — Trees COMPONENT (public door).
//
// Self-contained scene component: owns a persistent group, swaps the inner
// instanced tree meshes (one tree per commit) in via rebuild() on the
// deferred decoration pass of every applyManifest, reacts to TREES settings
// via its own theme effect (canopy/trunk recolor + outline materials), and
// absorbs the tree hover/selected outline renderer (./outline).
//
// Construction-time bridge: trees are built by createCity BEFORE the picker
// exists. The theme effect reads only TREES signals, so it's safe at
// construction. The outline renderer subscribes to picker.hover/selection
// inside its factory, so it is NOT constructed at component construction
// (ctx.picker is null there — its effects would track NO signal and never
// re-fire). It is ARMED on the first tick(), once createCity has backfilled
// ctx.picker.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { TREES } from '@/state/stores/settings/trees';
import { markDecorating, markIdle } from '@/state/stores/manifest';
import type { BusynessThresholds, CommitEntry, RepoStats } from '@/types';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { reactiveRebuild } from '../../utils/reactiveRebuild';
import { createTreeRenderer, type Trees } from './treeRenderer';
import { createTreeOutlineRenderer } from './outline';
import { createTreePlacementClient } from './treePlacementClient';
import type { TreePlacement } from './treePlacement';

export type { Trees };

/** Public contract for the trees component. */
export interface TreesComponent extends SceneComponent {
  /** Build (or rebuild) the inner instanced tree meshes from placements. Driven
   *  by the component's own reactive deferred pass (off cityState.layout); not
   *  scenic-gated (trees rebuild every apply). */
  rebuild(
    placements: TreePlacement[],
    commits: CommitEntry[] | null,
    busyness: BusynessThresholds,
    stats: RepoStats | null | undefined,
    scannedAt?: string | null
  ): void;
  /** Dispose the inner meshes + null the handle. */
  clear(): void;
  /** Inner renderer, or null pre-rebuild / post-clear. Preserves the
   *  null-until-built contract (picker pickables, RightSidebar colorForSha,
   *  cameraRig getTreeBoundsBySha all consume it). */
  getRenderer(): Trees | null;
  /** Window-resize hook — forwards to the outline LineMaterial resolutions. */
  onResize(): void;
  /** Timeline scrub gate — forwards to the inner renderer; no-op pre-rebuild
   *  (nothing to gate yet). See treeRenderer.ts Trees.setScrubCommit. */
  setScrubCommit(maxCommitIndex: number | null): void;
  /** Back to live: see ModeDrivable. */
  restoreLiveView(): void;
}

export function createTrees(ctx: SceneContext): TreesComponent {
  // Persistent outer group — added to the scene once by createCity. rebuild()
  // swaps the inner tree renderer's group in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-trees';

  const { cityState } = ctx;
  // Off-thread placement worker — owned by this component now. Lazy: the worker
  // is only spawned on the first compute(), so construction is test-safe.
  const treePlacementClient = createTreePlacementClient();

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
    busyness: BusynessThresholds,
    stats: RepoStats | null | undefined,
    scannedAt?: string | null
  ): void {
    clear();
    _inner = createTreeRenderer(placements, commits, busyness, stats, scannedAt);
    group.add(_inner.group);
  }

  // TREES theme effect — reacts to TREES Save (per-instance canopy/trunk
  // recolor + outline width/color/opacity). Reads only TREES signals, so it's
  // safe at construction (pre-picker); both refs null-guard pre-rebuild /
  // pre-arming.
  const stopTheme = effect(() => {
    void TREES.value;
    _inner?.refresh();
    _outline?.refreshMaterials();
  });

  // Reactive rebuild — the deferred decoration pass, now owned by trees. Fires
  // on every apply (layout/manifest change). It clears first (dropping the
  // treePlacements signal so fireflies clears, and bumping decorationRevision so
  // the picker drops stale tree pickables — order-independent since pickables are
  // read only on pointer events), then defers past the paint and runs the
  // off-thread placement scan so a large repo stays interactive. A newer apply
  // supersedes an in-flight scan via reactiveRebuild's generation guard.
  const stopRebuild = reactiveRebuild(
    () => {
      const layout = cityState.layout.value;
      const manifest = cityState.manifest.value;
      if (!layout || !manifest) return null;
      return { layout, manifest };
    },
    async ({ layout, manifest }, isCurrent) => {
      clear();
      cityState.treePlacements.value = null;
      cityState.decorationRevision.value++;

      // sceneBbox/cityHeight are set by applyManifest synchronously after the
      // batch that triggered this run, so peek() reads the fresh values.
      const sceneBbox = cityState.sceneBbox.peek();
      if (!TREES.value.ENABLED || !sceneBbox) {
        markIdle();
        return;
      }
      const cityHeight = cityState.cityHeight.peek();
      const commitCount = manifest.commits?.length ?? 0;

      // rAF starts the next frame; setTimeout(0) yields so the browser COMPLETES
      // the paint before the placement scan + GPU upload begin.
      markDecorating();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 0));
      if (!isCurrent()) return;

      let placements: TreePlacement[];
      try {
        placements = await treePlacementClient.compute(layout, sceneBbox, commitCount, cityHeight);
      } catch (err) {
        if (err instanceof Error && err.message === 'superseded') return;
        throw err;
      }
      if (!isCurrent()) return;

      rebuild(
        placements,
        manifest.commits ?? null,
        manifest.busyness ?? { avg: 1, busy: 1 },
        manifest.stats,
        manifest.scanned_at
      );
      // Publish placements (fireflies rebuilds off this) and re-notify the picker
      // now that the live tree meshes exist (re-resolve a Commit selection +
      // include them in pickables).
      cityState.treePlacements.value = placements;
      if (_inner !== null) cityState.decorationRevision.value++;
      markIdle();
    }
  );

  // Outline renderer — ARMED on the first tick(), NOT at construction. Its
  // factory creates the two picker-driven effects internally, so constructing
  // it at arming (ctx.picker live) is what makes them live; at construction
  // ctx.picker is null and the effects would be permanently dead. getTrees is
  // a dynamic closure over _inner so the outline survives rebuilds.
  // armOnFirstTick's sticky armed flag (not `if (_outline)`) survives
  // dispose() nulling _outline, so a stray post-dispose tick() can't re-arm a
  // dead component (same pattern as streets/buildings/fireflies).
  const _arm = armOnFirstTick(ctx, () => {
    _outline = createTreeOutlineRenderer({
      canvas: ctx.canvas,
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
  });

  // tick() — arms the outline on the first call, then drives its per-frame
  // transform snap + rainbow chase.
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
    stopRebuild.dispose();
    treePlacementClient.dispose();
    _arm.dispose();
  }

  return {
    group,
    rebuild,
    clear,
    getRenderer: () => _inner,
    tick,
    onResize,
    dispose,
    setScrubCommit: (maxCommitIndex) => _inner?.setScrubCommit(maxCommitIndex),
    restoreLiveView: () => _inner?.setScrubCommit(null),
  };
}
