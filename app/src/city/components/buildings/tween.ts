// city/components/buildings/tween.ts — the queue that grows a new building in
// and slides a moved one across. Nothing animates out: the rebuild drops the old
// instances before the diff arrives. It writes instance matrices and nothing
// else, and the fader writes iFade, so the two can't conflict by construction.

import * as THREE from 'three';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import type { Building, EnteringBuilding, StayingBuilding } from '@/types';

/** Narrow resolver surface the tween queue needs from the buildings
 *  component (re-resolved per frame so tweens survive rebuilds). */
export interface TweenDeps {
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
}

interface Tween {
  /** The Building object carrying cellId + slotId. */
  building: Building;
  // Tween endpoints (written by onDiff/_addOrUpdate, read by update()).
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

// One duration for both, read fresh per diff so a Settings tweak applies to
// the next rebuild without a restart.

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function createBuildingTweens(deps: TweenDeps) {
  // Keyed by Building identity, so a fresh tween supersedes an in-flight one
  // on the same building rather than stacking with it.
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

  // Structural, not the imported type: this stays independent of the door it
  // is called from.
  function onDiff(diff: {
    entering: { buildings: EnteringBuilding[] };
    staying: { buildings: StayingBuilding[] };
  }): void {
    // Once per diff, so a burst shares one duration and the next picks up a
    // Settings change.
    const transitionMs = BUILDINGS.value.BUILDING_TRANSITION_MS;
    // Entering: grow in from near-zero scale. Y position starts at ~0
    // and rises to the final center (h/2) so the base stays grounded.
    for (const e of diff.entering.buildings) {
      const { building, newScaleX, newScaleY, newScaleZ, newPosX, newPosY, newPosZ } = e;
      if (!building) continue;
      _addOrUpdate({
        building,
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

  // Reusable scratch — allocated once, reused every frame to avoid per-tween GC.
  const _tmpMatrix = new THREE.Matrix4();
  const _TWEEN_QUAT = new THREE.Quaternion();
  const _tmpPos = new THREE.Vector3();
  const _tmpScale = new THREE.Vector3();

  // A building that MOVED tweens across the gap between its old cell and its
  // new one, so it renders outside both spheres until it lands.
  const unculled = new Set<THREE.InstancedMesh>();

  function restoreCulling(mesh: THREE.InstancedMesh): void {
    mesh.frustumCulled = true;
    unculled.delete(mesh);
  }

  function update(_dtMs: number): void {
    if (tweens.length === 0) {
      for (const mesh of [...unculled]) restoreCulling(mesh);
      return;
    }
    const now = performance.now();
    // Flagged once per mesh after all its tweens, not once per tween, or the
    // same buffer re-uploads several times a frame.
    const dirtyMeshes = new Set<THREE.InstancedMesh>();

    // Iterate backwards so we can splice completed tweens cheaply.
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];

      // Resolve the target mesh via getMeshForBuilding(), which routes via
      // building.cellId/slotId.
      const resolved = deps.getMeshForBuilding(tw.building);
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

      // Bake the age-lean shear so a growing-in building leans like a built one
      // (the shear scales with the animated height, so the lean grows in too).
      _tmpPos.set(px, py, pz);
      _tmpScale.set(sx, sy, sz);
      _tmpMatrix.compose(_tmpPos, _TWEEN_QUAT, _tmpScale);
      targetMesh.setMatrixAt(slot, _tmpMatrix);
      dirtyMeshes.add(targetMesh);

      if (t >= 1) tweens.splice(i, 1);
    }

    // Flush: one needsUpdate per dirty mesh, not per tween.
    for (const mesh of dirtyMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (!unculled.has(mesh)) {
        mesh.frustumCulled = false;
        unculled.add(mesh);
      }
    }
    // Nothing moved it this frame, so it is back inside its cell.
    for (const mesh of [...unculled]) {
      if (!dirtyMeshes.has(mesh)) restoreCulling(mesh);
    }
  }

  function clear() {
    tweens.length = 0;
    for (const mesh of [...unculled]) restoreCulling(mesh);
  }

  return { onDiff, update, clear };
}
