// scene/animator.ts — tween queue for entering / staying transitions
// when cityScene.applyManifest swaps in a new manifest.
//
// Subscribes to cityScene.onChange. For every entering building, starts
// a "grow in" tween (scaleY from ~0 → final height). For staying
// buildings whose layout shifted, tweens position and/or scale from old
// → new. Exit animations aren't supported in this V1 — disposed
// buildings just vanish — because cityScene drops the old instances
// before firing the diff.
//
// With InstancedMesh, the animator writes the instance matrix directly
// via setMatrixAt(i, matrix) instead of mutating per-mesh transform
// properties. needsUpdate is set once per dirty mesh per frame
// (deduplicated across all tweens) so we don't trigger multiple buffer
// re-uploads on the same mesh.
//
// Public:
//   const animator = createAnimator({ cityScene });
//   animator.update(dtMs);   // called from animate() each frame
//   animator.dispose();
//
// Field ownership: animator owns the instance matrix (scale + position).
// buildingFader owns iOpacity. They write to disjoint fields so they
// cannot conflict by construction.

import * as THREE from 'three';
import type { CitySceneDiff } from '@/types';
import type { SceneBlock } from './blocks.js';
import type { createCityScene } from './cityScene.js';

interface Tween {
  block: SceneBlock;
  instanceId: number;
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

// Default durations (ms). Subjective; smoke-tested for "snappy but
// readable" on file-save bursts.
const ENTER_MS = 400;
const STAY_MS = 350;

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function createAnimator({ cityScene }: { cityScene: ReturnType<typeof createCityScene> }) {
  // Tween queue. Each tween targets one (block, instanceId) pair and
  // animates both scale and position together (a single matrix write per
  // frame). Keyed by (block, instanceId) so a fresh tween supersedes
  // any in-flight one on the same target without stacking.
  const tweens: Tween[] = [];

  function _findTween(block: SceneBlock, instanceId: number): number {
    return tweens.findIndex((t) => t.block === block && t.instanceId === instanceId);
  }

  function _addOrUpdate(t: Tween): void {
    const idx = _findTween(t.block, t.instanceId);
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

  function _onChange(diff: CitySceneDiff): void {
    // Entering: grow in from near-zero scale. Y position starts at ~0
    // and rises to the final center (h/2) so the base stays grounded.
    for (const e of diff.entering.buildings) {
      const { block, instanceId, newScaleX, newScaleY, newScaleZ, newPosX, newPosY, newPosZ } = e;
      _addOrUpdate({
        block,
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
        durationMs: ENTER_MS,
        easing: easeOutCubic,
        startedAt: performance.now(),
      });
    }
    // Staying with shifted position / scale: animate from old → new.
    for (const s of diff.staying.buildings) {
      const {
        block,
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
      const hasScaleChange =
        oldScaleX !== newScaleX || oldScaleY !== newScaleY || oldScaleZ !== newScaleZ;
      const hasPosChange = oldPosX !== newPosX || oldPosY !== newPosY || oldPosZ !== newPosZ;
      if (!hasScaleChange && !hasPosChange) continue;
      _addOrUpdate({
        block,
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
        durationMs: STAY_MS,
        easing: easeOutCubic,
        startedAt: performance.now(),
      });
    }
  }

  const _unsub = cityScene.onChange(_onChange);

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
      if (!tw.block.detailMesh) {
        // Block was disposed between frames — drop the tween.
        tweens.splice(i, 1);
        continue;
      }
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
      tw.block.detailMesh.setMatrixAt(tw.instanceId, _tmpMatrix);
      dirtyMeshes.add(tw.block.detailMesh);

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
