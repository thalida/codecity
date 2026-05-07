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
  // alternation still in place (Task 4), this means a flat run of files
  // splits across both sides AND lines up in alphabetical along-axis order.
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
});

describe('_overlapsAny', () => {
  const { _overlapsAny } = __test;
  const occ: Rect[] = [
    { x: 0, y: 0, w: 10, d: 10 },
    { x: 50, y: 0, w: 10, d: 10 },
  ];
  it('returns true when any one rect overlaps occupancy', () => {
    const probe: Rect[] = [{ x: 51, y: 0, w: 5, d: 5 }];
    expect(_overlapsAny(probe, occ)).toBe(true);
  });
  it('returns false when no rects overlap occupancy', () => {
    const probe: Rect[] = [
      { x: 100, y: 0, w: 5, d: 5 },
      { x: 200, y: 0, w: 5, d: 5 },
    ];
    expect(_overlapsAny(probe, occ)).toBe(false);
  });
  it('empty occupancy → always false', () => {
    expect(_overlapsAny([{ x: 0, y: 0, w: 1, d: 1 }], [])).toBe(false);
  });
  it('empty probe → always false', () => {
    expect(_overlapsAny([], occ)).toBe(false);
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
});
