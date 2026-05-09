import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getStreetWidth,
  getBuildingDimensions,
  layoutCity,
  sortForRendering,
  computeLineStats,
  __test,
} from '@/scene/layout.js';
import type { Rect } from '@/scene/layout.js';
import { BUILDING_DIMENSIONS } from '@/config/index.js';
import { BuildingOrient, NodeKind, StreetAxis } from '@/types';
import type { CityLayout, Street, Building, BuildingPath } from '@/types';
import type { BuildingDimensionsConfig } from '@/config/building.js';
import type { StreetTier } from '@/config/street.js';

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
  _origBuildingDims = { ...BUILDING_DIMENSIONS.get() };
  (Object.keys(TEST_BUILDING_DIMS) as Array<keyof BuildingDimensionsConfig>).forEach((k) => {
    BUILDING_DIMENSIONS.setKey(k, TEST_BUILDING_DIMS[k]!);
  });
});
afterEach(() => {
  if (!_origBuildingDims) return;
  const dims = _origBuildingDims;
  (Object.keys(dims) as Array<keyof BuildingDimensionsConfig>).forEach((k) => {
    BUILDING_DIMENSIONS.setKey(k, dims[k]);
  });
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
    expect(getStreetWidth(0)).toBe(10);
    expect(getStreetWidth(100)).toBe(64);
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
    BUILDING_DIMENSIONS.setKey('MAX_FLOORS', 5);
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
  it('returns { streets, buildings, paths } arrays', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(Array.isArray(layout.streets)).toBe(true);
    expect(Array.isArray(layout.buildings)).toBe(true);
    expect(Array.isArray(layout.paths)).toBe(true);
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
        const probeX = edgeX + doorDX * 5;
        const probeY = edgeY + doorDY * 5;
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
  it('passes path rects through unchanged', () => {
    const rects = _collectRects({
      paths: [{ x: 1, y: 2, w: 3, d: 4, file: {} as any }],
    });
    expect(rects).toEqual([{ x: 1, y: 2, w: 3, d: 4 }]);
  });
  it('combines streets, buildings, and paths in that order', () => {
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
      paths: [{ x: 2, y: 2, w: 2, d: 2, file: {} as any }],
    });
    expect(rects.length).toBe(3);
    expect(rects[0].w).toBe(10); // street
    expect(rects[1].w).toBe(1); // building
    expect(rects[2].w).toBe(2); // path
  });
});

describe('rectsToBuf / bufToRects round-trip', () => {
  const { rectsToBuf, bufToRects, rectCount, rectAt } = __test;

  it('empty round-trip', () => {
    const buf = rectsToBuf([]);
    expect(buf.length).toBe(0);
    expect(rectCount(buf)).toBe(0);
    expect(bufToRects(buf)).toEqual([]);
  });

  it('single rect round-trip', () => {
    const rs: Rect[] = [{ x: 1.5, y: -2.25, w: 3, d: 4.75 }];
    const buf = rectsToBuf(rs);
    expect(rectCount(buf)).toBe(1);
    expect(rectAt(buf, 0)).toEqual({ x: 1.5, y: -2.25, w: 3, d: 4.75 });
    expect(bufToRects(buf)).toEqual(rs);
  });

  it('multi rect round-trip preserves order', () => {
    const rs: Rect[] = [
      { x: 0, y: 0, w: 1, d: 1 },
      { x: 10, y: 20, w: 5, d: 5 },
      { x: -1, y: -2, w: 3, d: 4 },
    ];
    const buf = rectsToBuf(rs);
    expect(rectCount(buf)).toBe(3);
    expect(bufToRects(buf)).toEqual(rs);
  });
});

// ---- Invariant helpers + tests ----
//
// These helpers assert the contract the new packer must satisfy:
//   1. No two world-space rectangles overlap (excluding the documented
//      flat join where each non-root street meets its parent).
//   2. Walking each parent street in +along-axis, child branch points
//      (stems) appear in alphabetical order.
//
// They run against the CURRENT (pre-refactor) packer here as a baseline.
// Task 4 and Task 5 will keep them passing through the algorithm change.

function _rectFromStreet(s: Street): Rect {
  if (s.orientation === StreetAxis.X) {
    return { x: s.x, y: s.y, w: s.length, d: s.width };
  }
  return { x: s.x, y: s.y, w: s.width, d: s.length };
}

function _rectFromBuilding(b: Building): Rect {
  return { x: b.x, y: b.y, w: b.w, d: b.d };
}

function _rectFromPath(p: BuildingPath): Rect {
  return { x: p.x, y: p.y, w: p.w, d: p.d };
}

// True iff a and b strictly intersect; touching edges (zero overlap) returns false.
function _strictlyOverlaps(a: Rect, b: Rect): boolean {
  return __test._rectsOverlap(a, b);
}

