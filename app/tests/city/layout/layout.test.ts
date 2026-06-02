import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getStreetWidth,
  getBuildingDimensions,
  layoutCity,
  sortForRendering,
  computeLineStats,
  __test,
} from '@/city/layout/layout';
import type { Rect } from '@/city/layout/layout';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { BuildingOrient, NodeKind, StreetAxis } from '@/types';
import type { BuildingDimensionsConfig } from '@/state/stores/settings/buildings';
import type { StreetTier } from '@/state/stores/settings/streets';
import {
  assertNoOverlap,
  assertStemOrder,
  assertTreeRespecting,
  assertTJunctionsValid,
} from '../../_helpers/layoutAsserts';
import { mkFile, mkDir } from '../../_helpers/cityFixtures';

const TEST_TIERS: StreetTier[] = [
  { min_descendants: 0, width: 10 },
  { min_descendants: 4, width: 16 },
  { min_descendants: 9, width: 24 },
  { min_descendants: 16, width: 36 },
  { min_descendants: 31, width: 52 },
];

// Test-time config for getBuildingDimensions / layoutCity. Mutated into
// the BUILDING_DIMENSIONS store by beforeEach; restored by afterEach.
const TEST_BUILDING_DIMS: Partial<BuildingDimensionsConfig> = {
  MIN_FLOORS: 1,
  MAX_FLOORS: 30,
  FLOOR_HEIGHT: 10,
  MIN_WIDTH: 6,
  MAX_WIDTH: 40,
};

let _origBuildingDims: BuildingDimensionsConfig | null = null;
beforeEach(() => {
  _origBuildingDims = { ...BUILDING_DIMENSIONS.value };
  BUILDING_DIMENSIONS.value = { ...BUILDING_DIMENSIONS.value, ...TEST_BUILDING_DIMS };
});
afterEach(() => {
  if (!_origBuildingDims) return;
  BUILDING_DIMENSIONS.value = _origBuildingDims;
});

const TEST_TREE = {
  name: 'project',
  type: NodeKind.Directory,
  path: '.',
  fullPath: '/tmp/project',
  children_count: 3,
  children_file_count: 2,
  children_dir_count: 1,
  descendants_count: 4,
  descendants_file_count: 3,
  descendants_dir_count: 1,
  descendants_size: 5000,
  children: [
    {
      name: 'index.ts',
      type: NodeKind.File,
      path: 'index.ts',
      fullPath: '/tmp/project/index.ts',
      extension: '.ts',
      size: 2000,
      lines: 80,
      binary: false,
      created: '2024-01-10T09:00:00Z',
      modified: '2024-03-22T14:30:00Z',
      git: {
        created: '2024-01-10T09:00:00Z',
        modified: '2024-03-22T14:30:00Z',
        commits: 5,
        contributors: ['alice'],
      },
    },
    {
      name: 'README.md',
      type: NodeKind.File,
      path: 'README.md',
      fullPath: '/tmp/project/README.md',
      extension: '.md',
      size: 500,
      lines: 20,
      binary: false,
      created: '2024-01-10T09:00:00Z',
      modified: '2024-01-10T09:00:00Z',
      git: {
        created: '2024-01-10T09:00:00Z',
        modified: '2024-01-10T09:00:00Z',
        commits: 1,
        contributors: ['alice'],
      },
    },
    {
      name: 'src',
      type: NodeKind.Directory,
      path: 'src',
      fullPath: '/tmp/project/src',
      children_count: 1,
      children_file_count: 1,
      children_dir_count: 0,
      descendants_count: 1,
      descendants_file_count: 1,
      descendants_dir_count: 0,
      descendants_size: 800,
      children: [
        {
          name: 'utils.ts',
          type: NodeKind.File,
          path: 'src/utils.ts',
          fullPath: '/tmp/project/src/utils.ts',
          extension: '.ts',
          size: 800,
          lines: 30,
          binary: false,
          created: '2024-02-15T10:00:00Z',
          modified: '2024-03-20T12:00:00Z',
          git: {
            created: '2024-02-15T10:00:00Z',
            modified: '2024-03-20T12:00:00Z',
            commits: 3,
            contributors: ['bob'],
          },
        },
      ],
    },
  ],
};

