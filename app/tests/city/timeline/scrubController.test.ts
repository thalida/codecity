import * as THREE from 'three';
import { beforeEach, expect, test } from 'vitest';

import { buildPathTimelines } from '@/city/timeline/replay';
import { createScrubController, RUIN_FLOOR } from '@/city/timeline/scrubController';
import { buildingHeightForLines } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import { SCRUB_POS } from '@/state/stores/timeline';
import { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { InstancedAdPanels } from '@/city/components/buildings/adPanels';
import type { Building, FileNode, Street, TimelineBundle } from '@/types';

// f.txt: absent at commit 0, created at 1 (2 lines), grows at 2 (6 lines),
// deleted at 3. So createdIdx=1, deletedIdx=3, union lines=6.
const bundle = {
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
  unionManifest: { tree: { name: 'r' } },
  deltas: [
    { sha: 'a', changes: [] },
    { sha: 'b', changes: [{ path: 'f.txt', sha: 's1' }] },
    { sha: 'c', changes: [{ path: 'f.txt', sha: 's2' }] },
    { sha: 'd', changes: [{ path: 'f.txt', sha: null }] },
  ],
  blobLines: { s1: 2, s2: 6 },
  note: null,
} as unknown as TimelineBundle;

const heightCtx: HeightContext = {
  lineStats: { min: 1, max: 200 },
  byteStats: { min: 1, max: 5000 },
};

const file = { path: 'f.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;

// Most tests don't assert on footprint opacity; this stub keeps their deps minimal.
const noopFootprints = {
  setBuildingFootprintOpacity: () => {},
  setStreetFootprintOpacity: () => {},
};

function makeFakeFootprints() {
  const buildingOpacity = new Map<string, number>();
  const streetOpacity = new Map<string, number>();
  return {
    footprints: {
      setBuildingFootprintOpacity: (path: string, opacity: number) => {
        buildingOpacity.set(path, opacity);
      },
      setStreetFootprintOpacity: (dirPath: string, opacity: number) => {
        streetOpacity.set(dirPath, opacity);
      },
    },
    buildingOpacity,
    streetOpacity,
  };
}

function makeFakeMesh() {
  const lastMatrix = new THREE.Matrix4();
  let iFadeX = 1;
  let iFadeY = 0;
  let iFadeZ = 0;
  let iFadeUpdates = 0;
  let matUpdates = 0;

  const iFade = {
    getY: () => iFadeY,
    getZ: () => iFadeZ,
    setXYZ: (_slot: number, x: number, y: number, z: number) => {
      iFadeX = x;
      iFadeY = y;
      iFadeZ = z;
    },
    set needsUpdate(v: boolean) {
      if (v) iFadeUpdates++;
    },
    get needsUpdate() {
      return false;
    },
  };

  const mesh = {
    setMatrixAt: (_slot: number, m: THREE.Matrix4) => {
      lastMatrix.copy(m);
    },
    instanceMatrix: {
      set needsUpdate(v: boolean) {
        if (v) matUpdates++;
      },
      get needsUpdate() {
        return false;
      },
    },
    geometry: {
      getAttribute: (n: string) => (n === 'iFade' ? iFade : undefined),
    },
  } as unknown as THREE.InstancedMesh;

  return {
    mesh,
    get scaleY() {
      return lastMatrix.elements[5];
    },
    get posY() {
      return lastMatrix.elements[13];
    },
    get iFadeX() {
      return iFadeX;
    },
    get iFadeY() {
      return iFadeY;
    },
    get matUpdates() {
      return matUpdates;
    },
    get iFadeUpdates() {
      return iFadeUpdates;
    },
  };
}

function makeFakeAdPanels() {
  let calls = 0;
  let lastGetFade: ((path: string) => number | null | undefined) | null = null;
  const adPanels = {
    applyBuildingFades: (getFade: (path: string) => number | null | undefined) => {
      calls++;
      lastGetFade = getFade;
    },
  } as unknown as InstancedAdPanels;
  return {
    adPanels,
    get calls() {
      return calls;
    },
    get lastGetFade() {
      return lastGetFade;
    },
  };
}

function setup(getAdPanels: () => InstancedAdPanels | null = () => null) {
  const b = {
    x: 5,
    y: 7,
    w: 2,
    d: 2,
    h: buildingHeightForLines(file, 6, heightCtx),
    color: '#fff',
    file,
    cellId: 0,
    slotId: 0,
  } as unknown as Building;

  const index = new BuildingIndex();
  index.insert(b);

  const fake = makeFakeMesh();
  const timelines = buildPathTimelines(bundle);

  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels,
    getMeshForBuilding: () => ({ mesh: fake.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets: { setStreetOpacity: () => {} },
    streetsByDir: {},
  });

  return { b, fake, controller, timelines };
}

beforeEach(() => {
  SCRUB_POS.value = 0;
});

test('scaleY reflects the interpolated height at the scrub position', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 1.5;
  controller.update();

  const expected = buildingHeightForLines(file, 4, heightCtx); // lines lerp 2→6 at pos 1.5
  expect(fake.scaleY).toBeCloseTo(expected, 5);
  expect(fake.posY).toBeCloseTo(expected / 2, 5);
});

test('at HEAD the height factor is ~1 (matches the union baseline)', () => {
  const { b, fake, controller } = setup();
  SCRUB_POS.value = 2; // last live commit index, 6 lines
  controller.update();
  expect(fake.scaleY).toBeCloseTo(b.h, 5);
});

test('before its creation the building is flat and fully transparent', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 0.5; // before createdIdx = 1
  controller.update();
  expect(fake.scaleY).toBe(0);
  expect(fake.iFadeX).toBeCloseTo(0, 5);
});

