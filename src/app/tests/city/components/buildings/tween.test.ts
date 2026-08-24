// createBuildingTweens owns the enter animation queue: one entry per building
// that appeared in the last diff, retired when its duration elapses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

import { createBuildingTweens } from '@/city/components/buildings/tween';
import { BUILDINGS } from '@/state/settings/fields/buildings';
import type { Building, EnteringBuilding, StayingBuilding } from '@/types';
import { building } from '../../../_helpers/buildingFixture';

const _origBuildings = BUILDINGS.value;
const TRANSITION_MS = 400;

let _now = 0;

function setNow(ms: number): void {
  _now = ms;
}

function makeMesh(count = 4): THREE.InstancedMesh {
  return new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), count);
}

function matrixAt(mesh: THREE.InstancedMesh, slot: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(slot, m);
  return m;
}

function entering(b: Building, slot: number, h: number): EnteringBuilding {
  return {
    building: b,
    instanceId: slot,
    newScaleX: 2,
    newScaleY: h,
    newScaleZ: 3,
    newPosX: 10,
    newPosY: h / 2,
    newPosZ: -5,
  };
}

function diffOf(opts: { entering?: EnteringBuilding[]; staying?: StayingBuilding[] }): {
  entering: { buildings: EnteringBuilding[] };
  staying: { buildings: StayingBuilding[] };
} {
  return {
    entering: { buildings: opts.entering ?? [] },
    staying: { buildings: opts.staying ?? [] },
  };
}

