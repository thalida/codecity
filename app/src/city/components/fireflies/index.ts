// city/components/fireflies/index.ts — Fireflies COMPONENT (public door).
//
// Self-contained scene component: owns a persistent group, swaps the inner
// firefly assembly (orbs + orbit rings, one cluster per commit tree) in via
// rebuild() on the deferred decoration pass of every applyManifest, reacts
// to FIREFLIES settings via its own theme effect, drives the bob uTime +
// orbit-ring rainbow chase in tick(), and owns the hover/select boost
// effects.
//
// Construction-time bridge: fireflies are built by createCity
// BEFORE the picker exists. The theme effect reads only FIREFLIES signals,
// so it's safe at construction. The two hover/select boost effects are
// picker-driven, so they are NOT created at construction (ctx.picker is null
// there — they'd track NO signal and never re-fire). They are ARMED on the
// first tick(), once createCity has populated ctx.picker.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import { FIREFLIES } from '@/state/stores/settings/fireflies';
import { NodeKind } from '@/types';
import type { CommitEntry, RepoStats } from '@/types';
import type { TreePlacement } from '@/city/components/trees/treePlacement';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import { createFireflies as assembleFireflies, type Fireflies } from './fireflies';

export type { Fireflies };

/** Public contract for the fireflies component. */
export interface FirefliesComponent extends SceneComponent {
  /** Build (or rebuild) the inner firefly assembly from placements. Driven by
   *  the cityState.treePlacements signal trees publishes (in lockstep with
   *  trees, every apply). */
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
}

export function createFireflies(ctx: SceneContext): FirefliesComponent {
  // Persistent outer group — added to the scene once by createCity. rebuild()
  // swaps the inner assembly's group in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-fireflies';

  const { cityState } = ctx;

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
    // renderer (which starts with -1 uniforms) — see the arming block's
    // no-push rule below; the next signal change pushes them.
    // The FIREFLIES.ENABLED gate stays inside fireflies.ts (an empty stub
    // assembly is returned when disabled).
    _inner = assembleFireflies(placements, commits, stats, scannedAt);
    group.add(_inner.group);
  }

  // FIREFLIES theme effect — reacts to FIREFLIES Save (BOB/PULSE/EMISSION/
  // FLICKER/ORBIT_SPEED uniforms). Structural keys (ENABLED, SCALE_MIN/MAX,
  // ORBIT_RING_*) remain Rebuild-routed via attachSettingsReactions →
  // applyManifest → rebuild(). Safe at construction: reads only FIREFLIES
  // signals.
  const stopTheme = effect(() => {
    void FIREFLIES.value;
    _inner?.refresh();
  });

  // Placement effect — fireflies rebuild off the treePlacements signal trees
  // publishes (null → clear at the start of a rebuild; the array → rebuild once
  // the deferred scan resolves), so they track trees in lockstep. commits is
  // read at that moment (peek — placements is the trigger, not the manifest).
  //
  // rebuild() is wrapped untracked because assembleFireflies reads FIREFLIES.value
  // (ENABLED, scale, orbit). Without it this effect would subscribe to the whole
  // FIREFLIES store and reallocate the instanced mesh on every Refresh-route
  // theme Save (a flash + GPU churn on each slider drag) on top of the in-place
  // stopTheme refresh. The Rebuild-route structural fields reach here via the
  // treePlacements republish (applyManifest → trees rebuild).
  const stopPlacements = effect(() => {
    const placements = cityState.treePlacements.value;
    if (placements)
      untracked(() => {
        const manifest = cityState.manifest.peek();
        rebuild(placements, manifest?.commits ?? null, manifest?.stats, manifest?.scanned_at);
      });
    else clear();
  });

  // Hover/select boost effects — ARMED on the first tick(), NOT at
  // construction (ctx.picker is null there). The bodies read _inner
  // DYNAMICALLY: after a rebuild the fresh renderer starts with -1 uniforms
  // and the NEXT signal change pushes the current hover/selection into the NEW
  // inner. Do NOT push current values inside rebuild() — that would be a
  // behavior change.
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

  // tick() — arms the boost effects on the first call, then drives the bob
  // uTime + the orbit-ring rainbow chase (setTime forwards to both). frame
  // .time is ((performance.now() - startTime) / 1000).
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
  };
}
