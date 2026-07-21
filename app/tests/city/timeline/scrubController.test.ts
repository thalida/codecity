import * as THREE from 'three';
import { beforeEach, expect, test } from 'vitest';

import { buildPathTimelines } from '@/city/timeline/replay';
import { createScrubController, RUIN_FLOOR } from '@/city/timeline/scrubController';
import { buildingHeightForLines } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import { SCRUB_POS } from '@/state/stores/timeline';
import { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { Building, FileNode, TimelineBundle } from '@/types';

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

const heightCtx: HeightContext = { lineStats: { min: 1, max: 200 }, byteStats: { min: 1, max: 5000 } };

const file = { path: 'f.txt', lines: 6, size: 500, extension: 'txt' } as unknown as FileNode;

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

function setup() {
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
    getMeshForBuilding: () => ({ mesh: fake.mesh, slot: 0 }),
    timelines,
    heightCtx,
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
