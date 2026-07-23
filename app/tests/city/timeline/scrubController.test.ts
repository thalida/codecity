import * as THREE from 'three';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { buildPathTimelines } from '@/city/timeline/replay';
import { createScrubController, FUTURE_SLAB_FLOORS } from '@/city/timeline/scrubController';
import { buildingHeightForLines, getBuildingDimensions } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import { SCRUB_POS, TIMELINE_BUNDLE } from '@/state/stores/timeline';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';
import { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { InstancedAdPanels } from '@/city/components/buildings/adPanels';
import { getBuildingColorForRecency } from '@/city/components/buildings/color';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import type { BuildingsConfig } from '@/state/stores/settings/buildings';
import type { Building, FileNode, PickTarget, Street, TimelineBundle } from '@/types';
import { ROOT_PATH } from '@/constants/manifest';
import { signal } from '@preact/signals';

// The scrub controller reads picker.selection/hover for the neighborhood fade
// cascade; these tests don't drive hover, so a null-selection stub suffices.
const mockPicker = () => ({
  selection: signal<PickTarget | null>(null),
  hover: signal<PickTarget | null>(null),
});

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

// Most tests don't assert on the tree scrub gate; this stub keeps their deps minimal.
const noopTrees = { setScrubCommit: () => {} };

// Most tests don't assert on the fireflies scrub gate; this stub keeps their deps minimal.
const noopFireflies = { setScrubCommit: () => {} };

function makeFakeTrees() {
  const calls: (number | null)[] = [];
  return {
    trees: { setScrubCommit: (maxCommitIndex: number | null) => calls.push(maxCommitIndex) },
    calls,
  };
}

function makeFakeFireflies() {
  const calls: (number | null)[] = [];
  return {
    fireflies: { setScrubCommit: (maxCommitIndex: number | null) => calls.push(maxCommitIndex) },
    calls,
  };
}

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

function makeFakeMesh(initialFadeZ = 0) {
  const lastMatrix = new THREE.Matrix4();
  let iFadeX = 1;
  let iFadeY = 0;
  let iFadeZ = initialFadeZ;
  let iFadeUpdates = 0;
  let matUpdates = 0;
  let lastColor: THREE.Color | null = null;
  let colorSetCount = 0;
  let colorUpdates = 0;
  let floors = 0;
  let floorsUpdates = 0;
  let modifiedAge = 0;
  let modifiedAgeUpdates = 0;
  let iconUvW = 0;
  let iconUvUpdates = 0;

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

  const iFloors = {
    setX: (_slot: number, x: number) => {
      floors = x;
    },
    set needsUpdate(v: boolean) {
      if (v) floorsUpdates++;
    },
    get needsUpdate() {
      return false;
    },
  };

  const iModifiedAge = {
    setX: (_slot: number, x: number) => {
      modifiedAge = x;
    },
    set needsUpdate(v: boolean) {
      if (v) modifiedAgeUpdates++;
    },
    get needsUpdate() {
      return false;
    },
  };

  const iIconUV = {
    setW: (_slot: number, w: number) => {
      iconUvW = w;
    },
    set needsUpdate(v: boolean) {
      if (v) iconUvUpdates++;
    },
    get needsUpdate() {
      return false;
    },
  };

  const mesh = {
    setMatrixAt: (_slot: number, m: THREE.Matrix4) => {
      lastMatrix.copy(m);
    },
    setColorAt: (_slot: number, c: THREE.Color) => {
      lastColor = c.clone();
      colorSetCount++;
    },
    instanceColor: {
      set needsUpdate(v: boolean) {
        if (v) colorUpdates++;
      },
      get needsUpdate() {
        return false;
      },
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
      getAttribute: (n: string) => {
        if (n === 'iFade') return iFade;
        if (n === 'iFloors') return iFloors;
        if (n === 'iModifiedAge') return iModifiedAge;
        if (n === 'iIconUV') return iIconUV;
        return undefined;
      },
    },
  } as unknown as THREE.InstancedMesh;

  return {
    mesh,
    get scaleX() {
      return lastMatrix.elements[0];
    },
    get scaleY() {
      return lastMatrix.elements[5];
    },
    get scaleZ() {
      return lastMatrix.elements[10];
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
    get iFadeZ() {
      return iFadeZ;
    },
    get matUpdates() {
      return matUpdates;
    },
    get iFadeUpdates() {
      return iFadeUpdates;
    },
    get lastColor() {
      return lastColor;
    },
    get colorSetCount() {
      return colorSetCount;
    },
    get colorUpdates() {
      return colorUpdates;
    },
    get floors() {
      return floors;
    },
    get floorsUpdates() {
      return floorsUpdates;
    },
    get modifiedAge() {
      return modifiedAge;
    },
    get modifiedAgeUpdates() {
      return modifiedAgeUpdates;
    },
    get iconUvW() {
      return iconUvW;
    },
    get iconUvUpdates() {
      return iconUvUpdates;
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

function setup(
  getAdPanels: () => InstancedAdPanels | null = () => null,
  trees: { setScrubCommit(maxCommitIndex: number | null): void } = noopTrees,
  fireflies: { setScrubCommit(maxCommitIndex: number | null): void } = noopFireflies,
  initialFadeZ = 0
) {
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

  const fake = makeFakeMesh(initialFadeZ);
  const timelines = buildPathTimelines(bundle);
  TIMELINE_BUNDLE.value = bundle;

  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels,
    getMeshForBuilding: () => ({ mesh: fake.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets: { setStreetOpacity: () => {}, setStreetLabelOpacity: () => {} },
    streetsByDir: {},
    picker: mockPicker(),
    trees,
    fireflies,
  });

  return { b, fake, controller, timelines };
}

// ── Anchored multi-building scenes ──────────────────────────────────────────
// The scrub controller normalizes each present building's floors/weathering
// against the range of the OTHER present buildings at that scrub position, not
// against a commit index. A lone present building therefore has a degenerate
// range (floors collapse to MIN_FLOORS, recency pins to 1). These helpers build
// scenes with always-present "anchor" files so the range is real:
//   - anchorLo/anchorHi (1 and 200 lines) restore presentLineStats = {1, 200},
//     which equals heightCtx.lineStats, so the subject's floors/height curve
//     matches the single-file baseline again.
//   - dated commits + distinct anchor modify/create schedules give the
//     last-modified / created date spans that drive recency + createdAge.
// Each building gets its OWN fake mesh at slot 0, so a scene records the subject
// and every anchor independently; assert on the subject's fake only.
const DAY_MS = 86_400_000;
const BASE_MS = Date.UTC(2021, 0, 1);
const isoAt = (i: number): string => new Date(BASE_MS + i * DAY_MS).toISOString();

const anchorLoFile = {
  path: 'anchorLo.txt',
  lines: 1,
  size: 100,
  extension: 'txt',
} as unknown as FileNode;
const anchorHiFile = {
  path: 'anchorHi.txt',
  lines: 200,
  size: 100,
  extension: 'txt',
} as unknown as FileNode;

function makeAnchoredScene(
  sceneBundle: TimelineBundle,
  files: FileNode[]
): {
  controller: ReturnType<typeof createScrubController>;
  fakes: Map<string, ReturnType<typeof makeFakeMesh>>;
} {
  const index = new BuildingIndex();
  const fakes = new Map<string, ReturnType<typeof makeFakeMesh>>();
  const meshByBuilding = new Map<Building, ReturnType<typeof makeFakeMesh>>();
  files.forEach((f, slotId) => {
    const b = {
      x: 5,
      y: 7,
      w: 2,
      d: 2,
      h: buildingHeightForLines(f, (f as unknown as { lines: number }).lines, heightCtx),
      color: '#fff',
      file: f,
      cellId: 0,
      slotId,
    } as unknown as Building;
    index.insert(b);
    const fake = makeFakeMesh();
    fakes.set(f.path, fake);
    meshByBuilding.set(b, fake);
  });

  const timelines = buildPathTimelines(sceneBundle);
  TIMELINE_BUNDLE.value = sceneBundle;

  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: (b) => ({ mesh: meshByBuilding.get(b)!.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets: { setStreetOpacity: () => {}, setStreetLabelOpacity: () => {} },
    streetsByDir: {},
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
  });

  return { controller, fakes };
}

// Standard 4-commit timeline for the subject `file` (f.txt: created@1 with 2
// lines, grows to 6 lines@2, deleted@3) PLUS the two line-range anchors, so
// presentLineStats stays {1, 200} for every present-at scrub position.
const anchoredBundle = {
  commits: [
    { sha: 'a', date: isoAt(0) },
    { sha: 'b', date: isoAt(1) },
    { sha: 'c', date: isoAt(2) },
    { sha: 'd', date: isoAt(3) },
  ],
  unionManifest: { tree: { name: 'r' } },
  deltas: [
    {
      sha: 'a',
      changes: [
        { path: 'anchorLo.txt', sha: 'lo' },
        { path: 'anchorHi.txt', sha: 'hi' },
      ],
    },
    { sha: 'b', changes: [{ path: 'f.txt', sha: 's1' }] },
    { sha: 'c', changes: [{ path: 'f.txt', sha: 's2' }] },
    { sha: 'd', changes: [{ path: 'f.txt', sha: null }] },
  ],
  blobLines: { s1: 2, s2: 6, lo: 1, hi: 200 },
  note: null,
} as unknown as TimelineBundle;

// Deterministic saturation/lightness range so the "fresh" vs "weathered"
// ends of the age-color curve are easy to assert on.
const TEST_SATURATION = { min: 20, max: 100 };
const TEST_LIGHTNESS = { min: 25, max: 70 };
let _origPalette: BuildingsConfig | null = null;
let _origRuins: typeof RUINS.value | null = null;
let _origBlueprints: typeof BLUEPRINTS.value | null = null;

beforeEach(() => {
  SCRUB_POS.value = 0;
  TIMELINE_BUNDLE.value = null;
  _origRuins = { ...RUINS.value };
  _origBlueprints = { ...BLUEPRINTS.value };
  // Base-mechanics tests assert the vanish path; ruins get their own block.
  RUINS.value = { ...RUINS.value, ENABLED: false };
  BLUEPRINTS.value = { ...BLUEPRINTS.value, ENABLED: false };
  _origPalette = { ...BUILDINGS.value };
  BUILDINGS.value = {
    ...BUILDINGS.value,
    SATURATION_MIN: TEST_SATURATION.min,
    SATURATION_MAX: TEST_SATURATION.max,
    LIGHTNESS_MIN: TEST_LIGHTNESS.min,
    LIGHTNESS_MAX: TEST_LIGHTNESS.max,
  };
});

afterEach(() => {
  if (_origPalette) BUILDINGS.value = _origPalette;
  if (_origRuins) RUINS.value = _origRuins;
  if (_origBlueprints) BLUEPRINTS.value = _origBlueprints;
  TIMELINE_BUNDLE.value = null;
});

test('scaleY reflects the interpolated height at the scrub position', () => {
  // Anchors pin presentLineStats to {1, 200} (= heightCtx.lineStats), so the
  // subject's height normalizes over the same range as the single-file baseline.
  const { controller, fakes } = makeAnchoredScene(anchoredBundle, [
    file,
    anchorLoFile,
    anchorHiFile,
  ]);
  const fake = fakes.get('f.txt')!;
  SCRUB_POS.value = 1.5;
  controller.update();

  const expected = buildingHeightForLines(file, 4, heightCtx); // lines lerp 2→6 at pos 1.5
  expect(fake.scaleY).toBeCloseTo(expected, 5);
  expect(fake.posY).toBeCloseTo(expected / 2, 5);
});

test('at HEAD the height factor is ~1 (matches the union baseline)', () => {
  const { controller, fakes } = makeAnchoredScene(anchoredBundle, [
    file,
    anchorLoFile,
    anchorHiFile,
  ]);
  const fake = fakes.get('f.txt')!;
  SCRUB_POS.value = 2; // last live commit index, 6 lines
  controller.update();
  expect(fake.scaleY).toBeCloseTo(buildingHeightForLines(file, 6, heightCtx), 5);
});

test('before its creation the building is flat and fully transparent', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 0.5; // before createdIdx = 1
  controller.update();
  expect(fake.scaleY).toBe(0);
  expect(fake.iFadeX).toBeCloseTo(0, 5);
});

test('after deletion (ruins off) opacity drops to 0 and the body vanishes', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 3; // deletedIdx
  controller.update();
  expect(fake.scaleY).toBe(0);
  expect(fake.iFadeX).toBe(0);
});

test('ruins on: a deleted building becomes a faint, blank-facade stub shorter than its lived height', () => {
  RUINS.value = { ...RUINS.value, ENABLED: true, BUILDING_OPACITY: 0.3, STUB_HEIGHT: 0.35 };
  const { fake, controller } = setup();
  SCRUB_POS.value = 3; // deletedIdx → ruin
  controller.update();
  expect(fake.iFadeX).toBeCloseTo(0.3, 5); // the BUILDING_OPACITY setting, faint
  expect(fake.scaleY).toBeGreaterThan(0); // a stub, not vanished
  expect(fake.scaleY).toBeLessThan(buildingHeightForLines(file, 6, heightCtx)); // shorter than it ever was
  expect(fake.floors).toBe(0); // blank facade (no windows)
  expect(fake.colorSetCount).toBeGreaterThan(0); // grayed color written
});

test('ruins on: the stub height is the STUB_HEIGHT setting × a floor, not the lived height', () => {
  RUINS.value = { ...RUINS.value, ENABLED: true, STUB_HEIGHT: 0.5 };
  const { fake, controller } = setup();
  SCRUB_POS.value = 3;
  controller.update();
  // Uniform: STUB_HEIGHT floors, independent of the file's size/lines.
  const expected = 0.5 * BUILDING_DIMENSIONS.value.FLOOR_HEIGHT;
  expect(fake.scaleY).toBeCloseTo(expected, 5);
  expect(fake.posY).toBeCloseTo(expected / 2, 5); // sits on the ground
});

test('ruins on: a before-genesis building stays absent (nothing to ruin yet)', () => {
  RUINS.value = { ...RUINS.value, ENABLED: true };
  const { fake, controller } = setup();
  SCRUB_POS.value = 0; // f.txt created at 1 → before it existed
  controller.update();
  expect(fake.iFadeX).toBe(0);
  expect(fake.scaleY).toBe(0);
});

// An absent building must get a fully zero-scaled matrix, not a flat (w, 0, d)
// quad: a flat quad still writes depth and shows as a cutout/outline on the road.
test('an absent building (before creation) gets a fully zero-scale matrix, not a flat quad', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 0.5; // before createdIdx = 1
  controller.update();
  expect(fake.scaleX).toBeCloseTo(0, 5);
  expect(fake.scaleY).toBeCloseTo(0, 5);
  expect(fake.scaleZ).toBeCloseTo(0, 5);
});

test('an absent building (after deletion) gets a fully zero-scale matrix, not a flat quad', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 3; // deletedIdx
  controller.update();
  expect(fake.scaleX).toBeCloseTo(0, 5);
  expect(fake.scaleY).toBeCloseTo(0, 5);
  expect(fake.scaleZ).toBeCloseTo(0, 5);
});

test('drives footprint opacity even when the building has no detail mesh (LOD cell)', () => {
  // On a large repo most cells stay at impostor LOD, so getMeshForBuilding
  // returns null. The footprint must still fade with presence rather than
  // stranding at its opaque default (the stray-footprints bug).
  const b = {
    x: 5,
    y: 7,
    w: 2,
    d: 2,
    h: 1,
    color: '#fff',
    file,
    cellId: 0,
    slotId: 0,
  } as unknown as Building;
  const index = new BuildingIndex();
  index.insert(b);
  const fp = makeFakeFootprints();
  TIMELINE_BUNDLE.value = bundle;
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: () => null, // impostor LOD cell: no detail mesh
    timelines: buildPathTimelines(bundle),
    heightCtx,
    footprints: fp.footprints,
    streets: { setStreetOpacity: () => {}, setStreetLabelOpacity: () => {} },
    streetsByDir: {},
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
  });

  SCRUB_POS.value = 0; // before genesis → absent
  controller.update();
  expect(fp.buildingOpacity.get('f.txt')).toBe(0);

  SCRUB_POS.value = 2; // present
  controller.update();
  expect(fp.buildingOpacity.get('f.txt')).toBe(1);
});