// True iff `child` is the parent street of `parent` joining flat — i.e.
// one of these two rects is a child street whose joining end overlaps the
// parent street's body. We tolerate that overlap because the renderer
// flattens the join. Detection: one rect is a street perpendicular to the
// other, and one of its endpoints sits on the other's centerline within
// half a width.
function _isJoinPair(a: Street, b: Street): boolean {
  if (a.orientation === b.orientation) return false;
  // a perpendicular to b — check whether a's joining end touches b's centerline.
  const aLong = a.orientation === StreetAxis.X ? 'x' : 'y';
  const aCross = a.orientation === StreetAxis.X ? 'y' : 'x';
  const bLong = b.orientation === StreetAxis.X ? 'x' : 'y';
  const half = a.length / 2;
  const lowEnd = a[aLong] - half;
  const highEnd = a[aLong] + half;
  // For a perpendicular to b, b's centerline runs along bLong at b[aCross].
  // a's joining endpoint sits ON b's centerline (a constant value of bLong).
  const bCenterAlongA = b[aLong];
  // We assume one of (lowEnd, highEnd) is the join endpoint.
  const dLow = Math.abs(lowEnd - bCenterAlongA);
  const dHigh = Math.abs(highEnd - bCenterAlongA);
  // Likewise the other axis: the joining endpoint's perpendicular value
  // must be within b's half-length of b's center along b's long axis.
  // (i.e. the child's stem x must sit inside the parent's length span)
  const aPerpAtJoin = a[aCross];
  const bCenterPerp = b[bLong];
  // The +0.5 absorbs sub-unit floating-point drift from coordinate arithmetic;
  // the physical gap is zero at a well-formed join.
  const perpClose = Math.abs(aPerpAtJoin - bCenterPerp) <= b.length / 2 + 0.5;
  const longClose = Math.min(dLow, dHigh) <= b.width / 2 + 0.5;
  return perpClose && longClose;
}

// Exported for reuse in Task 4 and Task 5 invariant tests.
export function assertNoOverlap(layout: CityLayout): void {
  type Tagged =
    | { rect: Rect; kind: 'street'; ref: Street }
    | { rect: Rect; kind: 'building'; ref: Building }
    | { rect: Rect; kind: 'path'; ref: BuildingPath };
  const all: Tagged[] = [];
  for (const s of layout.streets) all.push({ rect: _rectFromStreet(s), kind: 'street', ref: s });
  for (const b of layout.buildings)
    all.push({ rect: _rectFromBuilding(b), kind: 'building', ref: b });
  for (const p of layout.paths) all.push({ rect: _rectFromPath(p), kind: 'path', ref: p });

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i],
        B = all[j];
      if (!_strictlyOverlaps(A.rect, B.rect)) continue;
      // Allowed exception: street-street join.
      if (A.kind === 'street' && B.kind === 'street' && _isJoinPair(A.ref, B.ref)) continue;
      throw new Error(
        `overlap between ${A.kind}@(${A.rect.x},${A.rect.y}) and ` +
          `${B.kind}@(${B.rect.x},${B.rect.y})`
      );
    }
  }
}

export function assertStemOrder(layout: CityLayout): void {
  // For each non-leaf street, find the children placed along it (subdir
  // streets with that street as parent + buildings whose orient points
  // toward that street). Sort by name; verify their stem-x along the
  // parent's long axis is monotonic.
  for (const parent of layout.streets) {
    const along = parent.orientation === StreetAxis.X ? 'x' : 'y';
    const cross = parent.orientation === StreetAxis.X ? 'y' : 'x';
    // Child subdir streets: perpendicular orientation, joining this parent.
    const childStreets = layout.streets.filter(
      (s) => s !== parent && s.orientation !== parent.orientation && _isJoinPair(s, parent)
    );
    // Child buildings: orient faces this parent. Building's own (x or y)
    // perpendicular distance to parent's centerline ≈ parent's halfWidth + path + halfDepth.
    const childBuildings = layout.buildings.filter((b) => {
      const perpDist = Math.abs(b[cross] - parent[cross]);
      const expected = parent.width / 2 + 0.5; // path/building offset varies; allow generous slop
      return perpDist > 0 && perpDist < expected + 50; // any building near this parent
    });
    type ChildSpec = { name: string; stemAlong: number };
    const specs: ChildSpec[] = [];
    for (const cs of childStreets) {
      specs.push({ name: cs.label || cs.dir?.name || '', stemAlong: cs[along] });
    }
    for (const cb of childBuildings) {
      specs.push({ name: cb.file?.name || '', stemAlong: cb[along] });
    }
    if (specs.length < 2) continue;
    // We can't reliably attribute every building to its true parent in
    // this heuristic walk — too many false positives for tests to be
    // useful in absolute terms. Instead, just verify that among CHILD
    // STREETS specifically (which we can disambiguate via _isJoinPair),
    // the alphabetical order matches the along-axis order.
    const streetSpecs = specs
      .filter((sp) =>
        layout.streets.some(
          (s) => s.orientation !== parent.orientation && (s.label || '') === sp.name
        )
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 1; i < streetSpecs.length; i++) {
      if (streetSpecs[i].stemAlong < streetSpecs[i - 1].stemAlong) {
        throw new Error(
          `stem-x out of order along ${parent.label || parent.dir?.path}: ` +
            `${streetSpecs[i - 1].name}@${streetSpecs[i - 1].stemAlong} → ` +
            `${streetSpecs[i].name}@${streetSpecs[i].stemAlong}`
        );
      }
    }
  }
}

