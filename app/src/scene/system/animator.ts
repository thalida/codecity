// scene/system/animator.ts — tween queue for entering / staying transitions
// when world.applyManifest swaps in a new manifest.
//
// Subscribes to world.onChange. For every entering building, starts
// a "grow in" tween (scaleY from ~0 → final height). For staying
// buildings whose layout shifted, tweens position and/or scale from old
// → new. Exit animations aren't supported in this V1 — disposed
// buildings just vanish — because world drops the old instances
// before firing the diff.
//
// With InstancedMesh, the animator writes the instance matrix directly
// via setMatrixAt(i, matrix) instead of mutating per-mesh transform
// properties. needsUpdate is set once per dirty mesh per frame
// (deduplicated across all tweens) so we don't trigger multiple buffer
// re-uploads on the same mesh.
//
// The tween stores a Building reference and resolves the target mesh via
// world.getMeshForBuilding() at each frame. This routes correctly to
// cell.detailMesh without duplicating the routing logic here.
//
// Public:
//   const animator = createAnimator({ world });
//   animator.update(dtMs);   // called from animate() each frame
//   animator.dispose();
//
// Field ownership: animator owns the instance matrix (scale + position).
// buildingFader owns iFade. They write to disjoint fields so they
// cannot conflict by construction.

import * as THREE from 'three';
import { BUILDINGS } from '@/state/stores/settings/index';
import type { Building, WorldDiff } from '@/types';
import type { createWorld } from '../world';

interface Tween {
  /** Slot index within the CellTile InstancedMesh (same as building.slotId). */
  instanceId: number;
  /** The Building object carrying cellId + slotId. */
  building: Building;
  // Current interpolated state (written by update(), read by update()).
  fromScaleX: number;
  fromScaleY: number;
  fromScaleZ: number;
  toScaleX: number;
  toScaleY: number;
  toScaleZ: number;
  fromPosX: number;
  fromPosY: number;
  fromPosZ: number;
  toPosX: number;
  toPosY: number;
  toPosZ: number;
  durationMs: number;
  easing: (t: number) => number;
  startedAt: number;
}