test('a present building keeps its full footprint (scaleX/scaleZ), only height animates', () => {
  const { b, fake, controller } = setup();
  SCRUB_POS.value = 1.5; // mid-growth: height interpolated, footprint stays full
  controller.update();
  expect(fake.scaleX).toBeCloseTo(b.w, 5);
  expect(fake.scaleZ).toBeCloseTo(b.d, 5);
  expect(fake.scaleY).toBeGreaterThan(0);
});

test('an absent building has its outline (iFade.z) driven to 0, even if left over from a Live-mode fade sweep', () => {
  const { fake, controller } = setup(undefined, undefined, undefined, 0.8);
  SCRUB_POS.value = 3; // deletedIdx: absent
  controller.update();
  expect(fake.iFadeZ).toBe(0);
});

test('ad panels fade in lockstep with a present building body', () => {
  const fakeAdPanels = makeFakeAdPanels();
  const { b, controller } = setup(() => fakeAdPanels.adPanels);
  SCRUB_POS.value = 1.5;
  controller.update();
  expect(fakeAdPanels.calls).toBe(1);
  expect(fakeAdPanels.lastGetFade!(b.file.path)).toBeCloseTo(1, 5);
});

test('ad panels fade to 0 once the building is deleted (ruins off)', () => {
  const fakeAdPanels = makeFakeAdPanels();
  const { b, controller } = setup(() => fakeAdPanels.adPanels);
  SCRUB_POS.value = 3; // deletedIdx
  controller.update();
  expect(fakeAdPanels.lastGetFade!(b.file.path)).toBe(0);
});