describe('layout invariants (current packer baseline)', () => {
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
  function mkDir(name: string, children: any[]) {
    // Re-prefix every descendant's `path` so the test fixture mirrors a real
    // manifest (file paths are dir-prefixed, e.g. 'big/aa.ts'). Without this,
    // mkFile children carry only their bare name and tests that filter by
    // path prefix to identify a subdir's descendants find nothing.
    const prefixed = children.map((c) => {
      const oldPath = c.path || c.name;
      return { ...c, path: `${name}/${oldPath}` };
    });
    return {
      name,
      type: NodeKind.Directory,
      path: name,
      children_count: prefixed.length,
      descendants_count:
        prefixed.length + prefixed.filter((c) => c.type === NodeKind.Directory).length,
      descendants_size: 1000,
      children: prefixed,
    };
  }

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

    // big's stem should be at (or near) the gem clearance — i.e., big sits
    // close to root's origin instead of being pushed forward by its own
    // alongLow extent.
    const rootStreet = layout.streets.find((s) => s.dir?.name === 'root')!;
    const bigStreet = layout.streets.find((s) => s.dir?.name === 'big')!;
    const along = rootStreet.orientation === StreetAxis.X ? 'x' : 'y';
    // Big should be close to the start of root's pavement, not pushed
    // halfway down it. Without the C+D fix, big.stemX would be at
    // ~originPad + 18 (clamp by alongLow=-18); with the fix, it's at
    // ~originPad. Set the threshold conservatively: less than the root's
    // overall length, well clear of the cap end.
    expect(bigStreet[along]).toBeLessThan(rootStreet.length / 2);
  });

  it('B re-compute does not lengthen root street vs pre-compute baseline', () => {
    // Regression for the asymmetric pre-seed two-pass (commit 6faf2bf):
    // the re-computed envelope can flip the chosenSide of a grandchild
    // (because the tighter pre-seed shifts which side wins
    // _slideUntilClear), producing a top-envelope with LARGER max-along
    // than the pre-compute had. Adopting that re-compute pushes
    // subsequent siblings out and lengthens the root street — the
    // opposite of B's intent. Guard: only adopt re-compute when its
    // top-envelope is no worse than pre-compute's.
    //
    // Tree shape: root has 1 deep subdir (aaa) followed by 3 small
    // siblings. aaa's content layout flips between the two passes for
    // this tree. Without the guard, root length jumps from ~88 to
    // ~115 (a ~30% inflation, visible as a long road into empty space
    // in the rendered scene).
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
    const rootStreet = layout.streets.find((s) => s.isRoot)!;
    // Pre-B baseline for this tree was 88.4. With the regression (no
    // guard), it ballooned to 115.4. A threshold of 100 catches the
    // regression with margin for unrelated layout-tunable shifts.
    expect(rootStreet.length).toBeLessThan(100);
  });
});

describe('Contour basics', () => {
  const { _emptyContour, _appendSegment, _contourAt } = __test;

  it('empty contour has len 0 and default capacity', () => {
    const c = _emptyContour();
    expect(c.len).toBe(0);
    expect(c.buf.length).toBe(32 * 4);
  });

  it('append single segment', () => {
    const c = _emptyContour();
    _appendSegment(c, 0, 10, 5);
    expect(c.len).toBe(1);
    expect(c.buf[0]).toBe(0);
    expect(c.buf[1]).toBe(10);
    expect(c.buf[2]).toBe(5);
  });

  it('append multiple segments', () => {
    const c = _emptyContour();
    _appendSegment(c, 0, 5, 1);
    _appendSegment(c, 5, 10, 2);
    _appendSegment(c, 20, 30, 3);
    expect(c.len).toBe(3);
    expect(c.buf[0]).toBe(0);
    expect(c.buf[5]).toBe(10);
    expect(c.buf[10]).toBe(3);
  });

  it('append degenerate segment (perpLow >= perpHigh) is no-op', () => {
    const c = _emptyContour();
    _appendSegment(c, 5, 5, 1);
    _appendSegment(c, 10, 5, 2);
    expect(c.len).toBe(0);
  });

  it('_contourAt on empty contour returns -Infinity', () => {
    const c = _emptyContour();
    expect(_contourAt(c, 0)).toBe(-Infinity);
    expect(_contourAt(c, 100)).toBe(-Infinity);
  });

  it('_contourAt returns alongValue inside a segment', () => {
    const c = _emptyContour();
    _appendSegment(c, 0, 10, 5);
    expect(_contourAt(c, 5)).toBe(5);
    expect(_contourAt(c, 0)).toBe(5);
  });

  it('_contourAt returns -Infinity outside all segments', () => {
    const c = _emptyContour();
    _appendSegment(c, 0, 10, 5);
    expect(_contourAt(c, 15)).toBe(-Infinity);
    expect(_contourAt(c, -5)).toBe(-Infinity);
  });

  it('_contourAt at the upper boundary (perpHigh) is OUTSIDE the segment', () => {
    // Segments are half-open [perpLow, perpHigh); convention: <
    const c = _emptyContour();
    _appendSegment(c, 0, 10, 5);
    expect(_contourAt(c, 10)).toBe(-Infinity);
  });

  it('_growContour doubles capacity when full', () => {
    const c = _emptyContour();
    expect(c.buf.length).toBe(32 * 4);
    // Fill to capacity.
    for (let i = 0; i < 32; i++) {
      _appendSegment(c, i * 10, i * 10 + 5, i);
    }
    expect(c.len).toBe(32);
    expect(c.buf.length).toBe(32 * 4);
    // Add one more — triggers grow.
    _appendSegment(c, 1000, 1010, 999);
    expect(c.len).toBe(33);
    expect(c.buf.length).toBe(64 * 4);
    // Existing data preserved.
    expect(c.buf[0]).toBe(0);
    expect(c.buf[31 * 4]).toBe(310);
    expect(c.buf[32 * 4]).toBe(1000);
  });
});