// ---- getStreetWidth ----
describe('getStreetWidth', () => {
  it('count 0 → first tier width (10)', () => expect(getStreetWidth(0, TEST_TIERS)).toBe(10));
  it('count 3 → first tier width (10)', () => expect(getStreetWidth(3, TEST_TIERS)).toBe(10));
  it('count 4 → second tier width (16)', () => expect(getStreetWidth(4, TEST_TIERS)).toBe(16));
  it('count 8 → second tier width (16)', () => expect(getStreetWidth(8, TEST_TIERS)).toBe(16));
  it('count 9 → third tier width (24)', () => expect(getStreetWidth(9, TEST_TIERS)).toBe(24));
  it('count 15 → third tier width (24)', () => expect(getStreetWidth(15, TEST_TIERS)).toBe(24));
  it('count 16 → fourth tier width (36)', () => expect(getStreetWidth(16, TEST_TIERS)).toBe(36));
  it('count 30 → fourth tier width (36)', () => expect(getStreetWidth(30, TEST_TIERS)).toBe(36));
  it('count 31 → fifth tier width (52)', () => expect(getStreetWidth(31, TEST_TIERS)).toBe(52));
  it('count 100 → fifth tier width (52)', () => expect(getStreetWidth(100, TEST_TIERS)).toBe(52));
  it('falls back to built-in tiers if none provided', () => {
    expect(getStreetWidth(0)).toBe(32);
    expect(getStreetWidth(100)).toBe(128);
  });
});

// ---- getBuildingDimensions ----
//
// Heights are sqrt-normalized across the project's line-count range:
// smallest file → min_floors, largest → max_floors, midrange via sqrt.
// Without lineStats, the safe default is min_floors.
describe('getBuildingDimensions', () => {
  it('null/zero data returns min_floors and min width', () => {
    const dim = getBuildingDimensions({ lines: null, size: null });
    expect(dim.floors).toBe(1);
    expect(dim.h).toBe(10);
    expect(dim.w).toBe(6);
  });

  it('depth == width (square footprint)', () => {
    const dim = getBuildingDimensions({ lines: 80, size: 2000 }, { min: 10, max: 1000 });
    expect(dim.d).toBe(dim.w);
  });

  it('zero lines treated as 1 (no -Infinity)', () => {
    const dim = getBuildingDimensions({ lines: 0, size: 0 });
    expect(dim.floors).toBe(1);
    expect(dim.h).toBe(10);
    expect(dim.w).toBe(6);
  });

  it('smallest file in the project maps to min_floors', () => {
    const dim = getBuildingDimensions({ lines: 10, size: 100 }, { min: 10, max: 1000 });
    expect(dim.floors).toBe(1);
  });

  it('largest file in the project maps to max_floors', () => {
    const dim = getBuildingDimensions({ lines: 1000, size: 10000 }, { min: 10, max: 1000 });
    expect(dim.floors).toBe(TEST_BUILDING_DIMS.MAX_FLOORS);
  });

  it('midrange file uses sqrt-interpolated floors', () => {
    // sMin=sqrt(10)=3.162, sMax=sqrt(1000)=31.62, sLines=sqrt(100)=10
    // t = (10 - 3.162) / (31.62 - 3.162) ≈ 0.240
    // floors ≈ round(1 + 0.240 * 29) = round(7.96) = 8
    const dim = getBuildingDimensions({ lines: 100, size: 1000 }, { min: 10, max: 1000 });
    expect(dim.floors).toBe(8);
  });

  it('without lineStats falls back to min_floors', () => {
    const dim = getBuildingDimensions({ lines: 80, size: 2000 });
    expect(dim.floors).toBe(TEST_BUILDING_DIMS.MIN_FLOORS);
  });

  it('lineStats with min == max collapses everyone to min_floors', () => {
    const dim = getBuildingDimensions({ lines: 50, size: 500 }, { min: 50, max: 50 });
    expect(dim.floors).toBe(1);
  });

  it('huge files cap at max_floors (no runaway towers)', () => {
    // Without an upper cap the tallest file would dwarf the rest of the
    // city. Verify the cap is still enforced.
    BUILDING_DIMENSIONS.value = { ...BUILDING_DIMENSIONS.value, MAX_FLOORS: 5 };
    const dim = getBuildingDimensions({ lines: 100000, size: 100000 }, { min: 1, max: 100000 });
    expect(dim.floors).toBeLessThanOrEqual(5);
  });

  // ---- Width / byteStats ----
  // Width is log-normalized over the project's own byte range, mirroring
  // the floors-from-lines mapping.
  it('without byteStats falls back to MIN_WIDTH', () => {
    const dim = getBuildingDimensions({ lines: 80, size: 2000 }, { min: 10, max: 1000 });
    expect(dim.w).toBe(TEST_BUILDING_DIMS.MIN_WIDTH);
  });

  it('smallest file in the byte range maps to MIN_WIDTH', () => {
    const dim = getBuildingDimensions(
      { lines: 80, size: 100 },
      { min: 10, max: 1000 },
      { min: 100, max: 100000 }
    );
    expect(dim.w).toBe(TEST_BUILDING_DIMS.MIN_WIDTH);
  });

  it('largest file in the byte range maps to MAX_WIDTH', () => {
    const dim = getBuildingDimensions(
      { lines: 80, size: 100000 },
      { min: 10, max: 1000 },
      { min: 100, max: 100000 }
    );
    expect(dim.w).toBe(TEST_BUILDING_DIMS.MAX_WIDTH);
  });

  it('byteStats with min == max collapses width to MIN_WIDTH', () => {
    const dim = getBuildingDimensions(
      { lines: 80, size: 500 },
      { min: 10, max: 1000 },
      { min: 500, max: 500 }
    );
    expect(dim.w).toBe(TEST_BUILDING_DIMS.MIN_WIDTH);
  });
});