test('ad panels stay hidden on a ruin (media is gone, only the stub shows)', () => {
  RUINS.value = { ...RUINS.value, ENABLED: true, BUILDING_OPACITY: 0.3 };
  const fakeAdPanels = makeFakeAdPanels();
  const { b, controller } = setup(() => fakeAdPanels.adPanels);
  SCRUB_POS.value = 3; // deleted → ruin
  controller.update();
  // The stub/footprint ghost at 0.3, but the media panel must be 0 (no image on a ruin).
  expect(fakeAdPanels.lastGetFade!(b.file.path)).toBe(0);
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

test('gates trees on the floored scrub position', () => {
  const fakeTrees = makeFakeTrees();
  const { controller } = setup(() => null, fakeTrees.trees);

  SCRUB_POS.value = 1.9;
  controller.update();
  expect(fakeTrees.calls.at(-1)).toBe(1);

  SCRUB_POS.value = -0.5;
  controller.update();
  expect(fakeTrees.calls.at(-1)).toBe(-1);
});

test('gates fireflies on the floored scrub position, same value as the tree gate', () => {
  const fakeFireflies = makeFakeFireflies();
  const { controller } = setup(() => null, noopTrees, fakeFireflies.fireflies);

  SCRUB_POS.value = 1.9;
  controller.update();
  expect(fakeFireflies.calls.at(-1)).toBe(1);

  SCRUB_POS.value = -0.5;
  controller.update();
  expect(fakeFireflies.calls.at(-1)).toBe(-1);
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
    streets: { setStreetOpacity: () => {}, setStreetLabelOpacity: () => {} },
    streetsByDir: {},
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
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
  // anchorLo/anchorHi are always-present so presentLineStats stays {1, 200}; they
  // live on a SEPARATE mesh, so the shared-mesh needsUpdate counts stay about the
  // two subject slots only.
  const twoPathBundle = {
    commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      {
        sha: 'a',
        changes: [
          { path: 'anchorLo.txt', sha: 'lo' },
          { path: 'anchorHi.txt', sha: 'hi' },
        ],
      },
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
    blobLines: { s1: 2, s2: 6, lo: 1, hi: 200 },
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

  const anchorLo = {
    x: 0,
    y: 0,
    w: 2,
    d: 2,
    h: 1,
    color: '#fff',
    file: anchorLoFile,
    cellId: 0,
    slotId: 2,
  } as unknown as Building;
  const anchorHi = {
    x: 0,
    y: 0,
    w: 2,
    d: 2,
    h: 1,
    color: '#fff',
    file: anchorHiFile,
    cellId: 0,
    slotId: 3,
  } as unknown as Building;

  const index = new BuildingIndex();
  index.insert(b1);
  index.insert(b2);
  index.insert(anchorLo);
  index.insert(anchorHi);

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
    setColorAt: () => {},
    instanceColor: {
      set needsUpdate(_v: boolean) {},
      get needsUpdate() {
        return false;
      },
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

  const anchorMesh = makeFakeMesh();
  const timelines = buildPathTimelines(twoPathBundle);
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    // Subjects share one mesh (the dedup case); anchors live on a separate mesh
    // so they don't inflate the shared mesh's needsUpdate counts.
    getMeshForBuilding: (b) =>
      b === anchorLo || b === anchorHi
        ? { mesh: anchorMesh.mesh, slot: b.slotId }
        : { mesh: sharedMesh, slot: b.slotId },
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets: { setStreetOpacity: () => {}, setStreetLabelOpacity: () => {} },
    streetsByDir: {},
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
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
  const labelOpacityByStreet = new Map<Street, number>();
  const streets = {
    setStreetOpacity: (street: Street, opacity: number) => {
      opacityByStreet.set(street, opacity);
    },
    setStreetLabelOpacity: (street: Street, opacity: number) => {
      labelOpacityByStreet.set(street, opacity);
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
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
  });

  SCRUB_POS.value = 2; // before K, everything present
  controller.update();
  expect(opacityByStreet.get(dStreet)).toBeCloseTo(1, 5);
  expect(opacityByStreet.get(eStreet)).toBeCloseTo(1, 5);

  SCRUB_POS.value = 3.5; // after K, d/'s buildings are both deleted
  controller.update();
  expect(opacityByStreet.get(dStreet)).toBe(0);
  expect(opacityByStreet.get(eStreet)).toBeCloseTo(1, 5);
  // Labels fade in lockstep with the road: the deleted street's label opacity drops to 0, the live one stays ~1.
  expect(labelOpacityByStreet.get(dStreet)).toBe(0);
  expect(labelOpacityByStreet.get(eStreet)).toBeCloseTo(1, 5);
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
    setStreetLabelOpacity: () => {},
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
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
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
    setStreetLabelOpacity: () => {},
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
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
  });

  SCRUB_POS.value = 2; // before deletion, everything present
  controller.update();
  expect(opacityByStreet.get(srcAStreet)).toBeCloseTo(1, 5);
  expect(opacityByStreet.get(srcStreet)).toBeCloseTo(1, 5); // rolled up from src/a
  expect(opacityByStreet.get(eStreet)).toBeCloseTo(1, 5); // unrelated container unaffected

  SCRUB_POS.value = 3.5; // after deletion, src/a/f.txt is gone
  controller.update();
  expect(opacityByStreet.get(srcAStreet)).toBe(0);
  expect(opacityByStreet.get(srcStreet)).toBe(0); // dropped along with its only child
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
    streets: { setStreetOpacity: () => {}, setStreetLabelOpacity: () => {} },
    streetsByDir: { d: dStreet, e: eStreet },
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
  });

  SCRUB_POS.value = 3.5; // after K: d/f1.txt deleted, e/f2.txt still alive
  controller.update();

  expect(fakeFootprints.buildingOpacity.get('d/f1.txt')).toBe(0);
  expect(fakeFootprints.buildingOpacity.get('e/f2.txt')).toBeCloseTo(1, 5);
  expect(fakeFootprints.streetOpacity.get('d')).toBe(0);
  expect(fakeFootprints.streetOpacity.get('e')).toBeCloseTo(1, 5);
});