describe('_envelopesFromRects', () => {
  const { _envelopesFromRects, rectsToBuf } = __test;

  it('empty rects → empty contours', () => {
    const { bottom, top } = _envelopesFromRects(rectsToBuf([]), 'x');
    expect(bottom.len).toBe(0);
    expect(top.len).toBe(0);
  });

  it('single rect: bottom=top across the rect, value = perp center ± half', () => {
    // Rect at (5, 10, 4, 6): x=5, y=10, w=4, d=6 → x range [3,7], y range [7,13].
    const buf = rectsToBuf([{ x: 5, y: 10, w: 4, d: 6 }]);
    // Sweep along x: at x ∈ [3, 7], perp (y) range = [7, 13].
    const { bottom, top } = _envelopesFromRects(buf, 'x');
    expect(bottom.len).toBe(1);
    expect(top.len).toBe(1);
    expect(bottom.buf[0]).toBe(3); // perpLow (= alongLow in source)
    expect(bottom.buf[1]).toBe(7); // perpHigh
    expect(bottom.buf[2]).toBe(7); // min y
    expect(top.buf[2]).toBe(13); // max y
  });

  it('two disjoint rects on the same alongAxis range', () => {
    // Two rects at different perp positions but same x range.
    // r1: x=0, w=4 (x [-2,2]), y=0, d=4 (y [-2,2])
    // r2: x=0, w=4, y=10, d=4 (y [8,12])
    const buf = rectsToBuf([
      { x: 0, y: 0, w: 4, d: 4 },
      { x: 0, y: 10, w: 4, d: 4 },
    ]);
    const { bottom, top } = _envelopesFromRects(buf, 'x');
    // Sweep along x: at x ∈ [-2, 2], BOTH rects are active. min y = -2, max y = 12.
    expect(bottom.len).toBe(1);
    expect(top.len).toBe(1);
    expect(bottom.buf[2]).toBe(-2);
    expect(top.buf[2]).toBe(12);
  });

  it('two staggered rects produce stepped envelope', () => {
    // r1: x ∈ [0, 10], y ∈ [0, 10]
    // r2: x ∈ [5, 15], y ∈ [-5, 5]
    const buf = rectsToBuf([
      { x: 5, y: 5, w: 10, d: 10 }, // (0..10, 0..10)
      { x: 10, y: 0, w: 10, d: 10 }, // (5..15, -5..5)
    ]);
    const { bottom, top } = _envelopesFromRects(buf, 'x');
    // At x ∈ [0, 5]: only r1. min y = 0, max y = 10.
    // At x ∈ [5, 10]: both. min y = -5, max y = 10.
    // At x ∈ [10, 15]: only r2. min y = -5, max y = 5.
    expect(bottom.len).toBe(3);
    expect(bottom.buf[0]).toBe(0);
    expect(bottom.buf[1]).toBe(5);
    expect(bottom.buf[2]).toBe(0);
    expect(bottom.buf[5]).toBe(10);
    expect(bottom.buf[6]).toBe(-5);
    expect(bottom.buf[9]).toBe(15);  // perpHigh of segment 2
    expect(bottom.buf[10]).toBe(-5); // alongValue of segment 2 (min y in [10,15])
    expect(top.len).toBe(3);
    expect(top.buf[2]).toBe(10);
    expect(top.buf[6]).toBe(10);
    expect(top.buf[10]).toBe(5);
  });

  it('two rects with identical perp extent but different along ranges', () => {
    // Both have y ∈ [-2, 2] (same perp). r1 x ∈ [0, 5], r2 x ∈ [3, 8].
    // Tests the identity-based active-set removal: when r1 leaves at x=5,
    // we must remove r1's active entry, not r2's (they share perp extent).
    const buf = rectsToBuf([
      { x: 2.5, y: 0, w: 5, d: 4 },
      { x: 5.5, y: 0, w: 5, d: 4 },
    ]);
    const { bottom, top } = _envelopesFromRects(buf, 'x');
    // Sweep along x:
    //   [0, 3): only r1, perp [-2, 2]
    //   [3, 5): both r1 and r2, perp [-2, 2] (same)
    //   [5, 8): only r2, perp [-2, 2]
    // All three segments have identical perp extent because both rects do.
    expect(bottom.len).toBe(3);
    expect(top.len).toBe(3);
    // After r1 leaves at x=5, r2 must still be active (this is what the
    // identity-based removal fix protects). Segment 3 must have valid extents.
    expect(bottom.buf[8]).toBe(5);   // perpLow of segment 3 (= along=5)
    expect(bottom.buf[9]).toBe(8);   // perpHigh of segment 3 (= along=8)
    expect(bottom.buf[10]).toBe(-2); // alongValue of segment 3 (= min y of r2 only)
    expect(top.buf[10]).toBe(2);     // alongValue of top segment 3 (= max y of r2 only)
  });

  it('alongAxis=y sweeps the y axis (perp = x)', () => {
    // r at x=5, y=10, w=4, d=6 → x range [3,7], y range [7,13].
    const buf = rectsToBuf([{ x: 5, y: 10, w: 4, d: 6 }]);
    const { bottom, top } = _envelopesFromRects(buf, 'y');
    // Sweep along y: at y ∈ [7, 13], perp (x) range = [3, 7].
    expect(bottom.len).toBe(1);
    expect(bottom.buf[0]).toBe(7);
    expect(bottom.buf[1]).toBe(13);
    expect(bottom.buf[2]).toBe(3);
    expect(top.buf[2]).toBe(7);
  });
});

