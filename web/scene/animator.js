// scene/animator.js — tween queue for entering / staying transitions
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

// Default durations (ms). Subjective; smoke-tested for "snappy but
// readable" on file-save bursts.
const ENTER_MS = 400;
const STAY_MS = 350;

function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function createAnimator({ cityScene }) {
  // Tween queue: each tween is { mesh, kind, prop, fromX/Y/Z, toX/Y/Z,
  // fromVal, toVal, durationMs, easing, startedAt, onComplete }.
  // We support two prop kinds: 'scaleY' (number) and 'position' (vec3).
  // Keying by (mesh, kind) so a fresh tween supersedes any in-flight
  // one on the same target+kind without stacking.
  const tweens = [];

  function _findTween(mesh, kind) {
    for (let i = 0; i < tweens.length; i++) {
      if (tweens[i].mesh === mesh && tweens[i].kind === kind) return i;
    }
    return -1;
  }

  function _addOrUpdate(t) {
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

  function _tweenScaleY(mesh, fromVal, toVal, durationMs) {
    if (fromVal === toVal) return;
    mesh.scale.y = fromVal; // snap to start so the first frame is correct
    _addOrUpdate({
      mesh: mesh,
      kind: 'scaleY',
      fromVal: fromVal,
      toVal: toVal,
      durationMs: durationMs,
      easing: easeOutCubic,
      startedAt: performance.now(),
    });
  }

  function _tweenPosition(mesh, fromVec, toVec, durationMs) {
    if (fromVec.x === toVec.x && fromVec.y === toVec.y && fromVec.z === toVec.z) return;
    mesh.position.copy(fromVec);
    _addOrUpdate({
      mesh: mesh,
      kind: 'position',
      fromX: fromVec.x,
      fromY: fromVec.y,
      fromZ: fromVec.z,
      toX: toVec.x,
      toY: toVec.y,
      toZ: toVec.z,
      durationMs: durationMs,
      easing: easeOutCubic,
      startedAt: performance.now(),
    });
  }

  function _onChange(diff) {
    // Entering: start small, grow to layout height.
    for (let ei = 0; ei < diff.entering.buildings.length; ei++) {
      const e = diff.entering.buildings[ei];
      if (!e.mesh) continue;
      const newY = typeof e.newScaleY === 'number' ? e.newScaleY : 1;
      _tweenScaleY(e.mesh, 0.0001, newY, ENTER_MS);
    }
    // Staying with shifted position / scale: animate to new transform.
    for (let si = 0; si < diff.staying.buildings.length; si++) {
      const s = diff.staying.buildings[si];
      if (!s.newMesh || !s.oldPosition) continue;
      _tweenPosition(s.newMesh, s.oldPosition, s.newPosition, STAY_MS);
      if (
        typeof s.oldScaleY === 'number' &&
        typeof s.newScaleY === 'number' &&
        s.oldScaleY !== s.newScaleY
      ) {
        _tweenScaleY(s.newMesh, s.oldScaleY, s.newScaleY, STAY_MS);
      }
    }
  }

  const _unsub = cityScene.onChange(_onChange);

  function update(_dtMs) {
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
      if (tw.kind === 'scaleY') {
        tw.mesh.scale.y = tw.fromVal + (tw.toVal - tw.fromVal) * eased;
      } else if (tw.kind === 'position') {
        tw.mesh.position.set(
          tw.fromX + (tw.toX - tw.fromX) * eased,
          tw.fromY + (tw.toY - tw.fromY) * eased,
          tw.fromZ + (tw.toZ - tw.fromZ) * eased
        );
      }
      if (t >= 1) tweens.splice(i, 1);
    }
  }

  function dispose() {
    if (typeof _unsub === 'function') _unsub();
    tweens.length = 0;
  }

  return { update: update, dispose: dispose };
}