test('the ROOT street stays at opacity 1 even when every building is absent, unlike a non-root empty street', () => {
  // f.txt lives at repo root (parentDirPath('f.txt') === ROOT_PATH), so its street
  // chain is just [rootStreet]. dStreet has no buildings at all, mirroring the
  // "scrubbed back to an empty repo" case where every road would otherwise fade.
  const rootStreet = { dir: { path: ROOT_PATH }, isRoot: true } as unknown as Street;
  const dStreet = { dir: { path: 'd' } } as unknown as Street;

  const index = new BuildingIndex();
  const b = {
    x: 0,
    y: 0,
    w: 2,
    d: 2,
    h: buildingHeightForLines(file, 6, heightCtx),
    color: '#fff',
    file,
    cellId: 0,
    slotId: 0,
  } as unknown as Building;
  index.insert(b);

  const opacityByStreet = new Map<Street, number>();
  const labelOpacityByStreet = new Map<Street, number>();
  const streets = {
    setStreetOpacity: (street: Street, opacity: number) => opacityByStreet.set(street, opacity),
    setStreetLabelOpacity: (street: Street, opacity: number) =>
      labelOpacityByStreet.set(street, opacity),
  };
  const fakeFootprints = makeFakeFootprints();

  const fake = makeFakeMesh();
  const timelines = buildPathTimelines(bundle);
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: () => ({ mesh: fake.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: fakeFootprints.footprints,
    streets,
    streetsByDir: { [ROOT_PATH]: rootStreet, d: dStreet },
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
  });

  SCRUB_POS.value = 0.5; // before f.txt's creation: every building absent
  controller.update();

  expect(opacityByStreet.get(rootStreet)).toBe(1);
  expect(labelOpacityByStreet.get(rootStreet)).toBe(1);
  expect(fakeFootprints.streetOpacity.get(ROOT_PATH)).toBe(1);

  expect(opacityByStreet.get(dStreet)).toBe(0);
  expect(labelOpacityByStreet.get(dStreet)).toBe(0);
});