describe('_slideUntilClear', () => {
  const { _slideUntilClear, _emptyContour, _appendSegment } = __test;

  it('two empty contours → -Infinity (no constraint)', () => {
    const a = _emptyContour();
    const b = _emptyContour();
    expect(_slideUntilClear(a, b, 1)).toBe(-Infinity);
  });

  it('child has segments but side is empty → -Infinity', () => {
    const child = _emptyContour();
    _appendSegment(child, 0, 10, -3);
    const side = _emptyContour();
    expect(_slideUntilClear(child, side, 1)).toBe(-Infinity);
  });

  it('side has segments but child is empty → -Infinity', () => {
    const child = _emptyContour();
    const side = _emptyContour();
    _appendSegment(side, 0, 10, 5);
    expect(_slideUntilClear(child, side, 1)).toBe(-Infinity);
  });

  it('non-overlapping perp ranges → -Infinity', () => {
    const child = _emptyContour();
    _appendSegment(child, 0, 5, -3);
    const side = _emptyContour();
    _appendSegment(side, 100, 105, 50);
    expect(_slideUntilClear(child, side, 1)).toBe(-Infinity);
  });

  it('full overlap, single segment each: offset = sAlong + gap - cAlong', () => {
    const child = _emptyContour();
    _appendSegment(child, 0, 10, -3); // child's leftmost = -3 at perp [0,10]
    const side = _emptyContour();
    _appendSegment(side, 0, 10, 5); // side's rightmost = 5
    // Required: -3 + offset ≥ 5 + gap. With gap=1: offset ≥ 9.
    expect(_slideUntilClear(child, side, 1)).toBe(9);
  });

  it('partial overlap: only the overlapping perp range constrains', () => {
    const child = _emptyContour();
    _appendSegment(child, 0, 10, -3);
    const side = _emptyContour();
    _appendSegment(side, 5, 15, 5);
    // Overlap is perp [5, 10]. offset ≥ 5 + 1 - (-3) = 9.
    expect(_slideUntilClear(child, side, 1)).toBe(9);
  });

  it('multiple segments: takes max required offset', () => {
    const child = _emptyContour();
    _appendSegment(child, 0, 5, -3); // c-segment 1: leftmost = -3
    _appendSegment(child, 5, 10, 0); // c-segment 2: leftmost = 0
    const side = _emptyContour();
    _appendSegment(side, 0, 5, 2); // s-segment 1: rightmost = 2
    _appendSegment(side, 5, 10, 10); // s-segment 2: rightmost = 10
    // Constraint 1 (perp [0,5]): -3 + off ≥ 2 + 1 → off ≥ 6.
    // Constraint 2 (perp [5,10]): 0 + off ≥ 10 + 1 → off ≥ 11.
    // Max = 11.
    expect(_slideUntilClear(child, side, 1)).toBe(11);
  });
});

describe('_mergeTopContour', () => {
  const { _mergeTopContour, _emptyContour, _appendSegment, _contourAt } = __test;

  it('merge into empty side: side becomes child shifted by offset', () => {
    const side = _emptyContour();
    const child = _emptyContour();
    _appendSegment(child, 0, 10, 5);
    _mergeTopContour(side, child, 7);
    expect(side.len).toBe(1);
    expect(side.buf[0]).toBe(0);
    expect(side.buf[1]).toBe(10);
    expect(side.buf[2]).toBe(12); // 5 + 7
  });

  it('non-zero offset applies to overlapping segments correctly', () => {
    const side = _emptyContour();
    _appendSegment(side, 0, 10, 5);
    const child = _emptyContour();
    _appendSegment(child, 0, 10, 3);
    // After offset=4: child shifted to alongValue=7. max(side=5, 7) = 7.
    _mergeTopContour(side, child, 4);
    expect(_contourAt(side, 5)).toBe(7);
  });

  it('merge empty child: side unchanged', () => {
    const side = _emptyContour();
    _appendSegment(side, 0, 10, 3);
    const child = _emptyContour();
    _mergeTopContour(side, child, 100);
    expect(side.len).toBe(1);
    expect(side.buf[2]).toBe(3);
  });

  it('disjoint perp ranges: side has both segments after merge', () => {
    const side = _emptyContour();
    _appendSegment(side, 0, 10, 3);
    const child = _emptyContour();
    _appendSegment(child, 20, 30, 5);
    _mergeTopContour(side, child, 0);
    expect(side.len).toBe(2);
    expect(_contourAt(side, 5)).toBe(3);
    expect(_contourAt(side, 25)).toBe(5);
    expect(_contourAt(side, 15)).toBe(-Infinity);
  });

  it('child overlaps existing segment with HIGHER value: side raises', () => {
    const side = _emptyContour();
    _appendSegment(side, 0, 10, 3);
    const child = _emptyContour();
    _appendSegment(child, 0, 10, 7);
    _mergeTopContour(side, child, 0);
    expect(_contourAt(side, 5)).toBe(7);
  });

  it('child overlaps existing segment with LOWER value: side stays', () => {
    const side = _emptyContour();
    _appendSegment(side, 0, 10, 7);
    const child = _emptyContour();
    _appendSegment(child, 0, 10, 3);
    _mergeTopContour(side, child, 0);
    expect(_contourAt(side, 5)).toBe(7);
  });

  it('child partially overlaps: split into multiple segments', () => {
    const side = _emptyContour();
    _appendSegment(side, 0, 10, 3);
    const child = _emptyContour();
    _appendSegment(child, 5, 15, 7);
    _mergeTopContour(side, child, 0);
    // Expected merged: [0,5]=3, [5,10]=max(3,7)=7, [10,15]=7.
    // Coalesced [5,15]=7.
    expect(_contourAt(side, 2)).toBe(3);
    expect(_contourAt(side, 7)).toBe(7);
    expect(_contourAt(side, 12)).toBe(7);
  });
});