// ---- getBuildingDimensions for media files ----
//
// Media files (image/video) get an aspect-driven height: building's
// silhouette mirrors the image. Width still comes from bytes; height
// = floors × FLOOR_HEIGHT where floors snaps to round(width × aspect
// / FLOOR_HEIGHT). Missing dims → square fallback (aspect = 1).
describe('getBuildingDimensions — media files', () => {
  const PNG = '.png';

  it('media file without dims falls back to square (aspect=1)', () => {
    const dim = getBuildingDimensions(
      { lines: 0, size: 1000, extension: PNG },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    // Square aspect → floors = round(width / FLOOR_HEIGHT), min MIN_FLOORS.
    expect(dim.d).toBe(dim.w);
    expect(dim.floors).toBeGreaterThanOrEqual(TEST_BUILDING_DIMS.MIN_FLOORS);
    // raw_h ≈ width; height = floors × FLOOR_HEIGHT.
    expect(dim.h).toBe(dim.floors * TEST_BUILDING_DIMS.FLOOR_HEIGHT);
  });

  it('portrait image gives a tall building (height > width)', () => {
    const dim = getBuildingDimensions(
      { lines: 0, size: 1000, extension: PNG, media_width: 100, media_height: 200 },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    expect(dim.h).toBeGreaterThan(dim.w);
  });

  it('landscape image gives a short wide building (height < width)', () => {
    const dim = getBuildingDimensions(
      { lines: 0, size: 1000, extension: PNG, media_width: 200, media_height: 50 },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    // Aspect 0.25 → raw_h = width × 0.25, but clamped at 0.4 → raw_h ≥ 0.4w.
    // Still: height < width.
    expect(dim.h).toBeLessThan(dim.w);
  });

  it('clamps very tall portrait at aspect 2.5', () => {
    // Aspect 10 (5000 / 500) clamps to 2.5.
    const dim = getBuildingDimensions(
      { lines: 0, size: 1000, extension: PNG, media_width: 500, media_height: 5000 },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    // raw_h = w × 2.5, floors = round(raw_h / FLOOR_HEIGHT), h = floors × FLOOR_HEIGHT.
    const expectedFloors = Math.max(
      TEST_BUILDING_DIMS.MIN_FLOORS,
      Math.round((dim.w * 2.5) / TEST_BUILDING_DIMS.FLOOR_HEIGHT)
    );
    expect(dim.floors).toBe(expectedFloors);
  });

  it('clamps very wide panorama at aspect 0.4', () => {
    const dim = getBuildingDimensions(
      { lines: 0, size: 1000, extension: PNG, media_width: 5000, media_height: 500 },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    const expectedFloors = Math.max(
      TEST_BUILDING_DIMS.MIN_FLOORS,
      Math.round((dim.w * 0.4) / TEST_BUILDING_DIMS.FLOOR_HEIGHT)
    );
    expect(dim.floors).toBe(expectedFloors);
  });

  it('non-media file ignores media_width/media_height', () => {
    // Should follow the normal lines-based height path.
    const dim = getBuildingDimensions(
      { lines: 100, size: 1000, extension: '.ts', media_width: 9999, media_height: 1 },
      { min: 10, max: 1000 },
      { min: 10, max: 10000 }
    );
    // Height should be lines-derived (sqrt-interpolation), not byte-aspect-derived.
    // For a non-media file the media_* fields are ignored entirely.
    expect(dim.h).toBe(dim.floors * TEST_BUILDING_DIMS.FLOOR_HEIGHT);
    // The clamp-aspect-0.0001 case would have produced a 1-floor building;
    // for a 100-line file the test fixture's sqrt interpolation lands at 8 floors.
    expect(dim.floors).toBeGreaterThan(1);
  });
});

// ---- computeLineStats ----
describe('computeLineStats', () => {
  it('walks the tree and returns min/max non-zero line counts', () => {
    const stats = computeLineStats(TEST_TREE);
    expect(stats.min).toBe(20);
    expect(stats.max).toBe(80);
  });

  it('returns { min: 1, max: 1 } when no files have lines', () => {
    const empty = { name: 'empty', type: NodeKind.Directory, children: [] };
    expect(computeLineStats(empty)).toEqual({ min: 1, max: 1 });
  });

  it('ignores files with null/zero line counts', () => {
    const tree = {
      name: 'r',
      type: NodeKind.Directory,
      children: [
        { name: 'a.js', type: NodeKind.File, lines: 0 },
        { name: 'b.js', type: NodeKind.File, lines: null },
        { name: 'c.js', type: NodeKind.File, lines: 50 },
      ],
    };
    expect(computeLineStats(tree)).toEqual({ min: 50, max: 50 });
  });
});

// ---- layoutCity ----
describe('layoutCity', () => {
  it('returns { streets, buildings } arrays', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(Array.isArray(layout.streets)).toBe(true);
    expect(Array.isArray(layout.buildings)).toBe(true);
  });

  it('has at least 1 street', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(layout.streets.length).toBeGreaterThanOrEqual(1);
  });

  it('produces 3 file buildings for the test tree', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(layout.buildings.length).toBe(3);
  });

  it('every building has x, y, w, d, h, file, orient', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    for (const b of layout.buildings) {
      expect(typeof b.x).toBe('number');
      expect(typeof b.y).toBe('number');
      expect(typeof b.w).toBe('number');
      expect(typeof b.d).toBe('number');
      expect(typeof b.h).toBe('number');
      expect(b.file).toBeTruthy();
      expect(typeof b.orient).toBe('string');
    }
  });

  it('every building starts with color = null', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    for (const b of layout.buildings) {
      expect(b.color).toBeNull();
    }
  });

  it('every street has x, y, length, width, orientation, label, dir', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    for (const s of layout.streets) {
      expect(typeof s.x).toBe('number');
      expect(typeof s.y).toBe('number');
      expect(typeof s.length).toBe('number');
      expect(s.length).toBeGreaterThan(0);
      expect(typeof s.width).toBe('number');
      expect(s.width).toBeGreaterThan(0);
      expect(s.orientation === StreetAxis.X || s.orientation === StreetAxis.Y).toBe(true);
      expect(typeof s.label).toBe('string');
      expect(s.dir).toBeTruthy();
    }
  });

  it('at least one street has a non-empty label', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    const hasLabel = layout.streets.some((s) => s.label && s.label.length > 0);
    expect(hasLabel).toBe(true);
  });

  // Side distribution: a directory full of files should populate both sides
  // of its street, not stack everything onto side 0. We check via building
  // orient (the building's door faces back toward the street, so files on
  // the primary side have orient='s' or 'e' and files on the secondary side
  // have orient='n' or 'w' depending on street orientation).
  it('files distribute across both sides of the street', () => {
    const file = (n: string) => ({
      name: n,
      type: NodeKind.File,
      path: n,
      extension: '.ts',
      size: 500,
      lines: 20,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    });
    const dir = {
      name: 'flat',
      type: NodeKind.Directory,
      path: 'flat',
      children_count: 6,
      descendants_count: 6,
      descendants_size: 3000,
      children: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'].map(file),
    };
    const layout = layoutCity({ tree: dir });
    const orients = new Set(layout.buildings.map((b) => b.orient));
    // Both primary and secondary side orients should appear among 6 buildings.
    const primary = orients.has(BuildingOrient.South) || orients.has(BuildingOrient.East);
    const secondary = orients.has(BuildingOrient.North) || orients.has(BuildingOrient.West);
    expect(primary).toBe(true);
    expect(secondary).toBe(true);
  });

  // The occupancy-based packer enforces a monotonic priorStemX across both
  // sides: alphabetically-earlier children must sit at lower along-axis
  // positions than later ones, regardless of which side they land on. With
  // best-fit area balancing, a flat run of equal-size files distributes
  // across both sides while maintaining alphabetical along-axis order.
  it('files in a flat dir are alphabetically ordered along the street', () => {
    const file = (n: string) => ({
      name: n,
      type: NodeKind.File,
      path: n,
      extension: '.ts',
      size: 500,
      lines: 20,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    });
    const dir = {
      name: 'flat',
      type: NodeKind.Directory,
      path: 'flat',
      children_count: 4,
      descendants_count: 4,
      descendants_size: 2000,
      children: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(file),
    };
    const layout = layoutCity({ tree: dir });
    const street = layout.streets.find((s) => s.dir?.name === 'flat')!;
    const along = street.orientation === StreetAxis.X ? 'x' : 'y';
    const sideAxis = street.orientation === StreetAxis.X ? 'y' : 'x';
    // Distribution: both sides should be populated.
    const sideA = layout.buildings.filter((b) => b[sideAxis] < street[sideAxis]);
    const sideB = layout.buildings.filter((b) => b[sideAxis] > street[sideAxis]);
    expect(sideA.length).toBeGreaterThan(0);
    expect(sideB.length).toBeGreaterThan(0);
    // Stem-order: walking the buildings sorted alphabetically by file name
    // should yield a monotonically non-decreasing along-axis sequence.
    const sortedByName = layout.buildings
      .slice()
      .sort((p, q) => (p.file?.name || '').localeCompare(q.file?.name || ''));
    for (let i = 1; i < sortedByName.length; i++) {
      expect(sortedByName[i][along]).toBeGreaterThanOrEqual(sortedByName[i - 1][along]);
    }
  });

  // With best-fit area balancing, equal-size files still pair symmetrically:
  // the first file on side 0 makes side 1 the smaller-area side, and the next
  // equal-size file lands on side 1 at the same stem-x.
  it('files on opposite sides sit directly across (paired)', () => {
    const file = (n: string) => ({
      name: n,
      type: NodeKind.File,
      path: n,
      extension: '.ts',
      size: 500,
      lines: 20,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    });
    const dir = {
      name: 'flat',
      type: NodeKind.Directory,
      path: 'flat',
      children_count: 4,
      descendants_count: 4,
      descendants_size: 2000,
      children: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(file),
    };
    const layout = layoutCity({ tree: dir });
    const street = layout.streets.find((s) => s.dir?.name === 'flat')!;
    const along = street.orientation === StreetAxis.X ? 'x' : 'y';
    const sideAxis = street.orientation === StreetAxis.X ? 'y' : 'x';
    const sideA = layout.buildings.filter((b) => b[sideAxis] < street[sideAxis]);
    const sideB = layout.buildings.filter((b) => b[sideAxis] > street[sideAxis]);
    expect(sideA.length).toBeGreaterThan(0);
    expect(sideB.length).toBeGreaterThan(0);
    sideA.sort((p, q) => p[along] - q[along]);
    sideB.sort((p, q) => p[along] - q[along]);
    expect(Math.abs(sideA[0][along] - sideB[0][along])).toBeLessThan(0.01);
  });
});

