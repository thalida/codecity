// cameraRig.test.ts — verifies that all four focus actions land the camera
// at ~80° elevation centered on the expected target.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createCameraRig, type CameraRig } from '@/city/render/cameraRig';
import { makeCityState } from '../../_helpers/cityFixtures';
import { BuildingOrient, NodeKind, StreetAxis } from '@/types';
import type { Building, CityLayout, Street } from '@/types';
import type { CityState } from '@/city/state';
import { SHOWCASE } from '@/state/stores/settings/showcase';
import { getDefault } from '@/state/persist';

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
// The showcase tests do care: X/Z street lengths drive the island's two
// half-extents apart, and the orbit radius clamps to the shorter one.
function seedFramedCity({ xLength = 1000, zLength = 1000 } = {}): CityState {
  const cs = makeCityState();
  cs.layout.value = {
    buildings: [{ x: 100, y: 0, w: 30, d: 30, h: 200 } as unknown as Building],
    streets: [
      {
        x: 0,
        y: 0,
        width: 40,
        length: xLength,
        orientation: StreetAxis.X,
        isRoot: true,
        dir: null,
      },
      {
        x: 0,
        y: 0,
        width: 40,
        length: zLength,
        orientation: StreetAxis.Y,
        isRoot: false,
        dir: null,
      },
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

describe('cameraRig showcase orbit', () => {
  // Every rig registers effects on the SHOWCASE store, so a leaked one would
  // keep answering the next test's slider writes.
  const rigs: CameraRig[] = [];
  function makeRig(cityState: CityState): CameraRig {
    const rig = createCameraRig({ canvas: makeCanvas(), deps: makeStubWorld(), cityState });
    rigs.push(rig);
    return rig;
  }

  beforeEach(() => {
    SHOWCASE.value = { ...getDefault(SHOWCASE) };
  });
  afterEach(() => {
    while (rigs.length) rigs.pop()?.dispose();
    SHOWCASE.value = { ...getDefault(SHOWCASE) };
  });

  it('circles the gem at the configured elevation and radius', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    const gem = cs.gemWorldPos.value as THREE.Vector3;
    SHOWCASE.value = { ...SHOWCASE.value, ELEVATION: 12, DISTANCE: 900 };

    rig.enterShowcase({ autoRotate: false });

    // The pivot is the gem itself (ground level), not a point up the skyline.
    expect(rig.controls.target.distanceTo(gem)).toBeCloseTo(0, 5);
    expect(rig.camera.position.distanceTo(gem)).toBeCloseTo(900, 3);
    expect(elevationDeg(rig.camera.position, gem)).toBeCloseTo(12, 3);
  });

  it("pulls the radius in to the island's shorter half-extent", () => {
    // 448 wide × 8048 deep: the orbit has to clamp to the width, not the depth.
    const cs = seedFramedCity({ xLength: 400, zLength: 8000 });
    const rig = makeRig(cs);
    const gem = cs.gemWorldPos.value as THREE.Vector3;
    const bounds = cs.latestWorldBounds.value as { halfWidth: number; halfDepth: number };
    const islandRadius = Math.min(bounds.halfWidth, bounds.halfDepth);
    // The fixture has to actually reach the clamp, or the assertion below is vacuous.
    expect(islandRadius).toBeLessThan(SHOWCASE.value.DISTANCE);
    expect(bounds.halfDepth).toBeGreaterThan(SHOWCASE.value.DISTANCE);

    rig.enterShowcase({ autoRotate: false });

    expect(rig.camera.position.distanceTo(gem)).toBeCloseTo(islandRadius, 3);
  });

  it('re-frames live when a pose slider is dragged mid-showcase', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    const gem = cs.gemWorldPos.value as THREE.Vector3;
    rig.enterShowcase({ autoRotate: false });

    SHOWCASE.value = { ...SHOWCASE.value, ELEVATION: 45, DISTANCE: 1200 };

    expect(elevationDeg(rig.camera.position, gem)).toBeCloseTo(45, 3);
    expect(rig.camera.position.distanceTo(gem)).toBeCloseTo(1200, 3);
  });

  it('leaves the camera alone when a slider moves outside the showcase', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    rig.update(16); // boot framing, the pose the user is actually sitting at
    const beforeEnter = rig.camera.position.clone();

    SHOWCASE.value = { ...SHOWCASE.value, ELEVATION: 45, DISTANCE: 1200 };
    expect(rig.camera.position.distanceTo(beforeEnter)).toBeLessThan(1e-6);

    // …and again once the showcase has been exited.
    rig.enterShowcase({ autoRotate: true });
    rig.exitShowcase();
    expect(rig.controls.autoRotate).toBe(false);
    const afterExit = rig.camera.position.clone();

    SHOWCASE.value = { ...SHOWCASE.value, ELEVATION: 70, DISTANCE: 400 };
    expect(rig.camera.position.distanceTo(afterExit)).toBeLessThan(1e-6);
  });

  it('applies rotation speed without yanking the orbit back to its start', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    rig.enterShowcase({ autoRotate: true });
    // Stand in for the orbit having spun on from where it entered.
    rig.camera.position.set(0, 100, 500);
    const spun = rig.camera.position.clone();

    SHOWCASE.value = { ...SHOWCASE.value, ROTATE_SPEED: 2.5 };

    expect(rig.controls.autoRotateSpeed).toBe(2.5);
    expect(rig.controls.autoRotate).toBe(true);
    expect(rig.camera.position.distanceTo(spun)).toBeLessThan(1e-6);
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
