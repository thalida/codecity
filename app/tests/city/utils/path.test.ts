import { describe, it, expect } from 'vitest';
import { parentDirPath } from '@/city/utils/path';
import {
  streetChainForDirPath,
  computePathPoints,
  streetEndOpposite,
} from '@/city/layout/streetPath';
import { NodeKind, StreetAxis } from '@/types';

// Local minimal-shape type matches the StreetLike structural contract that
// scene/path.ts reads (orientation, position, dimensions, dir.path).
interface TestStreet {
  x: number;
  y: number;
  length: number;
  width: number;
  orientation: StreetAxis;
  dir: { path: string };
}

// Synthetic streets for chain tests. Layout:
//   root (x-orientation, centerline at z=0, extends 0..L)
//     ├─ src   (y-orientation, branches at x=200, extends 0..-100)
//     │    └─ scene (x-orientation, branches at z=-50, extends 200..280)
//     └─ tests (y-orientation, branches at x=400, extends 0..+100)
const ROOT: TestStreet = {
  x: 250,
  y: 0,
  length: 500,
  width: 50,
  orientation: StreetAxis.X,
  dir: { path: '.' },
};
const SRC: TestStreet = {
  x: 200,
  y: -50,
  length: 100,
  width: 30,
  orientation: StreetAxis.Y,
  dir: { path: 'src' },
};
const SCENE: TestStreet = {
  x: 240,
  y: -50,
  length: 80,
  width: 20,
  orientation: StreetAxis.X,
  dir: { path: 'src/scene' },
};
const TESTS: TestStreet = {
  x: 400,
  y: 50,
  length: 100,
  width: 30,
  orientation: StreetAxis.Y,
  dir: { path: 'tests' },
};

const STREETS: Record<string, TestStreet> = {
  '.': ROOT,
  src: SRC,
  'src/scene': SCENE,
  tests: TESTS,
};

const GEM = { x: 25, z: 0 }; // root's near end (gem floats above origin cap)

// ---- parentDirPath ----
describe('parentDirPath', () => {
  it('returns null for root', () => {
    expect(parentDirPath('.')).toBeNull();
    expect(parentDirPath('')).toBeNull();
    expect(parentDirPath(null)).toBeNull();
  });

  it('returns "." for top-level dir', () => {
    expect(parentDirPath('src')).toBe('.');
    expect(parentDirPath('tests')).toBe('.');
  });

  it('returns parent path for nested', () => {
    expect(parentDirPath('src/scene')).toBe('src');
    expect(parentDirPath('skills/codecity/scripts')).toBe('skills/codecity');
  });
});

// ---- streetChainForDirPath ----
describe('streetChainForDirPath', () => {
  it('root only for "."', () => {
    expect(streetChainForDirPath('.', STREETS)).toEqual([ROOT]);
  });

  it('walks two-deep chain root-first', () => {
    expect(streetChainForDirPath('src', STREETS)).toEqual([ROOT, SRC]);
  });

  it('walks three-deep chain root-first', () => {
    expect(streetChainForDirPath('src/scene', STREETS)).toEqual([ROOT, SRC, SCENE]);
  });

  it('skips silently when intermediate dir has no street registered', () => {
    // Pretend src has no street registered. Chain should still include root + scene.
    const partial = { '.': ROOT, 'src/scene': SCENE };
    expect(streetChainForDirPath('src/scene', partial)).toEqual([ROOT, SCENE]);
  });

  it('returns empty for unknown root', () => {
    expect(streetChainForDirPath('src', {})).toEqual([]);
  });
});

// ---- streetEndOpposite ----
describe('streetEndOpposite', () => {
  it('x-street: returns far cap-center (away from awayFromX)', () => {
    // ROOT spans x=0..500 (L=500). caps at 25 and 475.
    expect(streetEndOpposite(ROOT, 25, 0)).toEqual({ x: 475, z: 0 });
    expect(streetEndOpposite(ROOT, 475, 0)).toEqual({ x: 25, z: 0 });
  });

  it('y-street: returns far cap-center (away from awayFromZ)', () => {
    // SRC spans z=-100..0 (L=100). caps at -85 and -15.
    expect(streetEndOpposite(SRC, 200, 0)).toEqual({ x: 200, z: -85 });
    expect(streetEndOpposite(SRC, 200, -100)).toEqual({ x: 200, z: -15 });
  });
});