// ---- Deeply-nested orient correctness ----
//
// Exercises the mirror-orient fix. Builds a tree deep enough that a grandchild
// file goes through TWO levels of mirroring (x-parent primary side → y-subdir
// primary side → x-sub-subdir with a file), then verifies every building's
// orient still points toward its own street after all the coordinate flips.
describe('orient correctness for mirrored subtrees', () => {
  function makeFile(name) {
    return {
      name,
      type: NodeKind.File,
      path: name,
      extension: '.ts',
      size: 500,
      lines: 20,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    };
  }
  function makeDir(name, children) {
    return {
      name,
      type: NodeKind.Directory,
      path: name,
      children_count: children.length,
      descendants_count:
        children.length + children.filter((c) => c.type === NodeKind.Directory).length,
      descendants_size: 1000,
      children,
    };
  }

  // Tree: root has several subdirs spanning all sideIdx combinations.
  // aaaa/ (ci=0) -> primary side of root: negateY
  //   inner/ (ci=0) -> primary side of aaaa: negateX
  //     f1.ts (file, orient='s' locally after being in inner-x-street)
  //     f2.ts
  // bbbb/ (ci=1) -> secondary side of root: no mirror
  //   f3.ts
  const TREE = makeDir('root', [
    makeDir('aaaa', [makeDir('inner', [makeFile('f1.ts'), makeFile('f2.ts')])]),
    makeDir('bbbb', [makeFile('f3.ts')]),
    makeDir('cccc', [makeFile('f4.ts')]),
    makeDir('dddd', [makeFile('f5.ts')]),
  ]);

  // For each building, verify its door-facing direction actually points at its
  // adjacent street. We find the nearest street and check the direction matches.
  it('every building has orient pointing toward its adjacent street', () => {
    const layout = layoutCity({ tree: TREE });

    for (const b of layout.buildings) {
      // Compute the door-face direction in world coords from orient.
      let doorDX = 0,
        doorDY = 0;
      if (b.orient === 's')
        doorDY = 1; // +y
      else if (b.orient === 'n') doorDY = -1;
      else if (b.orient === 'e')
        doorDX = 1; // +x
      else if (b.orient === 'w') doorDX = -1;

      // Building edge in the direction of the door.
      const edgeX = b.x + (doorDX * b.w) / 2;
      const edgeY = b.y + (doorDY * b.d) / 2;

      // Find the closest street AHEAD OF the door along its facing direction.
      // The door should be within a few units of some street's footprint.
      let matched = false;
      for (const s of layout.streets) {
        // Compute s's footprint rect
        const halfL = s.length / 2;
        const halfW = s.width / 2;
        let sx1, sx2, sy1, sy2;
        if (s.orientation === StreetAxis.X) {
          sx1 = s.x - halfL;
          sx2 = s.x + halfL;
          sy1 = s.y - halfW;
          sy2 = s.y + halfW;
        } else {
          sx1 = s.x - halfW;
          sx2 = s.x + halfW;
          sy1 = s.y - halfL;
          sy2 = s.y + halfL;
        }
        // Probe a point a few units in front of the door.
        const probeX = edgeX + doorDX * 15;
        const probeY = edgeY + doorDY * 15;
        if (probeX >= sx1 && probeX <= sx2 && probeY >= sy1 && probeY <= sy2) {
          matched = true;
          break;
        }
      }
      expect(matched).toBe(true);
    }
  });
});