// ── Weathering (color re-evaluated per scrub frame from scrub-relative recency) ──

function colorDist(a: THREE.Color, b: THREE.Color): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

// The subject building's color at a given recency, through the exact reused
// production curve (not a reimplementation) — the assertion the weathering
// tests pin against.
function colorForRecency(recency: number): THREE.Color {
  return new THREE.Color(
    getBuildingColorForRecency(
      file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
      recency
    )
  );
}

test('weathering: at the exact scrub position of last modification, color matches the freshest end of the reused age-color curve', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 2; // f.txt's last-modified index
  controller.update();

  const expected = new THREE.Color(
    getBuildingColorForRecency(
      file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
      1
    )
  );
  expect(fake.lastColor).not.toBeNull();
  expect(fake.lastColor!.r).toBeCloseTo(expected.r, 5);
  expect(fake.lastColor!.g).toBeCloseTo(expected.g, 5);
  expect(fake.lastColor!.b).toBeCloseTo(expected.b, 5);
});

test('weathering: recency-at-scrub runs through the exact same reused color function, not a reimplementation', () => {
  // Three present buildings give a real last-modified DATE range: anchorHi (oldest,
  // touched only at genesis), the subject f.txt (modified at commit 1), and anchorLo
  // (freshest, re-touched at commit 2). The subject's color is its last-mod date
  // normalized into that present range, pushed through getBuildingColorForRecency.
  const datedBundle = {
    commits: [
      { sha: 'a', date: isoAt(0) }, // anchorHi last-mod (oldest present)
      { sha: 'b', date: isoAt(6) }, // f.txt last-mod (subject)
      { sha: 'c', date: isoAt(8) }, // anchorLo re-touch (freshest present)
      { sha: 'd', date: isoAt(12) },
    ],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      {
        sha: 'a',
        changes: [
          { path: 'anchorLo.txt', sha: 'lo' },
          { path: 'anchorHi.txt', sha: 'hi' },
        ],
      },
      { sha: 'b', changes: [{ path: 'f.txt', sha: 's1' }] },
      { sha: 'c', changes: [{ path: 'anchorLo.txt', sha: 'lo' }] },
      { sha: 'd', changes: [{ path: 'f.txt', sha: null }] },
    ],
    blobLines: { s1: 6, lo: 1, hi: 200 },
    note: null,
  } as unknown as TimelineBundle;

  const { controller, fakes } = makeAnchoredScene(datedBundle, [file, anchorLoFile, anchorHiFile]);
  const fake = fakes.get('f.txt')!;
  SCRUB_POS.value = 2.3; // subject last-modified at commit 1; anchorLo freshest at commit 2
  controller.update();

  const minMod = Date.parse(isoAt(0)); // anchorHi
  const maxMod = Date.parse(isoAt(8)); // anchorLo
  const modMs = Date.parse(isoAt(6)); // subject f.txt
  const expectedRecency = (modMs - minMod) / (maxMod - minMod); // 6/8 = 0.75
  const expected = colorForRecency(expectedRecency);
  expect(fake.lastColor!.r).toBeCloseTo(expected.r, 5);
  expect(fake.lastColor!.g).toBeCloseTo(expected.g, 5);
  expect(fake.lastColor!.b).toBeCloseTo(expected.b, 5);

  // Still much closer to the freshest end than the weathered end.
  expect(colorDist(fake.lastColor!, colorForRecency(1))).toBeLessThan(
    colorDist(fake.lastColor!, colorForRecency(0))
  );
});

