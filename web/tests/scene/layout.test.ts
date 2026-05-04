import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getStreetWidth,
  getBuildingDimensions,
  layoutCity,
  sortForRendering,
  computeLineStats,
} from '../../scene/layout.js';
import { BUILDING_DIMENSIONS } from '../../config/index.js';

const TEST_TIERS = [
  { min_descendants: 0, width: 10 },
  { min_descendants: 4, width: 16 },
  { min_descendants: 9, width: 24 },
  { min_descendants: 16, width: 36 },
  { min_descendants: 31, width: 52 },
];

// Test-time config for getBuildingDimensions / layoutCity. Mutated into
// the BUILDING_DIMENSIONS store by beforeEach; restored by afterEach.
const TEST_BUILDING_DIMS = {
  MIN_FLOORS: 1,
  MAX_FLOORS: 30,
  FLOOR_HEIGHT: 10,
  MIN_WIDTH: 6,
  MAX_WIDTH: 40,
};

let _origBuildingDims = null;
beforeEach(() => {
  _origBuildingDims = { ...BUILDING_DIMENSIONS.get() };
  for (const [k, v] of Object.entries(TEST_BUILDING_DIMS)) {
    BUILDING_DIMENSIONS.setKey(k as any, v as any);
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(_origBuildingDims)) {
    BUILDING_DIMENSIONS.setKey(k as any, v as any);
  }
});

const TEST_TREE = {
  name: 'project',
  type: 'directory',
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
      type: 'file',
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
      type: 'file',
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
      type: 'directory',
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
          type: 'file',
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
    const empty = { name: 'empty', type: 'directory', children: [] };
    expect(computeLineStats(empty)).toEqual({ min: 1, max: 1 });
  });

  it('ignores files with null/zero line counts', () => {
    const tree = {
      name: 'r',
      type: 'directory',
      children: [
        { name: 'a.js', type: 'file', lines: 0 },
        { name: 'b.js', type: 'file', lines: null },
        { name: 'c.js', type: 'file', lines: 50 },
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
      expect(s.orientation === 'x' || s.orientation === 'y').toBe(true);
      expect(typeof s.label).toBe('string');
      expect(s.dir).toBeTruthy();
    }
  });

  it('at least one street has a non-empty label', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    const hasLabel = layout.streets.some((s) => s.label && s.label.length > 0);
    expect(hasLabel).toBe(true);
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
      type: 'file',
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
      type: 'directory',
      path: name,
      children_count: children.length,
      descendants_count: children.length + children.filter((c) => c.type === 'directory').length,
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
        if (s.orientation === 'x') {
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
