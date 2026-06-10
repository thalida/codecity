// city/components/fireflies/index.ts — Fireflies COMPONENT (public door).
//
// Self-contained scene component: owns a persistent group, swaps the inner
// firefly assembly (orbs + orbit rings, one cluster per commit tree) in via
// rebuild() on the deferred decoration pass of every applyManifest, reacts
// to FIREFLIES settings via its own theme effect, drives the bob uTime +
// orbit-ring rainbow chase in tick(), and owns the hover/select boost
// effects (formerly two world.getFireflies()-refetching effects in
// renderLoop.ts).
//
// Construction-time bridge (Strategy A): fireflies are built inside world.ts
// BEFORE the picker exists. The theme effect reads only FIREFLIES signals,
// so it's safe at construction. The two hover/select boost effects are
// picker-driven, so they are NOT created at construction (ctx.picker is null
// there — they'd track NO signal and never re-fire). They are ARMED on the
// first tick(), once renderLoop has populated ctx.picker.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { FIREFLIES } from '@/state/stores/settings/fireflies';
import { NodeKind } from '@/types';
import type { CommitEntry } from '@/types';
import type { TreePlacement } from '@/city/components/trees/treePlacement';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { createFireflies as assembleFireflies, type Fireflies } from './fireflies';

export type { Fireflies };

/** Public contract for the fireflies component. */
export interface FirefliesComponent extends SceneComponent {
  /** Build (or rebuild) the inner firefly assembly. Called from world's
   *  deferred decoration pass — NOT scenic-gated (rebuilt every
   *  applyManifest, in lockstep with trees). */
  rebuild(placements: TreePlacement[], commits: CommitEntry[] | null): void;
  /** Dispose the inner assembly + null the handle. Called by world at the
   *  same point the old code disposed _fireflies. */
  clear(): void;
  /** Inner handle, or null pre-rebuild / post-clear. Preserves
   *  world.getFireflies()'s null-until-built contract. */
  handle(): Fireflies | null;
  /** Canvas-resize hook — forwards to the orbit-ring LineMaterial
   *  resolution. */
  onResize(width: number, height: number): void;
}

export function createFireflies(ctx: SceneContext): FirefliesComponent {
  // Persistent outer group — added to the scene once by world.ts. rebuild()
  // swaps the inner assembly's group in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-fireflies';

  let _inner: Fireflies | null = null;

  function clear(): void {
    if (_inner) {
      // (Old world did scene.remove(_fireflies.group) + dispose.)
      group.remove(_inner.group);
      _inner.dispose();
      _inner = null;
    }
  }

  function rebuild(placements: TreePlacement[], commits: CommitEntry[] | null): void {
    clear();
    // Deliberately does NOT push current hover/selection into the fresh
    // renderer (which starts with -1 uniforms) — see the arming block's
    // no-push rule below; the next signal change pushes them.
    // The FIREFLIES.ENABLED gate stays inside fireflies.ts (an empty stub
    // assembly is returned when disabled).
    _inner = assembleFireflies(placements, commits);
    group.add(_inner.group);
  }

  // FIREFLIES theme effect — reacts to FIREFLIES Save. Replaces applyTheme()'s
  // `world.getFireflies()?.refresh()` (BOB/PULSE/EMISSION/FLICKER/ORBIT_SPEED
  // uniforms). Structural keys (ENABLED, SCALE_MIN/MAX, ORBIT_RING_*) remain
  // Rebuild-routed via configCommitReactions → applyManifest → rebuild(),
  // exactly as today. Safe at construction: reads only FIREFLIES signals.
  const stopTheme = effect(() => {
    void FIREFLIES.value;
    _inner?.refresh();
  });

  // Hover/select boost effects — ARMED on the first tick(), NOT at
  // construction (ctx.picker is null there). The bodies read _inner
  // DYNAMICALLY — the component-local equivalent of the old renderLoop
  // effects re-fetching world.getFireflies() each fire: after a rebuild the
  // fresh renderer starts with -1 uniforms and the NEXT signal change pushes
  // the current hover/selection into the NEW inner. Do NOT push current
  // values inside rebuild() — that would be a behavior change. Creation
  // order (hover effect, then selection effect) matches the old renderLoop.
  let _armed = false;
  let _stopHover = () => {};
  let _stopSel = () => {};
  function _armInteractions(): void {
    if (_armed || !ctx.picker) return;
    _armed = true;
    _stopHover = effect(() => {
      const h = ctx.picker!.hover.value;
      if (!_inner) return;
      _inner.setHoveredCommit(h && h.kind === NodeKind.Commit ? h.commit.sha : null);
    });
    _stopSel = effect(() => {
      const sel = ctx.picker!.selection.value;
      if (!_inner) return;
      _inner.setSelectedCommit(sel && sel.kind === NodeKind.Commit ? sel.commit.sha : null);
    });
  }

  // tick() — arms the boost effects on the first call, then drives the bob
  // uTime + the orbit-ring rainbow chase (setTime forwards to both). frame
  // .time is the same clock the old renderLoop setTime block used
  // ((performance.now() - startTime) / 1000).
  function tick(_dt: number, frame: FrameContext): void {
    _armInteractions();
    _inner?.setTime(frame.time);
  }

  function onResize(width: number, height: number): void {
    _inner?.onResize(width, height);
  }

  function dispose(): void {
    clear();
    stopTheme();
    _stopHover();
    _stopSel();
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