test('weathering: far past its last modification, color approaches the weathered end of the curve', () => {
  // f.txt is modified once at commit 1 and never touched again across an 11-commit
  // history, while anchorLo is re-touched at HEAD (commit 10). At pos=10 the subject's
  // last-mod date sits near the OLD end of the present last-mod range, so recency is low.
  const longBundle = {
    commits: Array.from({ length: 11 }, (_, i) => ({ sha: `c${i}`, date: isoAt(i) })),
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      {
        sha: 'c0',
        changes: [
          { path: 'anchorLo.txt', sha: 'lo' },
          { path: 'anchorHi.txt', sha: 'hi' },
        ],
      },
      { sha: 'c1', changes: [{ path: 'f.txt', sha: 's1' }] },
      ...Array.from({ length: 8 }, (_, i) => ({ sha: `c${i + 2}`, changes: [] })),
      { sha: 'c10', changes: [{ path: 'anchorLo.txt', sha: 'lo' }] },
    ],
    blobLines: { s1: 6, lo: 1, hi: 200 },
    note: null,
  } as unknown as TimelineBundle;

  const { controller, fakes } = makeAnchoredScene(longBundle, [file, anchorLoFile, anchorHiFile]);
  const fake = fakes.get('f.txt')!;
  SCRUB_POS.value = 10;
  controller.update();

  const minMod = Date.parse(isoAt(0)); // anchorHi, oldest present last-mod
  const maxMod = Date.parse(isoAt(10)); // anchorLo, re-touched at HEAD
  const modMs = Date.parse(isoAt(1)); // subject, untouched since commit 1
  const expectedRecency = (modMs - minMod) / (maxMod - minMod); // 1/10 = 0.1
  const expected = colorForRecency(expectedRecency);
  expect(fake.lastColor!.r).toBeCloseTo(expected.r, 5);
  expect(fake.lastColor!.g).toBeCloseTo(expected.g, 5);
  expect(fake.lastColor!.b).toBeCloseTo(expected.b, 5);

  expect(colorDist(fake.lastColor!, colorForRecency(0))).toBeLessThan(
    colorDist(fake.lastColor!, colorForRecency(1))
  );
});

test('weathering: absent buildings (before creation / after deletion) are not colored', () => {
  const { fake, controller } = setup();

  SCRUB_POS.value = 0.5; // before f.txt's creation
  controller.update();
  expect(fake.colorSetCount).toBe(0);

  SCRUB_POS.value = 3; // after deletion
  controller.update();
  expect(fake.colorSetCount).toBe(0);
});

// ── Full-attribute scrub (iFloors, iModifiedAge, iIconUV.w) ──────────────────

test('iFloors reflects the scrub-position line count, not the union/final-commit value', () => {
  // Anchors keep presentLineStats == heightCtx.lineStats, so the subject's floor
  // count is getBuildingDimensions at its scrub-position line count over that range.
  const { controller, fakes } = makeAnchoredScene(anchoredBundle, [
    file,
    anchorLoFile,
    anchorHiFile,
  ]);
  const fake = fakes.get('f.txt')!;
  SCRUB_POS.value = 1.5; // lines lerp 2->6 at pos 1.5 => 4 lines
  controller.update();

  const scrubDims = getBuildingDimensions(
    { ...file, lines: 4 },
    heightCtx.lineStats,
    heightCtx.byteStats
  );
  const unionDims = getBuildingDimensions(
    { ...file, lines: 6 },
    heightCtx.lineStats,
    heightCtx.byteStats
  );
  expect(fake.floors).toBe(scrubDims.floors);
  expect(fake.floors).not.toBe(unionDims.floors);
});

