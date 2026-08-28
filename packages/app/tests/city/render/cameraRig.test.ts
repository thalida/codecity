// cameraRig.test.ts — verifies that focusSelection lands the camera at ~80°
// elevation centered on each kind of target, and that its other mode centres
// the same targets without moving the camera off its angle.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createCameraRig, FocusMode, type CameraRig } from '@/city/render/cameraRig';
import { BACKDROP_CAMERA, CameraTarget } from '@/city/settings/fields/camera';
import { commitTarget, makeCityState } from '../../_helpers/cityFixtures';
import type { CityState } from '@/city/state';
import { Building, BuildingOrient } from '@/city/types/building';
import { NodeKind } from '@/city/types/manifest';
import { CityLayout } from '@/city/types/scene';
import { Street, StreetAxis } from '@/city/types/street';
import { PickTarget } from '@/city/types/picker';
import { settingsStore } from '../../_helpers/citySettings';

// Rebuilt per case, so a tweak in one cannot leak into the next — including
// across describes, which is an order dependence and not a test.
let SETTINGS = settingsStore();
beforeEach(() => {
  SETTINGS = settingsStore();
});

function makeStubWorld(overrides: Partial<ReturnType<typeof _baseWorld>> = {}) {
  return { ..._baseWorld(), ...overrides };
}

// The rig frames off cityState, so seed a real bbox and root street.
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

// The rig takes a resolved PickTarget, the same shape the picker hands it. No
// casts: a drift in that shape has to fail the typecheck, not slip through.
function fileTarget(b: Building): PickTarget {
  return { kind: NodeKind.File, mesh: new THREE.Mesh(), data: b, file: b.file, instanceId: 0 };
}