test('after deletion opacity drops to RUIN_FLOOR and the body flattens', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 3; // deletedIdx
  controller.update();
  expect(fake.scaleY).toBe(0);
  expect(fake.iFadeX).toBe(RUIN_FLOOR);
});

test('ad panels fade in lockstep with a present building body', () => {
  const fakeAdPanels = makeFakeAdPanels();
  const { b, controller } = setup(() => fakeAdPanels.adPanels);
  SCRUB_POS.value = 1.5;
  controller.update();
  expect(fakeAdPanels.calls).toBe(1);
  expect(fakeAdPanels.lastGetFade!(b.file.path)).toBeCloseTo(1, 5);
});

test('ad panels fade to RUIN_FLOOR once the building is deleted', () => {
  const fakeAdPanels = makeFakeAdPanels();
  const { b, controller } = setup(() => fakeAdPanels.adPanels);
  SCRUB_POS.value = 3; // deletedIdx
  controller.update();
  expect(fakeAdPanels.lastGetFade!(b.file.path)).toBe(RUIN_FLOOR);
});

test('preserves the silhouette/outline iFade channels', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 2;
  controller.update();
  expect(fake.iFadeY).toBe(0);
});

test('sets needsUpdate exactly once per mesh and per iFade attribute', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 1.5;
  controller.update();
  expect(fake.matUpdates).toBe(1);
  expect(fake.iFadeUpdates).toBe(1);
});