// ---- sortForRendering ----
describe('sortForRendering', () => {
  it('sorts back-to-front (lowest x+y first — behind draws first)', () => {
    const unsorted = [
      { x: 5, y: 5, id: 'near' },
      { x: 20, y: 20, id: 'far' },
      { x: 10, y: 10, id: 'mid' },
    ];
    const sorted = sortForRendering(unsorted);
    // Lowest x+y = behind (north/west), drawn first
    // Highest x+y = in front (south/east), drawn last (on top)
    expect(sorted[0].id).toBe('near');
    expect(sorted[1].id).toBe('mid');
    expect(sorted[2].id).toBe('far');
  });

  it('does not mutate original array', () => {
    const original = [
      { x: 5, y: 5, id: 'close' },
      { x: 20, y: 20, id: 'far' },
    ];
    sortForRendering(original);
    expect(original[0].id).toBe('close');
  });

  it('handles single element', () => {
    const sorted = sortForRendering([{ x: 0, y: 0 }]);
    expect(sorted.length).toBe(1);
  });

  it('handles empty array', () => {
    const sorted = sortForRendering([]);
    expect(sorted.length).toBe(0);
  });
});

// ---- Internal helpers ----
describe('_rectsOverlap', () => {
  const { _rectsOverlap } = __test;
  it('overlapping rects return true', () => {
    expect(_rectsOverlap({ x: 0, y: 0, w: 10, d: 10 }, { x: 5, y: 5, w: 10, d: 10 })).toBe(true);
  });
  it('disjoint rects return false', () => {
    expect(_rectsOverlap({ x: 0, y: 0, w: 10, d: 10 }, { x: 100, y: 0, w: 10, d: 10 })).toBe(false);
  });
  it('touching edges return false (childGap-apart abutment is OK)', () => {
    expect(_rectsOverlap({ x: 0, y: 0, w: 10, d: 10 }, { x: 10, y: 0, w: 10, d: 10 })).toBe(false);
  });
  it('touching edges on Y axis return false', () => {
    expect(_rectsOverlap({ x: 0, y: 0, w: 10, d: 10 }, { x: 0, y: 10, w: 10, d: 10 })).toBe(false);
  });
  it('one contains the other returns true', () => {
    expect(_rectsOverlap({ x: 0, y: 0, w: 100, d: 100 }, { x: 0, y: 0, w: 5, d: 5 })).toBe(true);
  });
  it('sub-femto overlap (FP noise) is treated as touching', () => {
    // Simulate the 7e-15 overlap that arose from translating touching rects
    // through non-integer offsets (e.g. center=63.6 computed two different ways).
    const a = { x: 0, y: 0, w: 2, d: 2 };
    const b = { x: 2 - 7e-15, y: 0, w: 2, d: 2 };
    expect(_rectsOverlap(a, b)).toBe(false);
  });
});

