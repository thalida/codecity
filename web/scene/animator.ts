// scene/animator.ts — tween queue for entering / staying transitions
// when cityScene.applyManifest swaps in a new manifest.
//
// Subscribes to cityScene.onChange. For every entering building, starts
// a "grow in" tween (scale.y from 0 → final). For staying buildings
// whose layout shifted, tweens position from old → new. Exit
// animations aren't supported in this V1 — disposed buildings just
// vanish — because cityScene drops the old meshes before firing the
// diff. A follow-up can keep dying meshes alive by marking
// userData.exiting + tween scale.y → 0 + cityScene.disposeMesh on
// completion, but the bookkeeping is heavier and out of scope here.
//
// Public:
//   const animator = createAnimator({ cityScene });
//   animator.update(dtMs);   // called from animate() each frame
//   animator.dispose();
//
// Field ownership: animator owns mesh.scale.{x,y,z} and mesh.position.
// buildingFader owns material.opacity. They write to disjoint fields
// so they cannot conflict by construction.

import * as THREE from 'three';
import { TweenKind } from '@/types';
import type { CitySceneDiff } from '@/types';
import type { createCityScene } from './cityScene.js';

interface Tween {
  mesh: THREE.Mesh;
  kind: TweenKind;
  // ScaleY tweens use fromVal/toVal; Position tweens use fromX/toX/etc.
  // The fields are unioned because a single tween record uses one set or
  // the other depending on `kind`.
  fromVal?: number;
  toVal?: number;
  fromX?: number;
  fromY?: number;
  fromZ?: number;
  toX?: number;
  toY?: number;
  toZ?: number;
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
  // Tween queue: each tween is { mesh, kind, prop, fromX/Y/Z, toX/Y/Z,
  // fromVal, toVal, durationMs, easing, startedAt, onComplete }.
  // We support two prop kinds: 'scaleY' (number) and 'position' (vec3).
  // Keying by (mesh, kind) so a fresh tween supersedes any in-flight
  // one on the same target+kind without stacking.
  const tweens: Tween[] = [];

  function _findTween(mesh: THREE.Mesh, kind: TweenKind): number {
    return tweens.findIndex((t) => t.mesh === mesh && t.kind === kind);
  }

  function _addOrUpdate(t: Tween): void {
    const idx = _findTween(t.mesh, t.kind);
    if (idx >= 0) {
      // Supersede in-flight tween with new target. Retain startedAt so
      // the animation doesn't restart from scratch on rapid edits.
      const existing = tweens[idx];
      existing.toVal = t.toVal;
      existing.toX = t.toX;
      existing.toY = t.toY;
      existing.toZ = t.toZ;
      existing.fromVal = t.fromVal;
      existing.fromX = t.fromX;
      existing.fromY = t.fromY;
      existing.fromZ = t.fromZ;
      existing.durationMs = t.durationMs;
      existing.easing = t.easing;
      // Keep existing.startedAt so the elapsed time persists.
    } else {
      tweens.push(t);
    }
  }

  function _tweenScaleY(
    mesh: THREE.Mesh,
    fromVal: number,
    toVal: number,
    durationMs: number
  ): void {
    if (fromVal === toVal) return;
    mesh.scale.y = fromVal; // snap to start so the first frame is correct
    _addOrUpdate({
      mesh,
      kind: TweenKind.ScaleY,
      fromVal,
      toVal,
      durationMs,
      easing: easeOutCubic,
      startedAt: performance.now(),
    });
  }

  function _tweenPosition(
    mesh: THREE.Mesh,
    fromVec: THREE.Vector3,
    toVec: THREE.Vector3,
    durationMs: number
  ): void {
    if (fromVec.x === toVec.x && fromVec.y === toVec.y && fromVec.z === toVec.z) return;
    mesh.position.copy(fromVec);
    _addOrUpdate({
      mesh,
      kind: TweenKind.Position,
      fromX: fromVec.x,
      fromY: fromVec.y,
      fromZ: fromVec.z,
      toX: toVec.x,
      toY: toVec.y,
      toZ: toVec.z,
      durationMs,
      easing: easeOutCubic,
      startedAt: performance.now(),
    });
  }

  function _onChange(diff: CitySceneDiff): void {
    // Entering: start small, grow to layout height.
    for (const e of diff.entering.buildings) {
      _tweenScaleY(e.mesh, 0.0001, e.newScaleY, ENTER_MS);
    }
    // Staying with shifted position / scale: animate to new transform.
    for (const s of diff.staying.buildings) {
      if (!s.oldPosition) continue;
      _tweenPosition(s.newMesh, s.oldPosition, s.newPosition, STAY_MS);
      if (typeof s.oldScaleY === 'number' && s.oldScaleY !== s.newScaleY) {
        _tweenScaleY(s.newMesh, s.oldScaleY, s.newScaleY, STAY_MS);
      }
    }
  }

  const _unsub = cityScene.onChange(_onChange);

  function update(_dtMs: number): void {
    if (tweens.length === 0) return;
    const now = performance.now();
    // Iterate backwards so we can splice completed tweens cheaply.
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      // Defensive: if the mesh was disposed between frames, drop the tween.
      if (tw.mesh.userData && tw.mesh.userData.disposed) {
        tweens.splice(i, 1);
        continue;
      }
      let t = (now - tw.startedAt) / tw.durationMs;
      if (t >= 1) t = 1;
      const eased = tw.easing(t);
      if (tw.kind === TweenKind.ScaleY) {
        tw.mesh.scale.y = tw.fromVal! + (tw.toVal! - tw.fromVal!) * eased;
      } else if (tw.kind === TweenKind.Position) {
        tw.mesh.position.set(
          tw.fromX! + (tw.toX! - tw.fromX!) * eased,
          tw.fromY! + (tw.toY! - tw.fromY!) * eased,
          tw.fromZ! + (tw.toZ! - tw.fromZ!) * eased
        );
      }
      if (t >= 1) tweens.splice(i, 1);
    }
  }

  function dispose() {
    if (typeof _unsub === 'function') _unsub();
    tweens.length = 0;
  }

  return { update, dispose };
}