describe('_preseedGrandparentBlock', () => {
  const { _preseedGrandparentBlock, _emptyContour } = __test;

  it('seeds a single segment with alongValue = +gW/2 over a generous perp range', () => {
    // Pre-seed represents the grandparent's body in parent's local frame:
    // grandparent's HIGH along edge sits at +gW/2 (= +12 here). The perp
    // range is a large practical bound (1e9) covering any reasonable child
    // perp extent past the parent's join.
    const side = _emptyContour();
    _preseedGrandparentBlock(side, 24);
    expect(side.len).toBe(1);
    expect(side.buf[0]).toBe(0);
    expect(side.buf[1]).toBeGreaterThan(1e6);
    expect(side.buf[2]).toBe(12);
  });

  it('zero or negative width is no-op', () => {
    const side = _emptyContour();
    _preseedGrandparentBlock(side, 0);
    expect(side.len).toBe(0);
    _preseedGrandparentBlock(side, -5);
    expect(side.len).toBe(0);
  });

  it('blocks back-extending content: child alongLow must clear +gW/2 + gap', () => {
    const { _slideUntilClear, _appendSegment } = __test;
    // A child has alongLow = -10 at perp [0, 5] (back-extending into the
    // zone occupied by the grandparent's body).
    const child = _emptyContour();
    _appendSegment(child, 0, 5, -10);
    const side = _emptyContour();
    _preseedGrandparentBlock(side, 24); // alongRight = +12
    // Required: -10 + offset ≥ 12 + 1 (gap) → offset ≥ 23.
    expect(_slideUntilClear(child, side, 1)).toBe(23);
  });

  it('constrains content at all perp depths under the practical bound', () => {
    const { _slideUntilClear, _appendSegment } = __test;
    // Child only at perp [20, 25] — past the v1 perp range [0, gW/2] but
    // still within the v2 generous bound. The grandparent's main street
    // extends well past the parent's stem in side-1 perp; over-constraining
    // here is acceptable (rare pathological case) and harmless: the
    // alongValue +gW/2 is the same as at low perp depths.
    const child = _emptyContour();
    _appendSegment(child, 20, 25, -10);
    const side = _emptyContour();
    _preseedGrandparentBlock(side, 24);
    // Required: -10 + offset ≥ 12 + 1 → offset ≥ 23.
    expect(_slideUntilClear(child, side, 1)).toBe(23);
  });

  it('asymmetric pre-seed: tighter perpRange limits the segment', () => {
    // B's gem-facing side: caller passes parentStemXInGrandparent so the
    // pre-seed only blocks perp depths up to that bound. Past it, world
    // space is empty (behind grandparent's gem) and content is free.
    const side = _emptyContour();
    _preseedGrandparentBlock(side, 24, 50); // perpRange = 50
    expect(side.len).toBe(1);
    expect(side.buf[0]).toBe(0);
    expect(side.buf[1]).toBe(50);
    expect(side.buf[2]).toBe(12);
  });

  it('asymmetric pre-seed: child past the bound is unconstrained', () => {
    const { _slideUntilClear, _appendSegment } = __test;
    // Child only at perp [60, 65] — past the perpRange = 50 bound. With the
    // tightened pre-seed, _slideUntilClear finds NO overlap and returns
    // -Infinity (no constraint).
    const child = _emptyContour();
    _appendSegment(child, 60, 65, -10);
    const side = _emptyContour();
    _preseedGrandparentBlock(side, 24, 50);
    expect(_slideUntilClear(child, side, 1)).toBe(-Infinity);
  });

  it('asymmetric pre-seed: undefined perpRange falls back to PRESEED_PERP_INF', () => {
    const side = _emptyContour();
    _preseedGrandparentBlock(side, 24, undefined);
    expect(side.len).toBe(1);
    expect(side.buf[1]).toBeGreaterThan(1e6);
  });

  it('asymmetric pre-seed: zero or negative perpRange falls back to PRESEED_PERP_INF', () => {
    // Defensive: a zero or negative bound (caller bug or root-adjacent edge
    // case where stemX hasn't grown beyond originPad) should not produce a
    // degenerate segment. Fall back to the conservative bound.
    const side = _emptyContour();
    _preseedGrandparentBlock(side, 24, 0);
    expect(side.len).toBe(1);
    expect(side.buf[1]).toBeGreaterThan(1e6);
    const side2 = _emptyContour();
    _preseedGrandparentBlock(side2, 24, -5);
    expect(side2.len).toBe(1);
    expect(side2.buf[1]).toBeGreaterThan(1e6);
  });
});

