// cameraRig.test.ts — verifies that all four focus actions land the camera
// at ~80° elevation centered on the expected target.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createCameraRig } from '@/city/render/cameraRig';
import { makeCityState } from '../../_helpers/cityFixtures';
import { BuildingOrient, NodeKind, StreetAxis } from '@/types';
import type { Building, CityLayout, Street } from '@/types';
import type { CityState } from '@/city/state';

function makeStubWorld(overrides: Partial<ReturnType<typeof _baseWorld>> = {}) {
  return { ..._baseWorld(), ...overrides };
}

// The rig reads its world-framing inputs (bbox / gemWorldPos / rootStreet /
// tallestBuilding) from cityState computeds, not from deps — so seed a layout
// that produces a non-empty bbox + a root street. Two crossing 1000-long streets
// span XZ to ±500 and a 200-tall building gives the Y extent: bbox =
// (-500,0,-500)..(500,200,500). Exact magnitudes don't drive the focus
// assertions (they key off the focused node + a sub-distance clamp), only that
// framing captures at all.
function seedFramedCity(): CityState {
  const cs = makeCityState();
  cs.layout.value = {
    buildings: [{ x: 100, y: 0, w: 30, d: 30, h: 200 } as unknown as Building],
    streets: [
      { x: 0, y: 0, width: 40, length: 1000, orientation: StreetAxis.X, isRoot: true, dir: null },
      { x: 0, y: 0, width: 40, length: 1000, orientation: StreetAxis.Y, isRoot: false, dir: null },
    ] as unknown as Street[],
  } as unknown as CityLayout;
  cs.structureRevision.value++;
  return cs;
}

function _baseWorld() {
  return {
    getRepoLabelBounds: () =>
      null as {
        centerX: number;
        centerY: number;
        centerZ: number;
        halfWidth: number;
        halfHeight: number;
      } | null,
    getTreeBoundsBySha: (_sha: string) =>
      null as { x: number; y: number; z: number; height: number; radius: number } | null,
  };
}

function makeBuilding(): Building {
  return {
    x: 100,
    y: 200,
    w: 30,
    d: 30,
    h: 120,
    orient: BuildingOrient.South,
    cellId: 1,
    slotId: 0,
    file: { name: 'a', type: NodeKind.File, path: 'a', size: 0, lines: 0, extension: '.ts' },
  } as unknown as Building;
}

function makeStreet(): Street {
  return {
    x: 200,
    y: 50,
    width: 20,
    length: 600,
    orientation: StreetAxis.X,
    dir: { name: 'src', path: 'src', type: NodeKind.Directory },
  } as unknown as Street;
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.defineProperty(c, 'clientWidth', { value: 1280 });
  Object.defineProperty(c, 'clientHeight', { value: 720 });
  return c;
}

function elevationDeg(camPos: THREE.Vector3, target: THREE.Vector3): number {
  const v = camPos.clone().sub(target);
  const horiz = Math.sqrt(v.x * v.x + v.z * v.z);
  return Math.atan2(v.y, horiz) * (180 / Math.PI);
}