// ---- computePathPoints ----
describe('computePathPoints', () => {
  it('returns [] when sel or gem is missing', () => {
    expect(computePathPoints(null, GEM, STREETS)).toEqual([]);
    expect(
      computePathPoints({ kind: NodeKind.Directory, dir: { path: '.' } }, null, STREETS)
    ).toEqual([]);
  });

  it('directory selection at root: gem → far end of root', () => {
    const sel = { kind: NodeKind.Directory, dir: { path: '.' } };
    const pts = computePathPoints(sel, GEM, STREETS);
    expect(pts).toEqual([
      { x: 25, z: 0 }, // gem
      { x: 475, z: 0 }, // root far end
    ]);
  });

  it('directory selection one-deep: gem → bend → far end of selected', () => {
    const sel = { kind: NodeKind.Directory, dir: { path: 'src' } };
    const pts = computePathPoints(sel, GEM, STREETS);
    expect(pts.length).toBe(3);
    expect(pts[0]).toEqual({ x: 25, z: 0 }); // gem
    expect(pts[1]).toEqual({ x: 200, z: 0 }); // bend at root/src intersection
    // SRC y-street: caps at -85 and -15. Far from z=0 is z=-85.
    expect(pts[2]).toEqual({ x: 200, z: -85 });
  });

  it('directory selection two-deep: gem → bend → bend → far end', () => {
    const sel = { kind: NodeKind.Directory, dir: { path: 'src/scene' } };
    const pts = computePathPoints(sel, GEM, STREETS);
    expect(pts.length).toBe(4);
    expect(pts[0]).toEqual({ x: 25, z: 0 }); // gem
    expect(pts[1]).toEqual({ x: 200, z: 0 }); // bend at root/src
    expect(pts[2]).toEqual({ x: 200, z: -50 }); // bend at src/scene
    // SCENE x-street: caps at 210 and 270. Far from x=200 is 270.
    expect(pts[3]).toEqual({ x: 270, z: -50 });
  });

  it('file selection: gem → bends → walk along → perpendicular to building edge', () => {
    // File in src/scene at building (x=250, y=-30, w=10, d=10).
    // SCENE is x-orientation at z=-50. Building y=-30 > street.y=-50,
    // so road-side edge is b.y - b.d/2 = -35.
    const sel = {
      kind: NodeKind.File,
      file: { path: 'src/scene/colors.js' },
      data: { x: 250, y: -30, w: 10, d: 10 },
    };
    const pts = computePathPoints(sel, GEM, STREETS);
    expect(pts.length).toBe(5);
    expect(pts[0]).toEqual({ x: 25, z: 0 }); // gem
    expect(pts[1]).toEqual({ x: 200, z: 0 }); // bend at root/src
    expect(pts[2]).toEqual({ x: 200, z: -50 }); // bend at src/scene
    expect(pts[3]).toEqual({ x: 250, z: -50 }); // along scene to building's X
    expect(pts[4]).toEqual({ x: 250, z: -35 }); // perpendicular to building edge
  });

  it('file selection at root level: gem → walk along root → perpendicular to building', () => {
    const sel = {
      kind: NodeKind.File,
      file: { path: 'README.md' },
      data: { x: 100, y: 30, w: 8, d: 8 },
    };
    const pts = computePathPoints(sel, GEM, STREETS);
    expect(pts.length).toBe(3);
    expect(pts[0]).toEqual({ x: 25, z: 0 }); // gem
    expect(pts[1]).toEqual({ x: 100, z: 0 }); // along root to building's X
    // Building y=30 > root.y=0, road-side edge at 30 - 8/2 = 26.
    expect(pts[2]).toEqual({ x: 100, z: 26 });
  });

  it("file selection two-deep produces 4 segments (regression: chain shouldn't silently truncate)", () => {
    const sel = {
      kind: NodeKind.File,
      file: { path: 'src/scene/colors.js' },
      data: { x: 250, y: -30, w: 10, d: 10 },
    };
    const pts = computePathPoints(sel, GEM, STREETS);
    // 5 points → 4 segments. If chain stops short anywhere, we'd see < 5.
    expect(pts.length).toBe(5);
  });

  it('drops a bend that lands on the gem (no zero-length segment)', () => {
    // Gem exactly at the root/src intersection: the first bend duplicates it
    // and would render as a zero-length segment (NaN in the fat-lines shader).
    const sel = { kind: NodeKind.Directory, dir: { path: 'src' } };
    const pts = computePathPoints(sel, { x: 200, z: 0 }, STREETS);
    expect(pts).toEqual([
      { x: 200, z: 0 }, // gem == bend, emitted once
      { x: 200, z: -85 }, // src far end
    ]);
  });

  it('drops a walk-along point that lands on the previous bend (file at the intersection)', () => {
    // Building at the src street's centerline z (y=0): the walk-along point
    // duplicates the root/src bend.
    const sel = {
      kind: NodeKind.File,
      file: { path: 'src/at-corner.js' },
      data: { x: 220, y: 0, w: 10, d: 10 },
    };
    const pts = computePathPoints(sel, GEM, STREETS);
    expect(pts).toEqual([
      { x: 25, z: 0 }, // gem
      { x: 200, z: 0 }, // bend at root/src == walk-along point, emitted once
      { x: 215, z: 0 }, // perpendicular to building edge
    ]);
  });

  it('directory selection three-deep produces 4 segments (chain walks through all parents)', () => {
    // Add a deeper dir for this test
    const INNER: TestStreet = {
      x: 245,
      y: -75,
      length: 20,
      width: 10,
      orientation: StreetAxis.Y,
      dir: { path: 'src/scene/inner' },
    };
    const streets = { ...STREETS, 'src/scene/inner': INNER };
    const sel = { kind: NodeKind.Directory, dir: { path: 'src/scene/inner' } };
    const pts = computePathPoints(sel, GEM, streets);
    // Chain = [root, src, scene, inner]. pts = [gem, bend1, bend2, bend3, end] = 5 points.
    expect(pts.length).toBe(5);
  });
});