test('iFloors changes as SCRUB_POS moves: an earlier (shorter) scrub state has fewer or equal floors', () => {
  const { controller, fakes } = makeAnchoredScene(anchoredBundle, [
    file,
    anchorLoFile,
    anchorHiFile,
  ]);
  const fake = fakes.get('f.txt')!;

  SCRUB_POS.value = 1; // createdIdx, 2 lines
  controller.update();
  const earlyFloors = fake.floors;

  SCRUB_POS.value = 2; // last live commit, 6 lines
  controller.update();
  const lateFloors = fake.floors;

  expect(earlyFloors).toBeLessThanOrEqual(lateFloors);
  expect(earlyFloors).toBeLessThan(lateFloors);
});

test('iFloors: needsUpdate set exactly once per mesh per frame', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 1.5;
  controller.update();
  expect(fake.floorsUpdates).toBe(1);
});

test('iModifiedAge matches the recency direction: 0 at the exact last-modified scrub position (freshest)', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 2; // f.txt's last-modified index
  controller.update();
  expect(fake.modifiedAge).toBeCloseTo(0, 5);
});

test('iModifiedAge grows toward 1 (most stale) as scrub moves away from the last-modified index', () => {
  // f.txt is modified once (commit 1); anchorLo keeps getting re-touched (commit 1,
  // then commit 2). As the scrub advances past anchorLo's later touch, the freshest
  // present last-mod date pulls ahead of the subject, so its relative staleness grows.
  const datedBundle = {
    commits: [
      { sha: 'a', date: isoAt(0) },
      { sha: 'b', date: isoAt(1) },
      { sha: 'c', date: isoAt(2) },
      { sha: 'd', date: isoAt(3) },
    ],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      { sha: 'a', changes: [{ path: 'anchorHi.txt', sha: 'hi' }] },
      {
        sha: 'b',
        changes: [
          { path: 'f.txt', sha: 's1' },
          { path: 'anchorLo.txt', sha: 'lo' },
        ],
      },
      { sha: 'c', changes: [{ path: 'anchorLo.txt', sha: 'lo' }] },
      { sha: 'd', changes: [{ path: 'f.txt', sha: null }] },
    ],
    blobLines: { s1: 6, lo: 1, hi: 200 },
    note: null,
  } as unknown as TimelineBundle;

  const { controller, fakes } = makeAnchoredScene(datedBundle, [file, anchorLoFile, anchorHiFile]);
  const fake = fakes.get('f.txt')!;
  SCRUB_POS.value = 1.5; // anchorLo's latest touch is still commit 1, tied with the subject
  controller.update();
  const atModified = fake.modifiedAge;

  SCRUB_POS.value = 2.5; // anchorLo re-touched at commit 2, now the freshest present file
  controller.update();
  const afterModified = fake.modifiedAge;

  expect(afterModified).toBeGreaterThan(atModified);
});

test('iModifiedAge: needsUpdate set exactly once per mesh per frame', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 2;
  controller.update();
  expect(fake.modifiedAgeUpdates).toBe(1);
});

test('iIconUV.w (createdAge) is 0 at the exact scrub-position creation index (newest)', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 1; // f.txt's createdIdx
  controller.update();
  expect(fake.iconUvW).toBeCloseTo(0, 5);
});

test('iIconUV.w grows toward 1 (oldest) as scrub moves away from the created index', () => {
  // f.txt is created at commit 1; anchorOld predates it (commit 0) and anchorNew is
  // created later (commit 2). Once anchorNew appears, the newest present creation date
  // pulls ahead of the subject, so the subject reads as relatively older (createdAge↑).
  const anchorNewFile = {
    path: 'anchorNew.txt',
    lines: 1,
    size: 100,
    extension: 'txt',
  } as unknown as FileNode;
  const datedBundle = {
    commits: [
      { sha: 'a', date: isoAt(0) }, // anchorOld created (oldest)
      { sha: 'b', date: isoAt(1) }, // f.txt created (subject)
      { sha: 'c', date: isoAt(2) }, // anchorNew created (newest)
      { sha: 'd', date: isoAt(3) },
    ],
    unionManifest: { tree: { name: 'r' } },
    deltas: [
      { sha: 'a', changes: [{ path: 'anchorLo.txt', sha: 'lo' }] },
      { sha: 'b', changes: [{ path: 'f.txt', sha: 's1' }] },
      { sha: 'c', changes: [{ path: 'anchorNew.txt', sha: 'nw' }] },
      { sha: 'd', changes: [] },
    ],
    blobLines: { s1: 6, lo: 1, nw: 1 },
    note: null,
  } as unknown as TimelineBundle;

  const { controller, fakes } = makeAnchoredScene(datedBundle, [file, anchorLoFile, anchorNewFile]);
  const fake = fakes.get('f.txt')!;
  SCRUB_POS.value = 1; // subject's creation index; only it + anchorOld are present
  controller.update();
  const atCreated = fake.iconUvW;

  SCRUB_POS.value = 2; // anchorNew now present, created after the subject
  controller.update();
  const later = fake.iconUvW;

  expect(later).toBeGreaterThan(atCreated);
  // createdAge = 1 - (subjectCreated - minCreated) / (maxCreated - minCreated)
  const minCreated = Date.parse(isoAt(0)); // anchorOld
  const maxCreated = Date.parse(isoAt(2)); // anchorNew
  const createdMs = Date.parse(isoAt(1)); // subject
  expect(later).toBeCloseTo(1 - (createdMs - minCreated) / (maxCreated - minCreated), 5); // 0.5
});

test('iIconUV.w: needsUpdate set exactly once per mesh per frame', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 1.5;
  controller.update();
  expect(fake.iconUvUpdates).toBe(1);
});

test('absent buildings leave iFloors/iModifiedAge/iIconUV.w untouched (not overwritten with stale/garbage values)', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 0.5; // before createdIdx = 1: absent
  controller.update();
  expect(fake.floorsUpdates).toBe(0);
  expect(fake.modifiedAgeUpdates).toBe(0);
  expect(fake.iconUvUpdates).toBe(0);
});