describe('cameraRig top-down focus', () => {
  beforeEach(() => {
    // jsdom canvas doesn't support WebGL — OrbitControls only needs the
    // DOM canvas, no WebGL context.
  });

  it('focusBuilding lands the camera at ~80° elevation centered on the building', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({ canvas, deps: makeStubWorld(), cityState: seedFramedCity() });
    rig.update(16);

    const b = makeBuilding();
    rig.focusBuilding(new THREE.Object3D(), b);
    return new Promise<void>((resolve) => {
      let frames = 0;
      function tick() {
        if (frames++ < 60) {
          requestAnimationFrame(tick);
          return;
        }
        const target = rig.controls.target;
        expect(target.x).toBeCloseTo(b.x, 1);
        expect(target.y).toBeCloseTo(b.h / 2, 1);
        expect(target.z).toBeCloseTo(b.y, 1);
        const elev = elevationDeg(rig.camera.position, target);
        expect(elev).toBeGreaterThan(75);
        expect(elev).toBeLessThan(85);
        resolve();
      }
      requestAnimationFrame(tick);
    });
  });

  it('focusStreet lands the camera at ~80° elevation centered on the street', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({ canvas, deps: makeStubWorld(), cityState: seedFramedCity() });
    rig.update(16);
    const s = makeStreet();
    rig.focusStreet(s, null);
    return new Promise<void>((resolve) => {
      let frames = 0;
      function tick() {
        if (frames++ < 60) {
          requestAnimationFrame(tick);
          return;
        }
        const target = rig.controls.target;
        expect(target.x).toBeCloseTo(s.x, 1);
        expect(target.y).toBeCloseTo(0, 1);
        expect(target.z).toBeCloseTo(s.y, 1);
        const elev = elevationDeg(rig.camera.position, target);
        expect(elev).toBeGreaterThan(75);
        expect(elev).toBeLessThan(85);
        resolve();
      }
      requestAnimationFrame(tick);
    });
  });

  it('focusTree lands the camera at ~80° elevation centered on the tree', () => {
    const canvas = makeCanvas();
    const deps = makeStubWorld({
      getTreeBoundsBySha: (sha: string) =>
        sha === 'abc' ? { x: 250, y: 0, z: -180, height: 100, radius: 30 } : null,
    });
    const rig = createCameraRig({ canvas, deps, cityState: seedFramedCity() });
    rig.update(16);
    rig.focusTree('abc');
    return new Promise<void>((resolve) => {
      let frames = 0;
      function tick() {
        if (frames++ < 60) {
          requestAnimationFrame(tick);
          return;
        }
        const target = rig.controls.target;
        expect(target.x).toBeCloseTo(250, 1);
        expect(target.y).toBeCloseTo(50, 1);
        expect(target.z).toBeCloseTo(-180, 1);
        const elev = elevationDeg(rig.camera.position, target);
        expect(elev).toBeGreaterThan(75);
        expect(elev).toBeLessThan(85);
        resolve();
      }
      requestAnimationFrame(tick);
    });
  });

  it('focusTree is a no-op when getTreeBoundsBySha returns null', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({ canvas, deps: makeStubWorld(), cityState: seedFramedCity() });
    rig.update(16);
    const beforePos = rig.camera.position.clone();
    rig.focusTree('missing-sha');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(rig.camera.position.x).toBeCloseTo(beforePos.x, 1);
        expect(rig.camera.position.y).toBeCloseTo(beforePos.y, 1);
        expect(rig.camera.position.z).toBeCloseTo(beforePos.z, 1);
        resolve();
      }, 50);
    });
  });
});

describe('cameraRig start framing', () => {
  // Issue #62: the label's width (from the text aspect, which settles on web-font
  // load) must not affect framing — only its top-edge height. A tall label drives
  // heightDist; widening it 100× must not move the camera.
  function labelDeps(halfWidth: number) {
    return makeStubWorld({
      getRepoLabelBounds: () => ({
        centerX: 0,
        centerY: 400,
        centerZ: 0,
        halfWidth,
        halfHeight: 50,
      }),
    });
  }

  it('ignores repo-label width (only its top-edge height matters)', () => {
    const narrow = createCameraRig({
      canvas: makeCanvas(),
      deps: labelDeps(40),
      cityState: seedFramedCity(),
    });
    narrow.update(16);
    const narrowPos = narrow.camera.position.clone();

    const wide = createCameraRig({
      canvas: makeCanvas(),
      deps: labelDeps(4000),
      cityState: seedFramedCity(),
    });
    wide.update(16);
    const widePos = wide.camera.position.clone();

    expect(widePos.distanceTo(narrowPos)).toBeLessThan(0.001);
  });
});
