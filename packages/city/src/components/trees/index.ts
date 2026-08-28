// city/components/trees/index.ts — the trees component: its group, the merged
// tree meshes, the theme effect and the hover outline. Trees are built before
// the picker exists, so the outline is constructed on the first tick() instead:
// at construction its effects would track no signal and never fire again.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { createTreeRenderer, type Trees } from './treeRenderer';
import { createTreeOutlineRenderer } from './outline';
import type { TreePlacement } from './treePlacement';
import type { BusynessThresholds, CommitEntry, RepoStats } from '@/city/types/manifest';

export type { Trees };

/** Public contract for the trees component. */
export interface TreesComponent extends SceneComponent {
  // Required here, optional on SceneComponent: this one always has a tick, and
  // a caller holding this type shouldn't have to prove it.
  tick(dt: number, ctx: FrameContext): void;
  /** The inner meshes, rebuilt from the placements the build published. */
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
    _inner = createTreeRenderer(ctx.settings, placements, commits, busyness, stats, scannedAt);
    group.add(_inner.group);
  }

  // Reads only TREES, so it is safe at construction, before the picker.
  const stopTheme = ctx.settings.on('TREES', () => {
    _inner?.refresh();
    _outline?.refreshMaterials();
  });

  // The build places the trees and publishes them with the rest of the city, so
  // this renders a signal like every other component: nothing pops in later.
  const stopPlacements = effect(() => {
    const placements = cityState.treePlacements.value;
    untracked(() => {
      if (!placements) {
        clear();
      } else {
        const manifest = cityState.manifest.peek();
        rebuild(
          placements,
          manifest?.commits ?? null,
          manifest?.busyness ?? { avg: 1, busy: 1 },
          manifest?.stats,
          manifest?.scanned_at
        );
      }
    });
  });

  // Constructed at arming, which is what makes its effects live. The armed flag
  // is sticky, so a stray tick after dispose can't raise a dead component.
  const _arm = armOnFirstTick(ctx, () => {
    _outline = createTreeOutlineRenderer({
      canvas: ctx.canvas,
      scene: ctx.scene,
      picker: ctx.picker!,
      getTrees: () => _inner,
      settings: ctx.settings,
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
    stopPlacements();
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
