// Shared test fixtures for city scene tests. Replaces inline copies of
// bbox()/emptyLayout()/mkFile()/mkDir() and the trees/buildings
// config resets that had begun to drift between callers (audit 2026-05-25).
// Task 8 migrates the consumers; this file only adds the helpers.
//
// Audit reality vs. plan:
//   - bbox()         : 4 byte-identical inline copies (treePlacement,
//                      treePlacementClient, worldBounds, and one more).
//   - emptyLayout()  : 3 byte-identical inline copies (same files minus
//                      worldBounds).
//   - mkFile/mkDir   : 4 inline copies across layoutPacker.test.ts,
//                      layout.test.ts (two variants inside one file), and
//                      bench/layout.bench.test.ts. Three are the simple
//                      `(name)` shape; the bench variant takes `(name,
//                      depth)` to pre-stamp paths and skips child-path
//                      prefixing in mkDir. We export the simple/canonical
//                      forms here (matches 3 of 4 call sites); the bench
//                      and the recursive quickjs-scenario `mkDir` in
//                      layout.test.ts (1233) stay local in Task 8.
//   - resets         : plan named these `resetTreesConfig` /
//                      `resetBuildingsConfig` but actual call sites use
//                      `resetTrees` / `resetBuildings` (treePlacement).
//                      We export two small functions in Task 8.
//
// The mkFile/mkDir helpers return `any` on purpose: the inline versions
// all do, because the real FileNode/DirNode interfaces require fields
// (fullPath, binary, git, descendants_file_count, ...) that the test
// fixtures intentionally omit. Tightening the return type would require
// padding every fixture with stub fields the production code under test
// never reads.

import { NodeKind } from '@/types';
import type { CityBbox, CityLayout } from '@/types';
import { TREES } from '@/config/components/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/components/buildings.js';

/** Builds a CityBbox from extents, deriving cx/cy/width/depth. */
export function bbox(minX: number, minY: number, maxX: number, maxY: number): CityBbox {
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    depth: maxY - minY,
  };
}

/** Minimal CityLayout with empty arrays and zeroed stats, wrapping the given bbox. */
export function emptyLayout(bb: CityBbox): CityLayout {
  return {
    buildings: [],
    streets: [],
    lineStats: { min: 0, max: 0 },
    byteStats: { min: 0, max: 0 },
    bbox: bb,
  };
}

/**
 * Builds a FileNode-shaped fixture. Returns `any` to match the inline
 * call-site behavior — the real FileNode requires fullPath/binary/git
 * that these fixtures intentionally omit (the code under test doesn't
 * read them).
 */
export function mkFile(name: string): any {
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

/**
 * Builds a DirNode-shaped fixture and re-prefixes every child's `path`
 * with `${name}/` so the fixture mirrors a real manifest (file paths are
 * dir-prefixed, e.g. 'big/aa.ts'). Without this, mkFile children carry
 * only their bare name and tests that filter by path prefix to identify
 * a subdir's descendants find nothing.
 *
 * Returns `any` for the same reason mkFile does — the inline call sites
 * all do, and the real DirNode requires fullPath/_count fields the
 * fixtures don't bother stubbing.
 */
export function mkDir(name: string, children: any[]): any {
  const prefixed = children.map((c) => ({ ...c, path: `${name}/${c.path || c.name}` }));
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

/** Resets the TREES config map to deterministic test defaults. */
export function resetTreesConfig(): void {
  TREES.set({
    TREES_ENABLED: true,
    EDGE_INSET_PERCENT: 8,
    TREE_DENSITY_FALLOFF: 0,
    TREE_MIN_HEIGHT: 48,
    TREE_MAX_HEIGHT: 144,
    TREE_MIN_WIDTH: 32,
    TREE_MAX_WIDTH: 128,
    TRUNK_HEIGHT_FRAC: 0.25,
    TRUNK_RADIUS_FRAC_OF_CANOPY: 0.15,
    CANOPY_TRUNK_OVERLAP_FRAC: 0.7,
    SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
    TREE_COLOR_BUSY_DAY: '#0a2613',
    TREE_COLOR_SOLO_DAY: '#a8d68a',
    TREE_SHADING_STRENGTH: 0.35,
    TREE_TRUNK_COLOR: '#4a3220',
    TREE_AGE_DESAT_ENABLED: false,
    TREE_AGE_SATURATION_MIN: 20,
    TREE_AGE_SATURATION_MAX: 100,
  });
}

/** Resets the BUILDING_DIMENSIONS config map to deterministic test defaults. */
export function resetBuildingsConfig(): void {
  BUILDING_DIMENSIONS.set({
    MIN_FLOORS: 2,
    MAX_FLOORS: 96,
    FLOOR_HEIGHT: 16,
    MIN_WIDTH: 8,
    MAX_WIDTH: 8,
    PATH_LENGTH: 8,
  });
}