describe('_bboxOfRects', () => {
  const { _bboxOfRects } = __test;
  it('empty input returns zero-size rect at origin', () => {
    expect(_bboxOfRects([])).toEqual({ x: 0, y: 0, w: 0, d: 0 });
  });
  it('single rect bbox equals the rect', () => {
    const r: Rect = { x: 5, y: 10, w: 4, d: 6 };
    expect(_bboxOfRects([r])).toEqual({ x: 5, y: 10, w: 4, d: 6 });
  });
  it('union of two rects spans both', () => {
    const a: Rect = { x: 0, y: 0, w: 2, d: 2 }; // x in [-1, 1], y in [-1, 1]
    const b: Rect = { x: 10, y: 10, w: 2, d: 2 }; // x in [9, 11], y in [9, 11]
    // Union: x in [-1, 11] -> center 5, w 12. y in [-1, 11] -> center 5, d 12.
    expect(_bboxOfRects([a, b])).toEqual({ x: 5, y: 5, w: 12, d: 12 });
  });
});

describe('_collectRects', () => {
  const { _collectRects } = __test;
  it('empty input returns empty array', () => {
    expect(_collectRects({})).toEqual([]);
  });
  it('converts X-orient street to long-x short-y rect', () => {
    const rects = _collectRects({
      streets: [
        {
          x: 50,
          y: 10,
          length: 100,
          width: 5,
          orientation: StreetAxis.X,
          label: '',
          dir: { name: '', path: '', type: NodeKind.Directory } as any,
        },
      ],
    });
    expect(rects).toEqual([{ x: 50, y: 10, w: 100, d: 5 }]);
  });
  it('converts Y-orient street to short-x long-y rect', () => {
    const rects = _collectRects({
      streets: [
        {
          x: 10,
          y: 50,
          length: 100,
          width: 5,
          orientation: StreetAxis.Y,
          label: '',
          dir: { name: '', path: '', type: NodeKind.Directory } as any,
        },
      ],
    });
    expect(rects).toEqual([{ x: 10, y: 50, w: 5, d: 100 }]);
  });
  it('passes building rects through unchanged', () => {
    const rects = _collectRects({
      buildings: [
        {
          x: 1,
          y: 2,
          w: 3,
          d: 4,
          h: 5,
          floors: 1,
          file: {} as any,
          color: null as any,
          orient: BuildingOrient.South,
        },
      ],
    });
    expect(rects).toEqual([{ x: 1, y: 2, w: 3, d: 4 }]);
  });
  it('combines streets and buildings in that order', () => {
    const rects = _collectRects({
      streets: [
        {
          x: 0,
          y: 0,
          length: 10,
          width: 2,
          orientation: StreetAxis.X,
          label: '',
          dir: {} as any,
        },
      ],
      buildings: [
        {
          x: 1,
          y: 1,
          w: 1,
          d: 1,
          h: 1,
          floors: 1,
          file: {} as any,
          color: null as any,
          orient: BuildingOrient.South,
        },
      ],
    });
    expect(rects.length).toBe(2);
    expect(rects[0].w).toBe(10); // street
    expect(rects[1].w).toBe(1); // building
  });
});