test('a present media/0-line file gets a non-zero scaleY; an absent one stays flat', () => {
  // m.png: present the whole window, but blobLines is 0 throughout (a media file
  // carries 0 code lines). getBuildingDimensions clamps lines->MIN_FLOORS, so the
  // regression this guards is `lines > 0` gating scaleY to 0 despite presence.
  const mediaBundle = {
    commits: [{ sha: 'a' }, { sha: 'b' }],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      { sha: 'a', changes: [{ path: 'm.png', sha: 's0' }] },
      { sha: 'b', changes: [{ path: 'm.png', sha: 's0' }] },
    ],
    blobLines: { s0: 0 },
    note: null,
  } as unknown as TimelineBundle;

  const mediaFile = {
    path: 'm.png',
    lines: 0,
    size: 5000,
    extension: 'png',
  } as unknown as FileNode;
  const b = {
    x: 1,
    y: 1,
    w: 2,
    d: 2,
    h: buildingHeightForLines(mediaFile, 0, heightCtx),
    color: '#fff',
    file: mediaFile,
    cellId: 0,
    slotId: 0,
  } as unknown as Building;

  const index = new BuildingIndex();
  index.insert(b);
  const fake = makeFakeMesh();
  const timelines = buildPathTimelines(mediaBundle);

  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: () => ({ mesh: fake.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets: { setStreetOpacity: () => {} },
    streetsByDir: {},
  });

  SCRUB_POS.value = 1;
  controller.update();
  expect(fake.scaleY).toBeGreaterThan(0);
  expect(fake.iFadeX).toBeCloseTo(1, 5);
});

test('an absent building (never present) stays flat at scaleY 0', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = -1; // strictly before f.txt's creation
  controller.update();
  expect(fake.scaleY).toBe(0);
});

test('dedup: two buildings sharing one InstancedMesh set needsUpdate exactly once', () => {
  // f2.txt mirrors f.txt's timeline shape under a second path, so both buildings
  // resolve to the same (shared) fake mesh at different slots.
  const twoPathBundle = {
    commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      { sha: 'a', changes: [] },
      {
        sha: 'b',
        changes: [
          { path: 'f.txt', sha: 's1' },
          { path: 'f2.txt', sha: 's1' },
        ],
      },
      {
        sha: 'c',
        changes: [
          { path: 'f.txt', sha: 's2' },
          { path: 'f2.txt', sha: 's2' },
        ],
      },
      {
        sha: 'd',
        changes: [
          { path: 'f.txt', sha: null },
          { path: 'f2.txt', sha: null },
        ],
      },
    ],
    blobLines: { s1: 2, s2: 6 },
    note: null,
  } as unknown as TimelineBundle;

  const file2 = { path: 'f2.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;
  const b1 = {
    x: 5,
    y: 7,
    w: 2,
    d: 2,
    h: buildingHeightForLines(file, 6, heightCtx),
    color: '#fff',
    file,
    cellId: 0,
    slotId: 0,
  } as unknown as Building;
  const b2 = {
    x: 8,
    y: 9,
    w: 2,
    d: 2,
    h: buildingHeightForLines(file2, 6, heightCtx),
    color: '#fff',
    file: file2,
    cellId: 0,
    slotId: 1,
  } as unknown as Building;

  const index = new BuildingIndex();
  index.insert(b1);
  index.insert(b2);

  const slotMatrices = new Map<number, THREE.Matrix4>();
  const slotFadeX = new Map<number, number>();
  let matUpdates = 0;
  let iFadeUpdates = 0;

  const iFade = {
    getY: () => 0,
    getZ: () => 0,
    setXYZ: (slot: number, x: number) => {
      slotFadeX.set(slot, x);
    },
    set needsUpdate(v: boolean) {
      if (v) iFadeUpdates++;
    },
    get needsUpdate() {
      return false;
    },
  };

  const sharedMesh = {
    setMatrixAt: (slot: number, m: THREE.Matrix4) => {
      slotMatrices.set(slot, m.clone());
    },
    instanceMatrix: {
      set needsUpdate(v: boolean) {
        if (v) matUpdates++;
      },
      get needsUpdate() {
        return false;
      },
    },
    geometry: {
      getAttribute: (n: string) => (n === 'iFade' ? iFade : undefined),
    },
  } as unknown as THREE.InstancedMesh;

  const timelines = buildPathTimelines(twoPathBundle);
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: (b) => ({ mesh: sharedMesh, slot: b.slotId }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets: { setStreetOpacity: () => {} },
    streetsByDir: {},
  });

  SCRUB_POS.value = 1.5;
  controller.update();

  expect(matUpdates).toBe(1);
  expect(iFadeUpdates).toBe(1);
  expect(slotMatrices.get(0)!.elements[5]).toBeCloseTo(
    buildingHeightForLines(file, 4, heightCtx),
    5
  );
  expect(slotMatrices.get(1)!.elements[5]).toBeCloseTo(
    buildingHeightForLines(file2, 4, heightCtx),
    5
  );
  expect(slotFadeX.get(0)).toBeCloseTo(1, 5);
  expect(slotFadeX.get(1)).toBeCloseTo(1, 5);
});