describe('_envelopeMinAlong', () => {
  it('empty contour returns Infinity', () => {
    const c = __test._emptyContour();
    expect(__test._envelopeMinAlong(c)).toBe(Infinity);
  });

  it('single segment returns that alongValue', () => {
    const c = __test._emptyContour();
    __test._appendSegment(c, 0, 10, 5);
    expect(__test._envelopeMinAlong(c)).toBe(5);
  });

  it('multiple segments return smallest alongValue', () => {
    const c = __test._emptyContour();
    __test._appendSegment(c, 0, 10, 5);
    __test._appendSegment(c, 10, 20, 2);
    __test._appendSegment(c, 20, 30, 8);
    expect(__test._envelopeMinAlong(c)).toBe(2);
  });

  it('handles negative alongValues', () => {
    const c = __test._emptyContour();
    __test._appendSegment(c, 0, 10, -3);
    __test._appendSegment(c, 10, 20, -7);
    expect(__test._envelopeMinAlong(c)).toBe(-7);
  });
});

describe('_envelopePerpMin', () => {
  it('empty contour returns Infinity', () => {
    const c = __test._emptyContour();
    expect(__test._envelopePerpMin(c)).toBe(Infinity);
  });

  it('single segment returns its perpLow', () => {
    const c = __test._emptyContour();
    __test._appendSegment(c, -3, 10, 5);
    expect(__test._envelopePerpMin(c)).toBe(-3);
  });

  it('multiple segments return smallest perpLow', () => {
    const c = __test._emptyContour();
    __test._appendSegment(c, 5, 10, 0);
    __test._appendSegment(c, -8, 5, 0);
    __test._appendSegment(c, 10, 20, 0);
    expect(__test._envelopePerpMin(c)).toBe(-8);
  });
});

describe('_isMirrorInvariant', () => {
  it('empty contours are mirror-invariant', () => {
    const a = __test._emptyContour();
    const b = __test._emptyContour();
    expect(__test._isMirrorInvariant(a, b)).toBe(true);
  });

  it('bottom = -top per segment → mirror-invariant', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, -3);
    __test._appendSegment(top, 0, 10, 3);
    __test._appendSegment(bot, 10, 20, -5);
    __test._appendSegment(top, 10, 20, 5);
    expect(__test._isMirrorInvariant(bot, top)).toBe(true);
  });

  it('bottom = top (not negated) → NOT mirror-invariant unless zero', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, 5);
    __test._appendSegment(top, 0, 10, 5);
    expect(__test._isMirrorInvariant(bot, top)).toBe(false);
  });

  it('different segment counts → NOT mirror-invariant', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, -3);
    __test._appendSegment(top, 0, 5, 3);
    __test._appendSegment(top, 5, 10, 3);
    expect(__test._isMirrorInvariant(bot, top)).toBe(false);
  });

  it('mismatched perp ranges → NOT mirror-invariant', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, -3);
    __test._appendSegment(top, 0, 11, 3);
    expect(__test._isMirrorInvariant(bot, top)).toBe(false);
  });

  it('within OVERLAP_EPS tolerance', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, -3);
    __test._appendSegment(top, 0, 10, 3 + 1e-12);
    expect(__test._isMirrorInvariant(bot, top)).toBe(true);
  });
});

describe('_mirrorEnvelopes', () => {
  it('empty input returns empty contours', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    const m = __test._mirrorEnvelopes(bot, top);
    expect(m.bottom.len).toBe(0);
    expect(m.top.len).toBe(0);
  });

  it('mirrored.bottom = -natural.top per segment', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, -3);
    __test._appendSegment(top, 0, 10, 7);
    const m = __test._mirrorEnvelopes(bot, top);
    expect(m.bottom.len).toBe(1);
    expect(m.bottom.buf[0]).toBe(0);     // perpLow unchanged
    expect(m.bottom.buf[1]).toBe(10);    // perpHigh unchanged
    expect(m.bottom.buf[2]).toBe(-7);    // -natural.top.alongValue
  });

  it('mirrored.top = -natural.bottom per segment', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, -3);
    __test._appendSegment(top, 0, 10, 7);
    const m = __test._mirrorEnvelopes(bot, top);
    expect(m.top.len).toBe(1);
    expect(m.top.buf[2]).toBe(3);        // -natural.bottom.alongValue
  });

  it('mirror twice returns to original (alongValues)', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, -3);
    __test._appendSegment(top, 0, 10, 7);
    const m1 = __test._mirrorEnvelopes(bot, top);
    const m2 = __test._mirrorEnvelopes(m1.bottom, m1.top);
    expect(m2.bottom.buf[2]).toBe(-3);
    expect(m2.top.buf[2]).toBe(7);
  });

  it('multi-segment subtree mirrors correctly', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 5, -2);
    __test._appendSegment(bot, 5, 10, -1);
    __test._appendSegment(top, 0, 5, 4);
    __test._appendSegment(top, 5, 10, 6);
    const m = __test._mirrorEnvelopes(bot, top);
    expect(m.bottom.len).toBe(2);
    expect(m.bottom.buf[2]).toBe(-4);
    expect(m.bottom.buf[6]).toBe(-6);
    expect(m.top.len).toBe(2);
    expect(m.top.buf[2]).toBe(2);
    expect(m.top.buf[6]).toBe(1);
  });
});