describe('createBuildingTweens()', () => {
  beforeEach(() => {
    BUILDINGS.value = { ..._origBuildings, BUILDING_TRANSITION_MS: TRANSITION_MS };
    setNow(0);
    vi.spyOn(performance, 'now').mockImplementation(() => _now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    BUILDINGS.value = { ..._origBuildings };
  });

  it('entering diff: first update writes the grow-in start (scaleY≈0.0001, posY 0); final transform lands at the duration and the tween is removed', () => {
    const b = building({ cellId: 1, slotId: 0 });
    const mesh = makeMesh();
    const tweens = createBuildingTweens({ getMeshForBuilding: () => ({ mesh, slot: 0 }) });

    tweens.onDiff(diffOf({ entering: [entering(b, 0, 8)] }));

    // t = 0 — start of the grow-in: near-zero scaleY, posY grounded at 0.
    tweens.update(0);
    let m = matrixAt(mesh, 0);
    expect(m.elements[0]).toBeCloseTo(2, 6); // scaleX is full-size throughout
    expect(m.elements[5]).toBeCloseTo(0.0001, 6);
    expect(m.elements[10]).toBeCloseTo(3, 6);
    expect(m.elements[12]).toBeCloseTo(10, 6);
    expect(m.elements[13]).toBeCloseTo(0, 6);
    expect(m.elements[14]).toBeCloseTo(-5, 6);

    // Mid-tween: scaleY strictly between start and target.
    setNow(TRANSITION_MS / 2);
    tweens.update(0);
    m = matrixAt(mesh, 0);
    expect(m.elements[5]).toBeGreaterThan(0.0001);
    expect(m.elements[5]).toBeLessThan(8);

    // t >= duration — final scale/pos land exactly; the tween is removed.
    setNow(TRANSITION_MS);
    tweens.update(0);
    m = matrixAt(mesh, 0);
    expect(m.elements[5]).toBeCloseTo(8, 6);
    expect(m.elements[13]).toBeCloseTo(4, 6);

    // Queue is empty now: a later update writes nothing (version is stable).
    const versionAfterLanding = mesh.instanceMatrix.version;
    setNow(TRANSITION_MS * 2);
    tweens.update(0);
    expect(mesh.instanceMatrix.version).toBe(versionAfterLanding);
  });

  it('staying diff with identical old/new transform starts no tween', () => {
    const b = building({ cellId: 1, slotId: 1 });
    const mesh = makeMesh();
    const tweens = createBuildingTweens({ getMeshForBuilding: () => ({ mesh, slot: 1 }) });

    tweens.onDiff(
      diffOf({
        staying: [
          {
            building: b,
            instanceId: 1,
            newScaleX: 2,
            newScaleY: 4,
            newScaleZ: 2,
            newPosX: 0,
            newPosY: 2,
            newPosZ: 0,
            oldScaleX: 2,
            oldScaleY: 4,
            oldScaleZ: 2,
            oldPosX: 0,
            oldPosY: 2,
            oldPosZ: 0,
          },
        ],
      })
    );

    const versionBefore = mesh.instanceMatrix.version;
    tweens.update(0);
    // No tween → no matrix write, no needsUpdate flush.
    expect(mesh.instanceMatrix.version).toBe(versionBefore);
  });

  it('a second onDiff for the same Building identity supersedes targets but keeps startedAt', () => {
    const b = building({ cellId: 1, slotId: 0 });
    const mesh = makeMesh();
    const tweens = createBuildingTweens({ getMeshForBuilding: () => ({ mesh, slot: 0 }) });

    // First diff at t=0 targets h=8.
    tweens.onDiff(diffOf({ entering: [entering(b, 0, 8)] }));

    // Retargeting the same building at t=200 must not reset startedAt, or the
    // tween is only half through at TRANSITION_MS instead of complete.
    setNow(200);
    tweens.onDiff(diffOf({ entering: [entering(b, 0, 20)] }));

    setNow(TRANSITION_MS);
    tweens.update(0);
    const m = matrixAt(mesh, 0);
    expect(m.elements[5]).toBeCloseTo(20, 6); // new target landed
    expect(m.elements[13]).toBeCloseTo(10, 6);

    // And it was a supersede, not a stacked second tween: the queue is empty.
    const version = mesh.instanceMatrix.version;
    setNow(TRANSITION_MS + 100);
    tweens.update(0);
    expect(mesh.instanceMatrix.version).toBe(version);
  });

  it('drops a tween when the resolver returns null (mesh disposed between frames)', () => {
    const b = building({ cellId: 1, slotId: 0 });
    const mesh = makeMesh();
    let live = true;
    const tweens = createBuildingTweens({
      getMeshForBuilding: () => (live ? { mesh, slot: 0 } : null),
    });

    tweens.onDiff(diffOf({ entering: [entering(b, 0, 8)] }));
    live = false;
    const versionBefore = mesh.instanceMatrix.version;
    tweens.update(0); // resolver null → tween dropped, nothing written

    // Resurrecting the resolver doesn't bring the tween back — it's gone.
    live = true;
    setNow(TRANSITION_MS / 2);
    tweens.update(0);
    expect(mesh.instanceMatrix.version).toBe(versionBefore);
  });

  it('flushes instanceMatrix.needsUpdate once per mesh for two tweens on the same mesh', () => {
    const b0 = building({ cellId: 1, slotId: 0, file: { ...building().file, path: 'a.ts' } });
    const b1 = building({ cellId: 1, slotId: 1, file: { ...building().file, path: 'b.ts' } });
    const mesh = makeMesh();
    const tweens = createBuildingTweens({
      getMeshForBuilding: (b) => ({ mesh, slot: b === b0 ? 0 : 1 }),
    });

    tweens.onDiff(diffOf({ entering: [entering(b0, 0, 8), entering(b1, 1, 12)] }));

    // BufferAttribute.needsUpdate = true bumps .version by 1 per assignment —
    // so "once per dirty mesh" is observable as exactly +1 across both tweens.
    const versionBefore = mesh.instanceMatrix.version;
    tweens.update(0);
    expect(mesh.instanceMatrix.version).toBe(versionBefore + 1);
  });

  it('clear() empties the queue', () => {
    const b = building({ cellId: 1, slotId: 0 });
    const mesh = makeMesh();
    const tweens = createBuildingTweens({ getMeshForBuilding: () => ({ mesh, slot: 0 }) });

    tweens.onDiff(diffOf({ entering: [entering(b, 0, 8)] }));
    tweens.clear();

    const versionBefore = mesh.instanceMatrix.version;
    tweens.update(0);
    expect(mesh.instanceMatrix.version).toBe(versionBefore);
  });
});