test('couples street opacity to the max opacity of its buildings (block fade)', () => {
  // d/ has two buildings, both deleted at commit index 3 (K); e/ has one that survives.
  const dStreet = { dir: { path: 'd' } } as unknown as Street;
  const eStreet = { dir: { path: 'e' } } as unknown as Street;

  const fileD1 = { path: 'd/f1.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;
  const fileD2 = { path: 'd/f2.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;
  const fileE1 = { path: 'e/f3.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;

  const blockBundle = {
    commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      {
        sha: 'a',
        changes: [
          { path: 'd/f1.txt', sha: 's1' },
          { path: 'd/f2.txt', sha: 's1' },
          { path: 'e/f3.txt', sha: 's1' },
        ],
      },
      { sha: 'b', changes: [] },
      { sha: 'c', changes: [] },
      {
        sha: 'd',
        changes: [
          { path: 'd/f1.txt', sha: null },
          { path: 'd/f2.txt', sha: null },
        ],
      },
    ],
    blobLines: { s1: 6 },
    note: null,
  } as unknown as TimelineBundle;

  function makeBuilding(f: FileNode, slotId: number): Building {
    return {
      x: 0,
      y: 0,
      w: 2,
      d: 2,
      h: buildingHeightForLines(f, 6, heightCtx),
      color: '#fff',
      file: f,
      cellId: 0,
      slotId,
    } as unknown as Building;
  }

  const bD1 = makeBuilding(fileD1, 0);
  const bD2 = makeBuilding(fileD2, 1);
  const bE1 = makeBuilding(fileE1, 2);

  const index = new BuildingIndex();
  index.insert(bD1);
  index.insert(bD2);
  index.insert(bE1);

  const meshByBuilding = new Map<Building, ReturnType<typeof makeFakeMesh>>([
    [bD1, makeFakeMesh()],
    [bD2, makeFakeMesh()],
    [bE1, makeFakeMesh()],
  ]);

  const opacityByStreet = new Map<Street, number>();
  const streets = {
    setStreetOpacity: (street: Street, opacity: number) => {
      opacityByStreet.set(street, opacity);
    },
  };

  const timelines = buildPathTimelines(blockBundle);
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: (b) => ({ mesh: meshByBuilding.get(b)!.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets,
    streetsByDir: { d: dStreet, e: eStreet },
  });

  SCRUB_POS.value = 2; // before K, everything present
  controller.update();
  expect(opacityByStreet.get(dStreet)).toBeCloseTo(1, 5);
  expect(opacityByStreet.get(eStreet)).toBeCloseTo(1, 5);

  SCRUB_POS.value = 3.5; // after K, d/'s buildings are both deleted
  controller.update();
  expect(opacityByStreet.get(dStreet)).toBe(RUIN_FLOOR);
  expect(opacityByStreet.get(eStreet)).toBeCloseTo(1, 5);
});

test('block-fade is a true max, not last-write-wins: one deleted sibling cannot drag a street down', () => {
  // d/f1.txt survives to the end; d/f2.txt is deleted at commit index 3 (K). f2 is
  // inserted into the index AFTER f1, so it is iterated (and its opacity written)
  // last: a last-write-wins implementation would leave the street at 0, while
  // Math.max correctly keeps it at 1 because f1 is still alive.
  const dStreet = { dir: { path: 'd' } } as unknown as Street;

  const fileD1 = { path: 'd/f1.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;
  const fileD2 = { path: 'd/f2.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;

  const siblingBundle = {
    commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      {
        sha: 'a',
        changes: [
          { path: 'd/f1.txt', sha: 's1' },
          { path: 'd/f2.txt', sha: 's1' },
        ],
      },
      { sha: 'b', changes: [] },
      { sha: 'c', changes: [] },
      { sha: 'd', changes: [{ path: 'd/f2.txt', sha: null }] },
    ],
    blobLines: { s1: 6 },
    note: null,
  } as unknown as TimelineBundle;

  function makeBuilding(f: FileNode, slotId: number): Building {
    return {
      x: 0,
      y: 0,
      w: 2,
      d: 2,
      h: buildingHeightForLines(f, 6, heightCtx),
      color: '#fff',
      file: f,
      cellId: 0,
      slotId,
    } as unknown as Building;
  }

  const bD1 = makeBuilding(fileD1, 0); // survives
  const bD2 = makeBuilding(fileD2, 1); // deleted at K

  const index = new BuildingIndex();
  // Insert the surviving building first and the deleted one last, so the
  // deleted building's (lower) opacity is written last into the accumulator.
  index.insert(bD1);
  index.insert(bD2);

  const meshByBuilding = new Map<Building, ReturnType<typeof makeFakeMesh>>([
    [bD1, makeFakeMesh()],
    [bD2, makeFakeMesh()],
  ]);

  const opacityByStreet = new Map<Street, number>();
  const streets = {
    setStreetOpacity: (street: Street, opacity: number) => {
      opacityByStreet.set(street, opacity);
    },
  };

  const timelines = buildPathTimelines(siblingBundle);
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: (b) => ({ mesh: meshByBuilding.get(b)!.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets,
    streetsByDir: { d: dStreet },
  });

  SCRUB_POS.value = 3.5; // after K: f2 deleted, f1 still alive
  controller.update();
  expect(opacityByStreet.get(dStreet)).toBeCloseTo(1, 5);
});

test('descendant rollup: a container street with no direct files inherits its child street opacity', () => {
  // src/a/f.txt is the only building; src/ has no direct file buildings, only the
  // subdir src/a/. Both streets must track the building's presence (live, then deleted),
  // not just src/a/ — a container-only street must never go stale/invisible while its
  // subtree is alive.
  const srcStreet = { dir: { path: 'src' } } as unknown as Street;
  const srcAStreet = { dir: { path: 'src/a' } } as unknown as Street;
  const eStreet = { dir: { path: 'e' } } as unknown as Street; // unrelated sibling container

  const fileF = {
    path: 'src/a/f.txt',
    lines: 6,
    size: 500,
    extension: 'txt',
  } as unknown as FileNode;
  const fileE = { path: 'e/g.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;

  const rollupBundle = {
    commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      {
        sha: 'a',
        changes: [
          { path: 'src/a/f.txt', sha: 's1' },
          { path: 'e/g.txt', sha: 's1' },
        ],
      },
      { sha: 'b', changes: [] },
      { sha: 'c', changes: [] },
      { sha: 'd', changes: [{ path: 'src/a/f.txt', sha: null }] },
    ],
    blobLines: { s1: 6 },
    note: null,
  } as unknown as TimelineBundle;

  function makeBuilding(f: FileNode, slotId: number): Building {
    return {
      x: 0,
      y: 0,
      w: 2,
      d: 2,
      h: buildingHeightForLines(f, 6, heightCtx),
      color: '#fff',
      file: f,
      cellId: 0,
      slotId,
    } as unknown as Building;
  }

  const bF = makeBuilding(fileF, 0);
  const bE = makeBuilding(fileE, 1);

  const index = new BuildingIndex();
  index.insert(bF);
  index.insert(bE);

  const meshByBuilding = new Map<Building, ReturnType<typeof makeFakeMesh>>([
    [bF, makeFakeMesh()],
    [bE, makeFakeMesh()],
  ]);

  const opacityByStreet = new Map<Street, number>();
  const streets = {
    setStreetOpacity: (street: Street, opacity: number) => {
      opacityByStreet.set(street, opacity);
    },
  };

  const timelines = buildPathTimelines(rollupBundle);
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: (b) => ({ mesh: meshByBuilding.get(b)!.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets,
    streetsByDir: { src: srcStreet, 'src/a': srcAStreet, e: eStreet },
  });

  SCRUB_POS.value = 2; // before deletion, everything present
  controller.update();
  expect(opacityByStreet.get(srcAStreet)).toBeCloseTo(1, 5);
  expect(opacityByStreet.get(srcStreet)).toBeCloseTo(1, 5); // rolled up from src/a
  expect(opacityByStreet.get(eStreet)).toBeCloseTo(1, 5); // unrelated container unaffected

  SCRUB_POS.value = 3.5; // after deletion, src/a/f.txt is gone
  controller.update();
  expect(opacityByStreet.get(srcAStreet)).toBe(RUIN_FLOOR);
  expect(opacityByStreet.get(srcStreet)).toBe(RUIN_FLOOR); // dropped along with its only child
  expect(opacityByStreet.get(eStreet)).toBeCloseTo(1, 5); // still unaffected
});

test('footprints: a deleted building/street fades to 0 while a live sibling stays ~1', () => {
  // d/ is deleted at commit index 3 (K); e/ survives. Mirrors the street block-fade
  // scenario but asserts on the footprint slabs, which used to stay stuck opaque.
  const dStreet = { dir: { path: 'd' } } as unknown as Street;
  const eStreet = { dir: { path: 'e' } } as unknown as Street;

  const fileD = { path: 'd/f1.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;
  const fileE = { path: 'e/f2.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;

  const footprintBundle = {
    commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      {
        sha: 'a',
        changes: [
          { path: 'd/f1.txt', sha: 's1' },
          { path: 'e/f2.txt', sha: 's1' },
        ],
      },
      { sha: 'b', changes: [] },
      { sha: 'c', changes: [] },
      { sha: 'd', changes: [{ path: 'd/f1.txt', sha: null }] },
    ],
    blobLines: { s1: 6 },
    note: null,
  } as unknown as TimelineBundle;

  function makeBuilding(f: FileNode, slotId: number): Building {
    return {
      x: 0,
      y: 0,
      w: 2,
      d: 2,
      h: buildingHeightForLines(f, 6, heightCtx),
      color: '#fff',
      file: f,
      cellId: 0,
      slotId,
    } as unknown as Building;
  }

  const bD = makeBuilding(fileD, 0);
  const bE = makeBuilding(fileE, 1);

  const index = new BuildingIndex();
  index.insert(bD);
  index.insert(bE);

  const meshByBuilding = new Map<Building, ReturnType<typeof makeFakeMesh>>([
    [bD, makeFakeMesh()],
    [bE, makeFakeMesh()],
  ]);

  const fakeFootprints = makeFakeFootprints();

  const timelines = buildPathTimelines(footprintBundle);
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: (b) => ({ mesh: meshByBuilding.get(b)!.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: fakeFootprints.footprints,
    streets: { setStreetOpacity: () => {} },
    streetsByDir: { d: dStreet, e: eStreet },
  });

  SCRUB_POS.value = 3.5; // after K: d/f1.txt deleted, e/f2.txt still alive
  controller.update();

  expect(fakeFootprints.buildingOpacity.get('d/f1.txt')).toBe(RUIN_FLOOR);
  expect(fakeFootprints.buildingOpacity.get('e/f2.txt')).toBeCloseTo(1, 5);
  expect(fakeFootprints.streetOpacity.get('d')).toBe(RUIN_FLOOR);
  expect(fakeFootprints.streetOpacity.get('e')).toBeCloseTo(1, 5);
});
