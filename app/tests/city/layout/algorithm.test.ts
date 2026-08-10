import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { estimateDirReaches, layoutCity, layoutCityWithTrace } from '@/city/layout/algorithm';
import { getStreetWidth, getBuildingDimensions, computeFileStats } from '@/city/layout/dimensions';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { BuildingOrient, NodeKind, StreetAxis } from '@/types';
import type { BuildingDimensionsConfig } from '@/state/stores/settings/buildings';
import type { RepoStats } from '@/types';
import { EMPTY_REPO_STATS } from '@/constants/manifest';
import type { StreetTier } from '@/state/stores/settings/streets';
import {
  assertNoOverlap,
  assertStemOrder,
  assertTreeRespecting,
  assertTJunctionsValid,
} from '../../_helpers/layoutAsserts';
import { mkFile, mkDir } from '../../_helpers/cityFixtures';
import {
  makeRng,
  genWeightedTree,
  genCommits,
  flatTree,
  genNestedTree,
} from '../../_helpers/layoutTreeFixtures';
import { commitStats, fileStats } from '../../_helpers/statsFixtures';
import type { CityLayout } from '@/types';

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
        },
      ],
    },
  ],
};

describe('getStreetWidth', () => {
  // Each tier's first and last descendant count, so an off-by-one at a
  // boundary shows up.
  it.each([
    [0, 10],
    [3, 10],
    [4, 16],
    [8, 16],
    [9, 24],
    [15, 24],
    [16, 36],
    [30, 36],
    [31, 52],
    [100, 52],
  ])('%i descendants → width %i', (count, width) => {
    expect(getStreetWidth(count, TEST_TIERS)).toBe(width);
  });

  it('falls back to the built-in tiers when none are given', () => {
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

  it('zero lines/bytes is the empty slab, with finite dimensions', () => {
    const dim = getBuildingDimensions({ lines: 0, size: 0 });
    expect(dim.floors).toBe(0);
    // EMPTY_SLAB_FLOORS 0.05 at FLOOR_HEIGHT 10.
    expect(dim.h).toBe(0.5);
    expect(dim.w).toBe(TEST_BUILDING_DIMS.MIN_WIDTH);
    expect(Number.isFinite(dim.h)).toBe(true);
    expect(Number.isFinite(dim.w)).toBe(true);
  });

  it('a 0-byte file in the project byte range does not produce NaN', () => {
    // Regression: a byte range whose min is 0 (an empty file in the repo) made
    // Math.log(byteStats.min) = -Infinity → NaN width → NaN geometry.
    const dim = getBuildingDimensions(
      { lines: 0, size: 0 },
      { min: 1, max: 100 },
      { min: 0, max: 5000 }
    );
    expect(Number.isFinite(dim.w)).toBe(true);
    expect(Number.isFinite(dim.d)).toBe(true);
    expect(Number.isFinite(dim.h)).toBe(true);
  });

  it('smallest file in the project maps to min_floors', () => {
    const dim = getBuildingDimensions({ lines: 10, size: 100 }, { min: 10, max: 1000 });
    expect(dim.floors).toBe(1);
  });

  it('largest file maps to max_floors when the repo reaches the full-height line count', () => {
    // Biggest file at FULL_HEIGHT_LINES (2000) → the absolute ceiling is the cap.
    const dim = getBuildingDimensions({ lines: 2000, size: 10000 }, { min: 10, max: 2000 });
    expect(dim.floors).toBe(TEST_BUILDING_DIMS.MAX_FLOORS);
  });

  it('caps the tallest building below max_floors when the biggest file is small', () => {
    // Repo whose largest file is 1000 lines (< FULL_HEIGHT_LINES 2000): even its
    // biggest file tops out below the cap at 1 + sqrt(1000/2000) * (30 - 1) ≈ 21.5.
    const dim = getBuildingDimensions({ lines: 1000, size: 10000 }, { min: 10, max: 1000 });
    expect(dim.floors).toBeLessThan(TEST_BUILDING_DIMS.MAX_FLOORS as number);
    expect(dim.floors).toBe(22);
  });

  it('midrange file uses sqrt-interpolated floors within the repo ceiling', () => {
    // Biggest file is 1000 lines (< 2000) → repo ceiling ≈ 21.5 floors.
    // sMin=sqrt(10)=3.162, sMax=sqrt(1000)=31.62, sLines=sqrt(100)=10
    // t = (10 - 3.162) / (31.62 - 3.162) ≈ 0.240
    // floors ≈ round(1 + 0.240 * (21.5 - 1)) = round(5.93) = 6
    const dim = getBuildingDimensions({ lines: 100, size: 1000 }, { min: 10, max: 1000 });
    expect(dim.floors).toBe(6);
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
  // mediaKind is the backend-computed classification the layout reads
  // (the extension is now informational only — see utils/mediaKind.ts).
  const IMAGE = 'image' as const;

  it('media file without dims falls back to square (aspect=1)', () => {
    const dim = getBuildingDimensions(
      { lines: 0, size: 1000, extension: PNG, mediaKind: IMAGE },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    // Square aspect: raw_h = w = 24.8, floors = round(2.48) = 2, h = 20.
    expect(dim.d).toBe(dim.w);
    expect(dim.floors).toBe(2);
    expect(dim.h).toBe(20);
  });

  it('portrait image gives a tall building (height > width)', () => {
    const dim = getBuildingDimensions(
      {
        lines: 0,
        size: 1000,
        extension: PNG,
        mediaKind: IMAGE,
        media_width: 100,
        media_height: 200,
      },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    expect(dim.h).toBeGreaterThan(dim.w);
  });

  it('landscape image gives a short wide building (height < width)', () => {
    const dim = getBuildingDimensions(
      {
        lines: 0,
        size: 1000,
        extension: PNG,
        mediaKind: IMAGE,
        media_width: 200,
        media_height: 50,
      },
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
      {
        lines: 0,
        size: 1000,
        extension: PNG,
        mediaKind: IMAGE,
        media_width: 500,
        media_height: 5000,
      },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    // 10:1 portrait clamps to aspect 2.5: raw_h = 24.8 * 2.5 = 62, floors = 6.
    expect(dim.floors).toBe(6);
  });

  it('clamps very wide panorama at aspect 0.4', () => {
    const dim = getBuildingDimensions(
      {
        lines: 0,
        size: 1000,
        extension: PNG,
        mediaKind: IMAGE,
        media_width: 5000,
        media_height: 500,
      },
      { min: 10, max: 10000 },
      { min: 10, max: 10000 }
    );
    // 1:10 panorama clamps to aspect 0.4: raw_h = 24.8 * 0.4 = 9.92, floors = 1.
    expect(dim.floors).toBe(1);
  });

  it('non-media file ignores media_width/media_height', () => {
    // Should follow the normal lines-based height path.
    const dim = getBuildingDimensions(
      { lines: 100, size: 1000, extension: '.ts', media_width: 9999, media_height: 1 },
      { min: 10, max: 1000 },
      { min: 10, max: 10000 }
    );
    // Lines-derived via sqrt interpolation, not byte-aspect-derived: a 9999:1
    // aspect would clamp to 0.4 and give a 1-floor building, but the media_*
    // fields are ignored outright, so 100 lines lands at 6 floors.
    expect(dim.floors).toBe(6);
    expect(dim.h).toBe(60);
  });
});

// ---- computeFileStats ----
//
// Reads pre-computed ranges from manifest.stats — no tree walk.
// Falls back to {min:1,max:1} (safe-for-division default) when stats are
// absent or carry the empty sentinel {min:0,max:0}.
describe('computeFileStats', () => {
  const REAL_STATS: RepoStats = {
    ...EMPTY_REPO_STATS,
    lineCountRange: { min: 20, max: 80 },
    byteSizeRange: { min: 500, max: 2000 },
  };

  it('reads lineCountRange and byteSizeRange directly from manifest.stats', () => {
    const fs = computeFileStats(REAL_STATS);
    expect(fs.lines).toEqual({ min: 20, max: 80 });
    expect(fs.bytes).toEqual({ min: 500, max: 2000 });
  });

  it('returns safe fallback {min:1,max:1} when stats is null', () => {
    const fs = computeFileStats(null);
    expect(fs.lines).toEqual({ min: 1, max: 1 });
    expect(fs.bytes).toEqual({ min: 1, max: 1 });
  });

  it('returns safe fallback {min:1,max:1} when stats is undefined', () => {
    const fs = computeFileStats(undefined);
    expect(fs.lines).toEqual({ min: 1, max: 1 });
    expect(fs.bytes).toEqual({ min: 1, max: 1 });
  });

  it('returns safe fallback when lineCountRange is the empty sentinel {min:0,max:0}', () => {
    const emptyStats: RepoStats = { ...REAL_STATS, lineCountRange: { min: 0, max: 0 } };
    const fs = computeFileStats(emptyStats);
    expect(fs.lines).toEqual({ min: 1, max: 1 });
    // bytes unaffected
    expect(fs.bytes).toEqual({ min: 500, max: 2000 });
  });

  it('returns safe fallback when byteSizeRange is the empty sentinel {min:0,max:0}', () => {
    const emptyStats: RepoStats = { ...REAL_STATS, byteSizeRange: { min: 0, max: 0 } };
    const fs = computeFileStats(emptyStats);
    expect(fs.bytes).toEqual({ min: 1, max: 1 });
    // lines unaffected
    expect(fs.lines).toEqual({ min: 20, max: 80 });
  });
});

// ---- layoutCity ----
describe('layoutCity', () => {
  it('has at least 1 street', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(layout.streets.length).toBeGreaterThanOrEqual(1);
  });

  it('produces 3 file buildings for the test tree', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    expect(layout.buildings.length).toBe(3);
  });

  it('every building carries the file node it was built from', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    for (const b of layout.buildings) {
      expect(b.file).toBeTruthy();
    }
  });

  it('every building starts with color = null', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    for (const b of layout.buildings) {
      expect(b.color).toBeNull();
    }
  });

  it('every street has positive extent, a known axis, and a direction', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    for (const s of layout.streets) {
      expect(s.length).toBeGreaterThan(0);
      expect(s.width).toBeGreaterThan(0);
      expect([StreetAxis.X, StreetAxis.Y]).toContain(s.orientation);
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

describe('layout invariants (current packer baseline)', () => {
  it('TEST_TREE has no overlapping rectangles', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    assertNoOverlap(layout);
  });
  it('TEST_TREE child streets are stem-ordered alphabetically', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    assertStemOrder(layout);
  });
  it('multi-subdir tree has stem-ordered child streets', () => {
    const tree = mkDir('root', [
      mkDir('aaaa', [mkDir('inner', [mkFile('f1.ts'), mkFile('f2.ts')])]),
      mkDir('bbbb', [mkFile('f3.ts')]),
      mkDir('cccc', [mkFile('f4.ts')]),
      mkDir('dddd', [mkFile('f5.ts')]),
    ]);
    const layout = layoutCity({ tree });
    assertStemOrder(layout);
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
    assertNoOverlap(layout);
  });
  it('deeply-nested mirror tree has no overlapping rectangles', () => {
    const tree = mkDir('root', [
      mkDir('aaaa', [mkDir('inner', [mkFile('f1.ts'), mkFile('f2.ts')])]),
      mkDir('bbbb', [mkFile('f3.ts')]),
      mkDir('cccc', [mkFile('f4.ts')]),
      mkDir('dddd', [mkFile('f5.ts')]),
    ]);
    const layout = layoutCity({ tree });
    assertNoOverlap(layout);
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

    assertNoOverlap(layout);
    assertStemOrder(layout);

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
    assertNoOverlap(layout);
    assertStemOrder(layout);
    const rootStreet = layout.streets.find((s) => s.isRoot)!;
    // Measured ~115.4 under the packer with the prior STREET_TIERS defaults; after
    // widening tiers (0→32, 4→48, 8→80, 16→96) the natural length is
    // ~264. Threshold scaled to ~300 to keep ~36u headroom while still
    // catching a 2× regression.
    expect(rootStreet.length).toBeLessThan(300);
  });

  it('TEST_TREE is tree-respecting', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    assertTreeRespecting(layout);
  });

  it('TEST_TREE has valid T-junctions', () => {
    const layout = layoutCity({ tree: TEST_TREE });
    assertTJunctionsValid(layout);
  });
});

describe('quickjs-scenario regression', () => {
  // Reproduces the failure from screenshots: node_modules has a quickjs
  // child whose own src/ subdir picked the side facing node_modules,
  // forcing the quickjs road to extend back. With the packer, src/ should
  // mirror or pick the other side, keeping quickjs road short.
  // Not the shared mkDir: this scenario is three levels deep, so it re-prefixes
  // paths all the way down and accumulates descendants_count recursively. The
  // shared one only prefixes its immediate children, which is enough for the
  // flat trees everywhere else in this file.
  function mkDeepDir(name: string, children: any[], path?: string): any {
    const dirPath = path || name;
    const prefixed = children.map((c) => {
      if (c.type === NodeKind.Directory) {
        return mkDeepDir(c.name, c.children, `${dirPath}/${c.name}`);
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
    const tree = mkDeepDir('root', [
      mkDeepDir(
        'a-other-pkg',
        Array.from({ length: 10 }, (_, i) => mkFile(`f${i}.ts`))
      ),
      mkDeepDir('node_modules', [
        ...Array.from({ length: 8 }, (_, i) => mkFile(`big${i}.ts`)),
        mkDeepDir('quickjs', [
          mkFile('qf1.ts'),
          mkFile('qf2.ts'),
          mkFile('qf3.ts'),
          mkDeepDir(
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

describe('layoutCity end-to-end', () => {
  it('lays out a minimal tree with all four invariants satisfied', () => {
    const tree = mkDir('root', [
      mkFile('a.ts'),
      mkFile('b.ts'),
      mkDir('sub', [mkFile('c.ts'), mkFile('d.ts')]),
    ]);
    const layout = layoutCity({ tree });
    assertNoOverlap(layout);
    assertStemOrder(layout);
    assertTreeRespecting(layout);
    assertTJunctionsValid(layout);
  });

  // estimateDirReaches: bottom-up pre-pass that sizes the phantom in each
  // child recursion. Must approximate (or upper-bound) the actual placement's
  // along/perp extents — undersizing the phantom reintroduces the
  // grandchild-overlaps-ancestor bug.
  describe('estimateDirReaches matches actual layout', () => {
    it('flat tree: estimated alongReach >= actual road length', () => {
      const tree = mkDir('root', [
        mkFile('a.ts'),
        mkFile('b.ts'),
        mkFile('c.ts'),
        mkFile('d.ts'),
        mkFile('e.ts'),
      ]);
      const stats = { lines: { min: 20, max: 20 }, bytes: { min: 500, max: 500 } };
      const cache = new Map();
      const reaches = estimateDirReaches(tree, stats.lines, stats.bytes, undefined, cache);
      const layout = layoutCity({ tree });
      const root = layout.streets.find((s: any) => s.dir?.name === 'root');
      expect(root).toBeDefined();
      // The estimate must be at least as large as the actual road length —
      // if it's smaller, the phantom under-sizes and the bug returns.
      expect(reaches.alongReach).toBeGreaterThanOrEqual(root!.length - 1);
    });

    it("nested tree: every dir's estimate >= actual road length", () => {
      const tree = mkDir('root', [
        mkDir('a', [mkFile('a1.ts'), mkFile('a2.ts'), mkFile('a3.ts')]),
        mkDir('b', [mkFile('b1.ts'), mkFile('b2.ts')]),
        mkDir('c', [
          mkDir('cc', [mkFile('cc1.ts'), mkFile('cc2.ts'), mkFile('cc3.ts')]),
          mkFile('c1.ts'),
        ]),
      ]);
      const stats = { lines: { min: 20, max: 20 }, bytes: { min: 500, max: 500 } };
      const cache = new Map();
      estimateDirReaches(tree, stats.lines, stats.bytes, undefined, cache);
      const layout = layoutCity({ tree });

      const mismatches: string[] = [];
      for (const street of layout.streets) {
        if (!street.dir) continue;
        const est = cache.get(street.dir as any);
        if (!est) continue;
        if (est.alongReach < street.length - 1) {
          mismatches.push(`${street.dir.name}: est=${est.alongReach}, actual=${street.length}`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('deep chain: subdir contributions correctly propagate', () => {
      // root → a → aa → aaa with files at the deepest level.
      const tree = mkDir('root', [
        mkDir('a', [mkDir('aa', [mkDir('aaa', [mkFile('x.ts'), mkFile('y.ts'), mkFile('z.ts')])])]),
      ]);
      const stats = { lines: { min: 20, max: 20 }, bytes: { min: 500, max: 500 } };
      const cache = new Map();
      estimateDirReaches(tree, stats.lines, stats.bytes, undefined, cache);
      const layout = layoutCity({ tree });
      // Every street's length should be covered by its dir's estimate.
      for (const street of layout.streets) {
        if (!street.dir) continue;
        const est = cache.get(street.dir as any);
        if (!est) continue;
        expect(est.alongReach).toBeGreaterThanOrEqual(street.length - 1);
      }
    });
  });

  // Stress test that mirrors the firecrawl/Linux-scale shape: a long-road
  // ancestor (apps) whose alphabetically-first child (api) has a deep
  // subtree extending along the ancestor's road. Before the
  // estimateDirAlongReach fix, the phantom seeded into api's local occupancy
  // was sized with parentMaxBoundary*2 + 1000 at recursion start (when api
  // was apps' first child, parentMaxBoundary was tiny); deep grandchildren
  // placed past the phantom could land on top of apps' trunk.
  it('long-road ancestor body does not overlap deep grandchildren in first-alpha subtree', () => {
    function mkSizedFile(name: string, sizeBytes: number, lines: number): any {
      return {
        name,
        type: NodeKind.File,
        path: name,
        extension: '.ts',
        size: sizeBytes,
        lines,
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
      };
    }
    function manyVariedFiles(prefix: string, count: number): any[] {
      return Array.from({ length: count }, (_, i) => {
        const size = 100 + (i % 5) * 5000 + ((i * 37) % 50000);
        const lines = 10 + (i % 100);
        return mkSizedFile(`${prefix}${String(i).padStart(3, '0')}.ts`, size, lines);
      });
    }
    const tree = mkDir('root', [
      mkDir('apps', [
        mkDir('api', [
          mkDir('src', [
            ...manyVariedFiles('a_', 25),
            ...manyVariedFiles('b_', 25),
            ...manyVariedFiles('c_', 25),
            mkDir('services', [
              ...manyVariedFiles('svc_', 60),
              mkDir('subscription', manyVariedFiles('sub_', 8)),
              mkDir('webhook', manyVariedFiles('wh_', 8)),
            ]),
          ]),
        ]),
        ...Array.from({ length: 10 }, (_, i) => {
          const name = `sdk${String.fromCharCode('b'.charCodeAt(0) + i)}`;
          return mkDir(name, [
            mkDir('src', manyVariedFiles(`${name}_src_`, 40)),
            mkDir('lib', manyVariedFiles(`${name}_lib_`, 40)),
            ...manyVariedFiles(`${name}_root_`, 20),
          ]);
        }),
      ]),
    ]);
    const layout = layoutCity({ tree });
    const apps = layout.streets.find((s) => s.dir?.name === 'apps');
    expect(apps).toBeDefined();
    // Sanity: apps' trunk should be long enough that any phantom-too-short
    // bug would surface (apps must extend well past the original
    // parentMaxBoundary*2 + 1000 ≈ 1000 reach).
    expect(apps!.length).toBeGreaterThan(2000);
    assertNoOverlap(layout);
  });
});

// Geometry-only projection (buildings + streets), safe to JSON-compare: avoids
// the file/dir refs (dir.children is cyclic) while capturing everything the
// layout output actually determines.
function geometryDigest(layout: ReturnType<typeof layoutCity>): string {
  return JSON.stringify({
    buildings: layout.buildings.map((b) => [b.x, b.y, b.w, b.d, b.h, b.floors, b.file?.path]),
    streets: layout.streets.map((s) => [
      s.x,
      s.y,
      s.length,
      s.width,
      s.orientation,
      s.isRoot,
      s.dir?.path,
    ]),
    lineStats: layout.lineStats,
    byteStats: layout.byteStats,
  });
}

describe('layout worker payload slimming', () => {
  it('layoutCity({tree, stats}) matches layoutCity(fullManifest)', () => {
    const tree = genWeightedTree('root', 'root', 4000, 0, makeRng(0xc0ffee));
    const commits = genCommits(20_000, makeRng(7));
    const stats = { ...commitStats(commits), ...fileStats(tree) };

    // What applyManifest holds vs what compute() now posts to the worker.
    const fullManifest = {
      tree,
      stats,
      commits,
      dateRanges: {},
      structure_signature: 'sig',
      layout_signature: 'sig',
      busyness: { avg: 1, busy: 1 },
    };
    const slice = { tree, stats };

    const full = layoutCity(fullManifest as unknown as Parameters<typeof layoutCity>[0]);
    const slim = layoutCity(slice as unknown as Parameters<typeof layoutCity>[0]);

    expect(slim.buildings.length).toBe(full.buildings.length);
    expect(slim.streets.length).toBe(full.streets.length);
    expect(geometryDigest(slim)).toBe(geometryDigest(full));
  });
});

function serialize(layout: CityLayout): string {
  const b = layout.buildings
    .map((x) => `${x.x.toFixed(4)},${x.y.toFixed(4)},${x.w},${x.d},${x.h},${x.floors},${x.orient}`)
    .join('|');
  const s = layout.streets
    .map((x) => `${x.x.toFixed(4)},${x.y.toFixed(4)},${x.length},${x.width},${x.orientation}`)
    .join('|');
  return `B[${b}]S[${s}]`;
}

describe('findSmallestValidStem: iterative-max scan matches the sorted scan', () => {
  const cases: Array<[string, () => any]> = [
    ['flat 3000 (long-chain worst case)', () => flatTree(3000, makeRng(1))],
    ['flat 200', () => flatTree(200, makeRng(7))],
    ['skewed 4000', () => genNestedTree('root', 'root', 4000, 0, makeRng(0xc0ffee))],
    ['skewed 800', () => genNestedTree('root', 'root', 800, 0, makeRng(42))],
  ];
  for (const [label, build] of cases) {
    it(label, () => {
      const tree = build();
      const hot = layoutCity({ tree });
      const traced = layoutCityWithTrace({ tree }).layout;
      expect(serialize(hot)).toEqual(serialize(traced));
    });
  }
});
