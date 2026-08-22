// city/components/fireflies/index.ts — fireflies component: swaps the inner
// assembly in on every apply's decoration pass, repaints on FIREFLIES Saves,
// animates in tick(). Built BEFORE the picker exists, so the picker-driven
// boost effects arm on the first tick(), never at construction.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import { NodeKind } from '@/types';
import type { CommitEntry, RepoStats } from '@/types';
import type { TreePlacement } from '@/city/components/trees/treePlacement';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { createFireflyAssembly, type Fireflies } from './fireflies';

export type { Fireflies };

/** Public contract for the fireflies component. */
export interface FirefliesComponent extends SceneComponent {
  // Required here, optional on SceneComponent: this one always has a tick, and
  // a caller holding this type shouldn't have to prove it.
  tick(dt: number, ctx: FrameContext): void;
  /** Rebuild the inner assembly from placements — driven by the
   *  treePlacements signal, in lockstep with trees. */
  rebuild(
    placements: TreePlacement[],
    commits: CommitEntry[] | null,
    stats: RepoStats | null | undefined
  ): void;
  /** Dispose the inner assembly. */
  clear(): void;
  /** Canvas-resize hook — forwards to the orbit-ring LineMaterial
   *  resolution. */
  onResize(width: number, height: number): void;
  /** Timeline scrub gate — forwards to the inner assembly; no-op pre-rebuild
   *  (nothing to gate yet). See fireflies.ts Fireflies.setScrubCommit. */
  setScrubCommit(maxCommitIndex: number | null): void;
  /** Timeline scrub date — sizes the orbs and their orbits. */
  setScrubNow(nowMs: number | null): void;
}

export function createFireflies(ctx: SceneContext): FirefliesComponent {
  // Persistent outer group — added to the scene once by createCityScene. rebuild()
  // swaps the inner assembly's group in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-fireflies';

  const { sceneState } = ctx;

  let _inner: Fireflies | null = null;

  function clear(): void {
    if (_inner) {
      group.remove(_inner.group);
      _inner.dispose();
      _inner = null;
    }
  }

  function rebuild(
    placements: TreePlacement[],
    commits: CommitEntry[] | null,
    stats: RepoStats | null | undefined,
    scannedAt?: string | null
  ): void {
    clear();
    // Deliberately does NOT push current hover/selection into the fresh
    // renderer — see the arming block's no-push rule below.
    _inner = createFireflyAssembly(
      placements,
      commits,
      stats,
      scannedAt,
      ctx.config.FIREFLIES,
      ctx.config.TREES,
      ctx.canvas
    );
    group.add(_inner.group);
  }

  // An orb Save refreshes the uniforms in place; structural keys are
  // Rebuild-routed. Safe at construction: it reads only this city's config.
  const stopTheme = effect(() => {
    void ctx.config.FIREFLIES.value;
    _inner?.refresh();
  });

  // Rebuild off treePlacements (lockstep with trees). untracked() stops a
  // FIREFLIES subscription reallocating orbs on every slider drag.
  const stopPlacements = effect(() => {
    const placements = sceneState.treePlacements.value;
    if (placements)
      untracked(() => {
        const manifest = sceneState.manifest.peek();
        rebuild(placements, manifest?.commits ?? null, manifest?.stats, manifest?.scanned_at);
      });
    else clear();
  });

  // Armed on first tick() (no picker at construction). A fresh renderer
  // starts at -1 uniforms; the NEXT signal change repopulates it.
  const _arm = armOnFirstTick(ctx, () => {
    const stopHover = effect(() => {
      const h = ctx.picker!.hover.value;
      if (!_inner) return;
      _inner.setHoveredCommit(h && h.kind === NodeKind.Commit ? h.commit.sha : null);
    });
    const stopSel = effect(() => {
      const sel = ctx.picker!.selection.value;
      if (!_inner) return;
      _inner.setSelectedCommit(sel && sel.kind === NodeKind.Commit ? sel.commit.sha : null);
    });
    return [stopHover, stopSel];
  });

  // Arms the boost effects on the first call, then drives uTime + the ring
  // rainbow chase (setTime forwards to both).
  function tick(_dt: number, frame: FrameContext): void {
    _arm.arm();
    _inner?.setTime(frame.time);
  }

  function onResize(width: number, height: number): void {
    _inner?.onResize(width, height);
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
    tick,
    onResize,
    dispose,
    setScrubCommit: (maxCommitIndex) => _inner?.setScrubCommit(maxCommitIndex),
    setScrubNow: (nowMs) => _inner?.setScrubNow(nowMs),
  };
}