function dirTarget(s: Street): PickTarget {
  return { kind: NodeKind.Directory, sidewalk: new THREE.Mesh(), street: s, dir: s.dir! };
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

  it('a file target lands the camera at ~80° elevation centered on the building', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({
      canvas,
      deps: makeStubWorld(),
      cityState: seedFramedCity(),
      settings: SETTINGS,
    });
    rig.update(16);

    const b = makeBuilding();
    rig.focusSelection(fileTarget(b));
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

  it('a directory target lands the camera at ~80° elevation centered on the street', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({
      canvas,
      deps: makeStubWorld(),
      cityState: seedFramedCity(),
      settings: SETTINGS,
    });
    rig.update(16);
    const s = makeStreet();
    rig.focusSelection(dirTarget(s));
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

  it('a commit target lands the camera at ~80° elevation centered on the tree', () => {
    const canvas = makeCanvas();
    const deps = makeStubWorld({
      getTreeBoundsBySha: (sha: string) =>
        sha === 'abc' ? { x: 250, y: 0, z: -180, height: 100, radius: 30 } : null,
    });
    const rig = createCameraRig({
      canvas,
      deps,
      cityState: seedFramedCity(),
      settings: SETTINGS,
    });
    rig.update(16);
    rig.focusSelection(commitTarget('abc'));
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

  it('a commit whose tree was never placed leaves the camera alone', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({
      canvas,
      deps: makeStubWorld(),
      cityState: seedFramedCity(),
      settings: SETTINGS,
    });
    rig.update(16);
    const beforePos = rig.camera.position.clone();
    rig.focusSelection(commitTarget('missing-sha'));
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

describe('cameraRig recenter focus', () => {
  it('centres the building with the camera angle and distance untouched', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({
      canvas,
      deps: makeStubWorld(),
      cityState: seedFramedCity(),
      settings: SETTINGS,
    });
    rig.update(16); // the opening framing, i.e. the pose a load rests at

    const before = rig.camera.position.clone().sub(rig.controls.target);
    const b = makeBuilding();
    rig.focusSelection(fileTarget(b), FocusMode.Recenter);

    // Snapped, not tweened: the pose is right on the frame the restore lands.
    const target = rig.controls.target;
    expect(target.x).toBeCloseTo(b.x, 2);
    expect(target.y).toBeCloseTo(b.h / 2, 2);
    expect(target.z).toBeCloseTo(b.y, 2);
    // Same offset from the pivot means same elevation, same azimuth, same zoom.
    const after = rig.camera.position.clone().sub(target);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
    expect(after.z).toBeCloseTo(before.z, 2);
  });

  it('centres the street the same way', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({
      canvas,
      deps: makeStubWorld(),
      cityState: seedFramedCity(),
      settings: SETTINGS,
    });
    rig.update(16);

    const before = rig.camera.position.clone().sub(rig.controls.target);
    const s = makeStreet();
    rig.focusSelection(dirTarget(s), FocusMode.Recenter);

    const target = rig.controls.target;
    expect(target.x).toBeCloseTo(s.x, 2);
    expect(target.y).toBeCloseTo(0, 2);
    expect(target.z).toBeCloseTo(s.y, 2);
    const after = rig.camera.position.clone().sub(target);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
    expect(after.z).toBeCloseTo(before.z, 2);
  });

  // A URL restore lands between the manifest apply and the first rendered
  // frame, so the one-shot opening framing is still pending when it runs.
  it('survives the first-frame framing when it lands before it', () => {
    const canvas = makeCanvas();
    const rig = createCameraRig({
      canvas,
      deps: makeStubWorld(),
      cityState: seedFramedCity(),
      settings: SETTINGS,
    });

    const b = makeBuilding();
    rig.focusSelection(fileTarget(b), FocusMode.Recenter);
    const centred = rig.camera.position.clone();
    rig.update(16);

    expect(rig.controls.target.x).toBeCloseTo(b.x, 2);
    expect(rig.controls.target.y).toBeCloseTo(b.h / 2, 2);
    expect(rig.controls.target.z).toBeCloseTo(b.y, 2);
    expect(rig.camera.position.x).toBeCloseTo(centred.x, 2);
    expect(rig.camera.position.z).toBeCloseTo(centred.z, 2);
  });
});

describe('cameraRig gem orbit', () => {
  // Every rig registers effects on the CAMERA store, so a leaked one would keep
  // answering the next test's slider writes.
  const rigs: CameraRig[] = [];
  function makeRig(cityState: CityState): CameraRig {
    const rig = createCameraRig({
      canvas: makeCanvas(),
      deps: makeStubWorld(),
      cityState,
      settings: SETTINGS,
    });
    rigs.push(rig);
    return rig;
  }

  beforeEach(() => {
    // A camera framing the gem: what the landing's wallpaper opens with.
    SETTINGS.update({ CAMERA: BACKDROP_CAMERA });
  });
  afterEach(() => {
    while (rigs.length) rigs.pop()?.dispose();
  });

  it('circles the gem at the configured elevation, part way out', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    const gem = cs.gemWorldPos.value as THREE.Vector3;
    const at = (t: number): number => {
      SETTINGS.update({ CAMERA: { ELEVATION: 12, DISTANCE_SCALE: t } });
      return rig.camera.position.distanceTo(gem);
    };

    // Linear in the slider: halfway between two stops is halfway along. Read
    // above 1, where neither the near floor nor the far cap is in play.
    const one = at(1);
    const two = at(2);
    expect(at(1.5)).toBeCloseTo((one + two) / 2, 3);
    // The pivot is the gem itself (ground level), not a point up the skyline.
    expect(rig.controls.target.distanceTo(gem)).toBeCloseTo(0, 5);
    expect(elevationDeg(rig.camera.position, gem)).toBeCloseTo(12, 3);
  });

  // The property the slider has to have: one value means one framing, on any
  // project. Against the city's extent, 0.1 varied by an order of magnitude.
  it('puts a value at the same distance whatever the city sprawls to', () => {
    const at = (cs: CityState, t: number): number => {
      const rig = makeRig(cs);
      SETTINGS.update({ CAMERA: { DISTANCE_SCALE: t } });
      return rig.camera.position.distanceTo(cs.gemWorldPos.value as THREE.Vector3);
    };
    // Same root street, wildly different sprawl: 20x the depth behind the gem.
    const compact = seedFramedCity({ xLength: 400, zLength: 400 });
    const sprawling = seedFramedCity({ xLength: 400, zLength: 8000 });

    expect(at(sprawling, 0.5)).toBeCloseTo(at(compact, 0.5), 3);
    expect(at(sprawling, 0.1)).toBeCloseTo(at(compact, 0.1), 3);
  });

  it('is as close as the camera may ever sit at 0', () => {
    const cs = seedFramedCity({ xLength: 400, zLength: 8000 });
    const rig = makeRig(cs);
    SETTINGS.update({ CAMERA: { DISTANCE_SCALE: 0 } });

    const gem = cs.gemWorldPos.value as THREE.Vector3;
    expect(rig.camera.position.distanceTo(gem)).toBeCloseTo(rig.controls.minDistance, 6);
  });

  // Past 1 pulls back beyond the city, but no further than a hand-driven camera
  // could: the world's own zoom-out limit still holds.
  it('goes past the city, and no further than the world allows', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    const gem = cs.gemWorldPos.value as THREE.Vector3;

    SETTINGS.update({ CAMERA: { DISTANCE_SCALE: 1 } });
    const framed = rig.camera.position.distanceTo(gem);

    SETTINGS.update({ CAMERA: { DISTANCE_SCALE: 2 } });
    const pulledBack = rig.camera.position.distanceTo(gem);

    expect(pulledBack).toBeGreaterThan(framed);
    expect(pulledBack).toBeLessThanOrEqual(rig.controls.maxDistance + 1e-6);
  });

  // The bug TARGET exists to kill: a pose snapped in before the first frame
  // used to be overwritten by the still-pending opening framing a tick later.
  it('opens on the orbit, and every re-frame keeps it there', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    SETTINGS.update({ CAMERA: { ELEVATION: 8, AZIMUTH: 120, DISTANCE_SCALE: 1.6 } });
    const rig = makeRig(cs);
    const gem = cs.gemWorldPos.value as THREE.Vector3;
    // Held still, so anything that moves across a frame is a framing, not the orbit.
    rig.setAutoRotate(false);
    const placed = rig.camera.position.clone();

    rig.update(16);
    expect(rig.camera.position.distanceTo(placed)).toBeLessThan(1e-6);

    // What the composer calls when the backdrop swaps one city for the next.
    rig.reset();
    expect(rig.camera.position.distanceTo(placed)).toBeLessThan(1e-6);
    expect(elevationDeg(rig.camera.position, gem)).toBeCloseTo(8, 3);
  });

  it('re-frames live when a pose slider is dragged mid-orbit', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    const gem = cs.gemWorldPos.value as THREE.Vector3;

    const before = rig.camera.position.distanceTo(gem);
    SETTINGS.update({ CAMERA: { ELEVATION: 45, DISTANCE_SCALE: 0.25 } });

    expect(elevationDeg(rig.camera.position, gem)).toBeCloseTo(45, 3);
    expect(rig.camera.position.distanceTo(gem)).toBeLessThan(before);
  });

  // Two cities on one page hold two cameras, so a wallpaper slider must not
  // reach the project the reader is looking at. Same fields, separate values.
  it('leaves the other city alone when this one is re-framed', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const scene = settingsStore();
    const sceneRig = createCameraRig({
      canvas: makeCanvas(),
      deps: makeStubWorld(),
      cityState: cs,
      settings: scene,
    });
    rigs.push(sceneRig);
    sceneRig.update(16); // the opening framing, where the reader is sitting
    const opened = sceneRig.camera.position.clone();

    // The wallpaper's own camera, dragged the whole way across its range.
    SETTINGS.update({ CAMERA: { ELEVATION: 70, AZIMUTH: -120, DISTANCE_SCALE: 0.4 } });

    expect(sceneRig.camera.position.distanceTo(opened)).toBeLessThan(1e-6);
    expect(sceneRig.controls.autoRotate).toBe(false);
  });

  it('frames the whole city, not the gem, when TARGET says so', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    const gem = cs.gemWorldPos.value as THREE.Vector3;
    const orbiting = rig.camera.position.distanceTo(gem);

    SETTINGS.update({ CAMERA: { TARGET: CameraTarget.City } });

    // The city fits itself: DISTANCE_SCALE stops applying, so the camera moves.
    expect(rig.camera.position.distanceTo(gem)).not.toBeCloseTo(orbiting, 3);
    const framed = rig.camera.position.clone();
    SETTINGS.update({ CAMERA: { DISTANCE_SCALE: 2 } });
    expect(rig.camera.position.distanceTo(framed)).toBeLessThan(1e-6);
  });

  it('AUTO_ROTATE off holds the view still, and back on turns it again', () => {
    const rig = makeRig(seedFramedCity({ xLength: 6000, zLength: 6000 }));
    expect(rig.controls.autoRotate).toBe(true);

    SETTINGS.update({ CAMERA: { AUTO_ROTATE: false } });
    expect(rig.controls.autoRotate).toBe(false);

    SETTINGS.update({ CAMERA: { AUTO_ROTATE: true } });
    expect(rig.controls.autoRotate).toBe(true);
  });

  it('applies rotation speed without yanking the orbit back to its start', () => {
    const cs = seedFramedCity({ xLength: 6000, zLength: 6000 });
    const rig = makeRig(cs);
    expect(rig.controls.autoRotate).toBe(true);
    // Stand in for the orbit having spun on from where it opened.
    rig.camera.position.set(0, 100, 500);
    const spun = rig.camera.position.clone();

    SETTINGS.update({ CAMERA: { ROTATE_SPEED: 2.5 } });

    expect(rig.controls.autoRotateSpeed).toBe(2.5);
    expect(rig.controls.autoRotate).toBe(true);
    expect(rig.camera.position.distanceTo(spun)).toBeLessThan(1e-6);
  });
});

describe('cameraRig start framing', () => {
  // Issue #62: only the label's top-edge height may affect framing, never its
  // width, which settles on web-font load.
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
      settings: SETTINGS,
      canvas: makeCanvas(),
      deps: labelDeps(40),
      cityState: seedFramedCity(),
    });
    narrow.update(16);
    const narrowPos = narrow.camera.position.clone();

    const wide = createCameraRig({
      settings: SETTINGS,
      canvas: makeCanvas(),
      deps: labelDeps(4000),
      cityState: seedFramedCity(),
    });
    wide.update(16);
    const widePos = wide.camera.position.clone();

    expect(widePos.distanceTo(narrowPos)).toBeLessThan(0.001);
  });
});