test('weathering: sets instanceColor.needsUpdate exactly once per mesh', () => {
  const { fake, controller } = setup();
  SCRUB_POS.value = 2;
  controller.update();
  expect(fake.colorUpdates).toBe(1);
});

// ── Future files (render as an ultra-low tinted slab while scrubbed before them) ──

test('future: a not-yet-created building renders as an ultra-low tinted slab', () => {
  BLUEPRINTS.value = {
    ...BLUEPRINTS.value,
    ENABLED: true,
    BUILDING_OPACITY: 0.4,
    BUILDING_COLOR: '#00ffff',
    BUILDING_TINT: 1, // full tint → pure building color, independent of the file hue
  };
  const { b, fake, controller } = setup();
  SCRUB_POS.value = 0.5; // before f.txt's creation at commit 1 → future
  controller.update();

  const slabHeight = FUTURE_SLAB_FLOORS * BUILDING_DIMENSIONS.value.FLOOR_HEIGHT;
  expect(fake.scaleY).toBeCloseTo(slabHeight, 5); // an ultra-low slab, far shorter than the real building
  expect(fake.scaleY).toBeLessThan(b.h);
  expect(fake.scaleX).toBeCloseTo(b.w, 5); // at the building's real footprint width
  expect(fake.scaleZ).toBeCloseTo(b.d, 5);
  expect(fake.iFadeX).toBeCloseTo(0.4, 5); // uniform future opacity, no distance fade
  // At full tint (1) the slab is the building color (cyan), not the file's hue.
  expect(fake.lastColor).not.toBeNull();
  expect(fake.lastColor!.r).toBeCloseTo(0, 5);
  expect(fake.lastColor!.g).toBeCloseTo(1, 5);
  expect(fake.lastColor!.b).toBeCloseTo(1, 5);
});

test('future: at tint 0 the slab keeps its own file hue, not the building color', () => {
  BLUEPRINTS.value = { ...BLUEPRINTS.value, ENABLED: true, BUILDING_COLOR: '#00ffff', BUILDING_TINT: 0 };
  const { fake, controller } = setup();
  SCRUB_POS.value = 0.5;
  controller.update();
  const fileHue = new THREE.Color(
    getBuildingColorForRecency(
      file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
      0.5 // FUTURE_BASE_RECENCY
    )
  );
  expect(fake.lastColor).not.toBeNull();
  expect(colorDist(fake.lastColor!, fileHue)).toBeCloseTo(0, 5);
});

test('future: opacity is uniform regardless of how far ahead the creation is', () => {
  BLUEPRINTS.value = { ...BLUEPRINTS.value, ENABLED: true, BUILDING_OPACITY: 0.3 };
  const { fake, controller } = setup();
  SCRUB_POS.value = 0; // furthest before creation
  controller.update();
  const far = fake.iFadeX;
  SCRUB_POS.value = 0.9; // just before creation
  controller.update();
  expect(fake.iFadeX).toBeCloseTo(far, 5); // no distance fade
  expect(fake.iFadeX).toBeCloseTo(0.3, 5);
});

test('future: with future files off, a not-yet-created building stays hidden', () => {
  BLUEPRINTS.value = { ...BLUEPRINTS.value, ENABLED: false };
  const { fake, controller } = setup();
  SCRUB_POS.value = 0.5;
  controller.update();
  expect(fake.scaleY).toBe(0);
  expect(fake.iFadeX).toBe(0);
});

test('future roads always render: a non-present, non-ruin street is a future road (tint 2)', () => {
  // With future on, EVERY road that isn't present or ruin renders as a future
  // road — even a street with no future building detected on it directly. So the
  // whole road network shows from the start of history, fully opaque, set apart by color.
  BLUEPRINTS.value = { ...BLUEPRINTS.value, ENABLED: true };
  const rootStreet = { dir: { path: ROOT_PATH }, isRoot: true } as unknown as Street;
  const dStreet = { dir: { path: 'd' } } as unknown as Street; // no buildings at all

  const index = new BuildingIndex();
  index.insert({
    x: 0,
    y: 0,
    w: 2,
    d: 2,
    h: buildingHeightForLines(file, 6, heightCtx),
    color: '#fff',
    file,
    cellId: 0,
    slotId: 0,
  } as unknown as Building);

  const opacityByStreet = new Map<Street, number>();
  const tintByStreet = new Map<Street, number>();
  const streets = {
    setStreetOpacity: (street: Street, opacity: number, tint: number) => {
      opacityByStreet.set(street, opacity);
      tintByStreet.set(street, tint);
    },
    setStreetLabelOpacity: () => {},
  };

  const fake = makeFakeMesh();
  const timelines = buildPathTimelines(bundle);
  const controller = createScrubController({
    getBuildingIndex: () => index,
    getAdPanels: () => null,
    getMeshForBuilding: () => ({ mesh: fake.mesh, slot: 0 }),
    timelines,
    heightCtx,
    footprints: noopFootprints,
    streets,
    streetsByDir: { [ROOT_PATH]: rootStreet, d: dStreet },
    picker: mockPicker(),
    trees: noopTrees,
    fireflies: noopFireflies,
  });

  SCRUB_POS.value = 0.5; // before f.txt's creation: root empty, d never has a file
  controller.update();

  expect(opacityByStreet.get(rootStreet)).toBe(1); // root always renders
  expect(opacityByStreet.get(dStreet)).toBe(1); // future road, fully opaque
  expect(tintByStreet.get(dStreet)).toBe(2); // future tint
});
