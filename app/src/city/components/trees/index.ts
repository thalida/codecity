// city/components/trees/index.ts — the trees component: its group, the merged
// tree meshes, the theme effect and the hover outline. Trees are built before
// the picker exists, so the outline is constructed on the first tick() instead:
// at construction its effects would track no signal and never fire again.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { TREES } from '@/state/settings/fields/trees';
import { markDecorating, markIdle } from '@/state/stores/build';
import type { BusynessThresholds, CommitEntry, RepoStats } from '@/types';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { nextPaint } from '../../utils/nextPaint';
import { reactiveRebuild } from '../../utils/reactiveRebuild';
import { createTreeRenderer, type Trees } from './treeRenderer';
import { createTreeOutlineRenderer } from './outline';
import { createTreePlacementClient } from './treePlacementClient';
import type { TreePlacement } from './treePlacement';

export type { Trees };

/** Public contract for the trees component. */
export interface TreesComponent extends SceneComponent {
  /** The inner meshes, rebuilt from placements on the deferred pass. */
  rebuild(
    placements: TreePlacement[],
    commits: CommitEntry[] | null,
    busyness: BusynessThresholds,
    stats: RepoStats | null | undefined,
    scannedAt?: string | null
  ): void;
  /** Dispose the inner meshes + null the handle. */
  clear(): void;
  /** Null until built and after a clear: three consumers depend on that. */
  getRenderer(): Trees | null;
  /** Window-resize hook — forwards to the outline LineMaterial resolutions. */
  onResize(): void;
  /** Timeline scrub gate — forwards to the inner renderer; no-op pre-rebuild
   *  (nothing to gate yet). See treeRenderer.ts Trees.setScrubCommit. */
  setScrubCommit(maxCommitIndex: number | null): void;
  /** The scrubbed date, so each tree is the size it was then. */
  setScrubNow(nowMs: number | null): void;
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

  // Reads only TREES, so it is safe at construction, before the picker.
  const stopTheme = effect(() => {
    void TREES.value;
    _inner?.refresh();
    _outline?.refreshMaterials();
  });

  // Clears first, then defers past the paint and scans off-thread, so a large
  // repo stays interactive; a newer apply supersedes an in-flight scan.
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

      // Let the city paint before the placement scan + GPU upload begin.
      markDecorating();
      await nextPaint();
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
      // Fireflies rebuild off the placements, and the picker re-resolves a
      // commit selection now that the meshes exist.
      cityState.treePlacements.value = placements;
      if (_inner !== null) cityState.decorationRevision.value++;
      markIdle();
    }
  );

  // Constructed at arming, which is what makes its effects live. The armed flag
  // is sticky, so a stray tick after dispose can't raise a dead component.
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
    setScrubNow: (nowMs) => _inner?.setScrubNow(nowMs),
  };
}