describe('_candidateBboxInParent', () => {
  // Build a subtree with bottom env [0..10, alongValue=0] and top env
  // [0..10, alongValue=5]. So natural perp range = [0, 10], natural
  // along range = [0, 5].
  function mkEnv() {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    __test._appendSegment(bot, 0, 10, 0);
    __test._appendSegment(top, 0, 10, 5);
    return { bot, top };
  }

  it('side 1, natural, stem=0: bbox = subtree natural in parent coords', () => {
    const { bot, top } = mkEnv();
    const b = __test._candidateBboxInParent(bot, top, 0, 1, false);
    expect(b.alongMin).toBe(0);
    expect(b.alongMax).toBe(5);
    expect(b.perpMin).toBe(0);
    expect(b.perpMax).toBe(10);
  });

  it('side 1, natural, stem=20: along shifts by stem', () => {
    const { bot, top } = mkEnv();
    const b = __test._candidateBboxInParent(bot, top, 20, 1, false);
    expect(b.alongMin).toBe(20);
    expect(b.alongMax).toBe(25);
    expect(b.perpMin).toBe(0);
    expect(b.perpMax).toBe(10);
  });

  it('side 0, natural: perp negates and swaps', () => {
    const { bot, top } = mkEnv();
    const b = __test._candidateBboxInParent(bot, top, 20, 0, false);
    expect(b.alongMin).toBe(20);
    expect(b.alongMax).toBe(25);
    expect(b.perpMin).toBe(-10);
    expect(b.perpMax).toBe(0);
  });

  it('side 1, mirrored: along negates around stem, perp unchanged', () => {
    const { bot, top } = mkEnv();
    const b = __test._candidateBboxInParent(bot, top, 20, 1, true);
    // natural along range [0, 5]; mirrored around stem=20 → [20-5, 20-0] = [15, 20]
    expect(b.alongMin).toBe(15);
    expect(b.alongMax).toBe(20);
    expect(b.perpMin).toBe(0);
    expect(b.perpMax).toBe(10);
  });

  it('side 0, mirrored: both negations applied', () => {
    const { bot, top } = mkEnv();
    const b = __test._candidateBboxInParent(bot, top, 20, 0, true);
    expect(b.alongMin).toBe(15);
    expect(b.alongMax).toBe(20);
    expect(b.perpMin).toBe(-10);
    expect(b.perpMax).toBe(0);
  });

  it('empty envelopes return zero-size bbox at stem', () => {
    const bot = __test._emptyContour();
    const top = __test._emptyContour();
    const b = __test._candidateBboxInParent(bot, top, 7, 1, false);
    expect(b.alongMin).toBe(7);
    expect(b.alongMax).toBe(7);
    expect(b.perpMin).toBe(0);
    expect(b.perpMax).toBe(0);
  });
});

describe('_bboxUnionMaxDim', () => {
  it('two non-overlapping bboxes: max(W, H) of union', () => {
    const a = { alongMin: 0, alongMax: 10, perpMin: 0, perpMax: 5 };
    const b = { alongMin: 12, alongMax: 20, perpMin: 0, perpMax: 5 };
    // union: along 0..20 (W=20), perp 0..5 (H=5) → max=20
    expect(__test._bboxUnionMaxDim(a, b)).toBe(20);
  });

  it('one bbox contains the other: union = larger bbox', () => {
    const a = { alongMin: 0, alongMax: 100, perpMin: 0, perpMax: 50 };
    const b = { alongMin: 10, alongMax: 20, perpMin: 5, perpMax: 15 };
    expect(__test._bboxUnionMaxDim(a, b)).toBe(100);
  });

  it('square union (W == H) returns that dim', () => {
    const a = { alongMin: 0, alongMax: 10, perpMin: 0, perpMax: 10 };
    const b = { alongMin: 0, alongMax: 10, perpMin: 0, perpMax: 10 };
    expect(__test._bboxUnionMaxDim(a, b)).toBe(10);
  });

  it('negative coordinates handled correctly', () => {
    const a = { alongMin: -5, alongMax: 5, perpMin: -3, perpMax: 3 };
    const b = { alongMin: -10, alongMax: 0, perpMin: -8, perpMax: -3 };
    // union: along -10..5 (W=15), perp -8..3 (H=11) → max=15
    expect(__test._bboxUnionMaxDim(a, b)).toBe(15);
  });
});