describe('layout invariants (current packer baseline)', () => {
  it('TEST_TREE has no overlapping rectangles', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(() => assertNoOverlap(layout)).not.toThrow();
  });
  it('TEST_TREE child streets are stem-ordered alphabetically', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(() => assertStemOrder(layout)).not.toThrow();
  });
  it('multi-subdir tree has stem-ordered child streets', () => {
    const tree = mkDir('root', [
      mkDir('aaaa', [mkDir('inner', [mkFile('f1.ts'), mkFile('f2.ts')])]),
      mkDir('bbbb', [mkFile('f3.ts')]),
      mkDir('cccc', [mkFile('f4.ts')]),
      mkDir('dddd', [mkFile('f5.ts')]),
    ]);
    const layout = layoutCity({ tree });
    expect(() => assertStemOrder(layout)).not.toThrow();
  });
  it('flat-files dir has no overlapping rectangles', () => {
    const file = (n: string) => ({
      name: n,
      type: NodeKind.File,
      path: n,
      extension: '.ts',
      size: 500,
      lines: 20,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    });
    const dir = {
      name: 'flat',
      type: NodeKind.Directory,
      path: 'flat',
      children_count: 6,
      descendants_count: 6,
      descendants_size: 3000,
      children: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'].map(file),
    };
    const layout = layoutCity({ tree: dir });
    expect(() => assertNoOverlap(layout)).not.toThrow();
  });
  it('deeply-nested mirror tree has no overlapping rectangles', () => {
    const tree = mkDir('root', [
      mkDir('aaaa', [mkDir('inner', [mkFile('f1.ts'), mkFile('f2.ts')])]),
      mkDir('bbbb', [mkFile('f3.ts')]),
      mkDir('cccc', [mkFile('f4.ts')]),
      mkDir('dddd', [mkFile('f5.ts')]),
    ]);
    const layout = layoutCity({ tree });
    expect(() => assertNoOverlap(layout)).not.toThrow();
  });
  it('layout is deterministic (same input → identical output)', () => {
    const a = layoutCity({ tree: TEST_TREE });
    const b = layoutCity({ tree: TEST_TREE });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('big subtree at root extends backward instead of pushing root forward', () => {
    // C+D fitting: a big subtree under root has alongLow ≪ 0; without the
    // alongLow clamp at root, big sits at low stem-x and its content
    // extends back into the gem-area open space rather than pushing the
    // parent street's length forward to host its bbox right reach. The
    // contract: no overlap, alphabetical stems, AND root street's length
    // stays much smaller than the worst-case "stack every bbox sequentially"
    // bound.
    const big = mkDir('big', [
      mkFile('aa.ts'),
      mkFile('bb.ts'),
      mkFile('cc.ts'),
      mkFile('dd.ts'),
      mkFile('ee.ts'),
      mkFile('ff.ts'),
    ]);
    const small = mkDir('small', [mkFile('xx.ts')]);
    const root = mkDir('root', [mkFile('a.ts'), big, small]);
    const layout = layoutCity({ tree: root });

    expect(() => assertNoOverlap(layout)).not.toThrow();
    expect(() => assertStemOrder(layout)).not.toThrow();

    const rootStreet = layout.streets.find((s) => s.dir?.name === 'root')!;
    const bigStreet = layout.streets.find((s) => s.dir?.name === 'big')!;
    const along = rootStreet.orientation === StreetAxis.X ? 'x' : 'y';
    // Under the max(W,H) side selection, big's stem lands at roughly 56% of
    // root's road (≈61 units on a ~108-unit road) — not "close to the
    // start" in v2's sense, but still well within the road and well below
    // the open far end. The contract here is that big's stem must stay well
    // within the road (well below the open end) so root's road doesn't have
    // to extend past it to host big's bbox right-reach.
    expect(bigStreet[along]).toBeLessThan(rootStreet.length * 0.75);
  });

  it('B re-compute does not lengthen root street vs pre-compute baseline', () => {
    // Verifies the root street length stays bounded under the packer with the
    // depth=0 two-pass and its guard active. The original concern (B
    // re-compute lengthening root) is now mostly absorbed by the packer's
    // max(W,H) side selection: pre-compute and re-compute often pick the
    // same chosenStemX, so the guard's contribution is small for this
    // tree shape. The guard remains in the code as a defense-in-depth for
    // tree shapes where the packer scoring can still produce divergent passes.
    //
    // Tree shape: root has 1 deep subdir (aaa) followed by 3 small
    // siblings. Measured root length under the packer is ~115.4.
    const tree = mkDir('root', [
      mkDir('aaa', [
        mkDir('inner', [
          mkDir('inner2', [
            mkFile('f1.ts'),
            mkFile('f2.ts'),
            mkFile('f3.ts'),
            mkFile('f4.ts'),
            mkFile('f5.ts'),
          ]),
          mkDir('inner3', [mkFile('g1.ts'), mkFile('g2.ts'), mkFile('g3.ts')]),
        ]),
      ]),
      mkDir('bbb', [mkFile('x.ts')]),
      mkDir('ccc', [mkFile('y.ts')]),
      mkDir('ddd', [mkFile('z.ts')]),
    ]);
    const layout = layoutCity({ tree });
    expect(() => assertNoOverlap(layout)).not.toThrow();
    expect(() => assertStemOrder(layout)).not.toThrow();
    const rootStreet = layout.streets.find((s) => s.isRoot)!;
    // Measured ~115.4 under the packer with the prior STREET_TIERS defaults; after
    // widening tiers (0→32, 4→48, 8→80, 16→96) the natural length is
    // ~264. Threshold scaled to ~300 to keep ~36u headroom while still
    // catching a 2× regression.
    expect(rootStreet.length).toBeLessThan(300);
  });

  it('TEST_TREE is tree-respecting', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(() => assertTreeRespecting(layout)).not.toThrow();
  });

  it('TEST_TREE has valid T-junctions', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(() => assertTJunctionsValid(layout)).not.toThrow();
  });
});