// Enter + stay tweens share a single duration (ANIMATION_TIMING
// .BUILDING_TRANSITION_MS). The two were previously hard-coded as
// ENTER_MS=400 and STAY_MS=350 and were always tuned together, so they
// collapsed into one knob. Read fresh per-diff (per file-save burst)
// so Settings tweaks apply to subsequent rebuilds without restart.

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function createAnimator({ world }: { world: ReturnType<typeof createWorld> }) {
  // Tween queue. Each tween targets one building instance and animates
  // both scale and position together (a single matrix write per frame).
  //
  // Dedup key: Building object identity. A fresh tween supersedes any
  // in-flight one on the same building without stacking.
  const tweens: Tween[] = [];

  function _findTween(t: Tween): number {
    return tweens.findIndex((tw) => tw.building === t.building);
  }

  function _addOrUpdate(t: Tween): void {
    const idx = _findTween(t);
    if (idx >= 0) {
      // Supersede in-flight tween with new target. Retain startedAt so
      // the animation doesn't restart from scratch on rapid edits.
      const existing = tweens[idx];
      existing.fromScaleX = t.fromScaleX;
      existing.fromScaleY = t.fromScaleY;
      existing.fromScaleZ = t.fromScaleZ;
      existing.toScaleX = t.toScaleX;
      existing.toScaleY = t.toScaleY;
      existing.toScaleZ = t.toScaleZ;
      existing.fromPosX = t.fromPosX;
      existing.fromPosY = t.fromPosY;
      existing.fromPosZ = t.fromPosZ;
      existing.toPosX = t.toPosX;
      existing.toPosY = t.toPosY;
      existing.toPosZ = t.toPosZ;
      existing.durationMs = t.durationMs;
      existing.easing = t.easing;
      // Keep existing.startedAt so the elapsed time persists.
    } else {
      tweens.push(t);
    }
  }

  function _onChange(diff: WorldDiff): void {
    // Snapshot the current building-transition duration once per diff —
    // every tween started by this _onChange shares the same MS, but a
    // later diff (after a Settings tweak) will pick up the new value.
    const transitionMs = BUILDINGS.value.BUILDING_TRANSITION_MS;
    // Entering: grow in from near-zero scale. Y position starts at ~0
    // and rises to the final center (h/2) so the base stays grounded.
    for (const e of diff.entering.buildings) {
      const { building, instanceId, newScaleX, newScaleY, newScaleZ, newPosX, newPosY, newPosZ } =
        e;
      if (!building) continue;
      _addOrUpdate({
        building,
        instanceId,
        fromScaleX: newScaleX,
        fromScaleY: 0.0001,
        fromScaleZ: newScaleZ,
        toScaleX: newScaleX,
        toScaleY: newScaleY,
        toScaleZ: newScaleZ,
        fromPosX: newPosX,
        fromPosY: 0,
        fromPosZ: newPosZ,
        toPosX: newPosX,
        toPosY: newPosY,
        toPosZ: newPosZ,
        durationMs: transitionMs,
        easing: easeOutCubic,
        startedAt: performance.now(),
      });
    }
    // Staying with shifted position / scale: animate from old → new.
    for (const s of diff.staying.buildings) {
      const {
        building,
        instanceId,
        newScaleX,
        newScaleY,
        newScaleZ,
        newPosX,
        newPosY,
        newPosZ,
        oldScaleX,
        oldScaleY,
        oldScaleZ,
        oldPosX,
        oldPosY,
        oldPosZ,
      } = s;
      if (!building) continue;
      const hasScaleChange =
        oldScaleX !== newScaleX || oldScaleY !== newScaleY || oldScaleZ !== newScaleZ;
      const hasPosChange = oldPosX !== newPosX || oldPosY !== newPosY || oldPosZ !== newPosZ;
      if (!hasScaleChange && !hasPosChange) continue;
      _addOrUpdate({
        building,
        instanceId,
        fromScaleX: oldScaleX ?? newScaleX,
        fromScaleY: oldScaleY ?? newScaleY,
        fromScaleZ: oldScaleZ ?? newScaleZ,
        toScaleX: newScaleX,
        toScaleY: newScaleY,
        toScaleZ: newScaleZ,
        fromPosX: oldPosX ?? newPosX,
        fromPosY: oldPosY ?? newPosY,
        fromPosZ: oldPosZ ?? newPosZ,
        toPosX: newPosX,
        toPosY: newPosY,
        toPosZ: newPosZ,
        durationMs: transitionMs,
        easing: easeOutCubic,
        startedAt: performance.now(),
      });
    }
  }

  const _unsub = world.onChange(_onChange);

  // Reusable scratch matrix — allocated once, reused every frame to
  // avoid per-tween GC pressure.
  const _tmpMatrix = new THREE.Matrix4();

  function update(_dtMs: number): void {
    if (tweens.length === 0) return;
    const now = performance.now();
    // Track which InstancedMeshes received a matrix write this frame.
    // needsUpdate is set once per mesh after all tweens for that mesh
    // have been applied (avoids multiple buffer re-uploads per frame).
    const dirtyMeshes = new Set<THREE.InstancedMesh>();

    // Iterate backwards so we can splice completed tweens cheaply.
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];

      // Resolve the target mesh via getMeshForBuilding(), which routes via
      // building.cellId/slotId.
      const resolved = world.getMeshForBuilding(tw.building);
      if (!resolved) {
        // Mesh was disposed between frames (cell evicted) — drop tween.
        tweens.splice(i, 1);
        continue;
      }
      const targetMesh = resolved.mesh;
      const slot = resolved.slot;

      let t = (now - tw.startedAt) / tw.durationMs;
      if (t >= 1) t = 1;
      const eased = tw.easing(t);

      const sx = tw.fromScaleX + (tw.toScaleX - tw.fromScaleX) * eased;
      const sy = tw.fromScaleY + (tw.toScaleY - tw.fromScaleY) * eased;
      const sz = tw.fromScaleZ + (tw.toScaleZ - tw.fromScaleZ) * eased;
      const px = tw.fromPosX + (tw.toPosX - tw.fromPosX) * eased;
      const py = tw.fromPosY + (tw.toPosY - tw.fromPosY) * eased;
      const pz = tw.fromPosZ + (tw.toPosZ - tw.fromPosZ) * eased;

      _tmpMatrix.makeScale(sx, sy, sz);
      _tmpMatrix.setPosition(px, py, pz);
      targetMesh.setMatrixAt(slot, _tmpMatrix);
      dirtyMeshes.add(targetMesh);

      if (t >= 1) tweens.splice(i, 1);
    }

    // Flush: one needsUpdate per dirty mesh, not per tween.
    for (const mesh of dirtyMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function dispose() {
    if (typeof _unsub === 'function') _unsub();
    tweens.length = 0;
  }

  return { update, dispose };
}