describe('quickjs-scenario regression', () => {
  // Reproduces the failure from screenshots: node_modules has a quickjs
  // child whose own src/ subdir picked the side facing node_modules,
  // forcing the quickjs road to extend back. With the packer, src/ should
  // mirror or pick the other side, keeping quickjs road short.
  function mkFile(name: string) {
    return {
      name,
      type: NodeKind.File,
      path: name,
      extension: '.ts',
      size: 500,
      lines: 20,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    };
  }
  function mkDir(name: string, children: any[], path?: string): any {
    const dirPath = path || name;
    const prefixed = children.map((c) => {
      if (c.type === NodeKind.Directory) {
        return mkDir(c.name, c.children, `${dirPath}/${c.name}`);
      }
      return { ...c, path: `${dirPath}/${c.name}` };
    });
    return {
      name,
      type: NodeKind.Directory,
      path: dirPath,
      children_count: prefixed.length,
      descendants_count:
        prefixed.length +
        prefixed.reduce((acc: number, c: any) => acc + (c.descendants_count || 0), 0),
      descendants_size: 1000,
      children: prefixed,
    };
  }

  it('quickjs road stays short when its src/ branch has space to mirror', () => {
    // Tree:
    //   root/
    //     a-other-pkg/   (medium subdir, alphabetically first under root)
    //       file1.ts ... file10.ts
    //     node_modules/  (big subdir, alphabetically next)
    //       big1.ts ... big8.ts
    //       quickjs/
    //         qf1.ts qf2.ts qf3.ts
    //         src/
    //           sf1.ts sf2.ts
    const tree = mkDir('root', [
      mkDir(
        'a-other-pkg',
        Array.from({ length: 10 }, (_, i) => mkFile(`f${i}.ts`))
      ),
      mkDir('node_modules', [
        ...Array.from({ length: 8 }, (_, i) => mkFile(`big${i}.ts`)),
        mkDir('quickjs', [
          mkFile('qf1.ts'),
          mkFile('qf2.ts'),
          mkFile('qf3.ts'),
          mkDir(
            'src',
            Array.from({ length: 2 }, (_, i) => mkFile(`sf${i}.ts`))
          ),
        ]),
      ]),
    ]);

    const layout = layoutCity({ tree });

    // Invariants must hold.
    assertNoOverlap(layout);
    assertStemOrder(layout);

    // Find the quickjs street and its parent (node_modules).
    const quickjsStreet = layout.streets.find((s) => s.label === 'quickjs');
    const nodeModStreet = layout.streets.find((s) => s.label === 'node_modules');
    expect(quickjsStreet).toBeDefined();
    expect(nodeModStreet).toBeDefined();

    // The bug case: quickjs road extends way past where qf1, qf2, qf3
    // alone would justify, because src/ branched back toward node_modules.
    // For 3 files (each ~8-16 units wide with updated STREET_TIERS) plus
    // end pads, a non-pathological quickjs road length is ~156. The bug
    // produced lengths 2-3× that. We assert quickjs.length < 210 — well
    // above the legitimate floor, well below the bug regime.
    expect(quickjsStreet!.length).toBeLessThan(210);
  });
});
