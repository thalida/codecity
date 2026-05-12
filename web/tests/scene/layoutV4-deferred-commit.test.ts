// layoutV4-deferred-commit.test.ts — exercises the new pre-compute + commit
// split. Pre-compute produces a PreComputedSubtree with correct road length
// for synthetic trees; commit (added in Task 3) produces a layout where
// subtrees that V4 would have stranded sit close to their alphabetical
// predecessors.

import { describe, it, expect } from 'vitest';
import { _preComputeDirV4, _commitDirV4 } from '@/scene/layoutV4.js';
import type { PreComputedSubtree } from '@/scene/layoutV4.js';
import { WorldOccupancy } from '@/scene/worldOccupancy.js';
import { NodeKind, StreetAxis } from '@/types';
import type { DirNode, FileNode, CityLayout } from '@/types';
import type { DirLike } from '@/scene/layout.js';

function makeFile(name: string, size = 100, lines = 10): FileNode {
  return {
    name,
    type: NodeKind.File,
    path: name,
    fullPath: `/tmp/${name}`,
    extension: '.ts',
    size, lines,
    binary: false,
    created: '2024-01-10T09:00:00Z',
    modified: '2024-03-22T14:30:00Z',
    git: null,
  } as unknown as FileNode;
}

function makeDir(name: string, children: (FileNode | DirNode)[]): DirNode {
  return {
    name,
    type: NodeKind.Directory,
    path: name === 'root' ? '.' : name,
    fullPath: `/tmp/${name}`,
    children,
    children_count: children.length,
    children_file_count: children.filter((c) => c.type === NodeKind.File).length,
    children_dir_count: children.filter((c) => c.type === NodeKind.Directory).length,
    descendants_count: children.length,
    descendants_file_count: children.filter((c) => c.type === NodeKind.File).length,
    descendants_dir_count: children.filter((c) => c.type === NodeKind.Directory).length,
    descendants_size: 100 * children.length,
  } as unknown as DirNode;
}

describe('_preComputeDirV4', () => {
  it('flat tree with two files — returns a struct with 2 file children', () => {
    const tree = makeDir('root', [makeFile('a.ts'), makeFile('b.ts')]);
    const lineStats = { min: 10, max: 10 };
    const byteStats = { min: 100, max: 100 };
    const result = _preComputeDirV4(tree as unknown as DirLike, undefined, lineStats, byteStats, StreetAxis.X);
    expect(result.dir).toBe(tree);
    expect(result.children).toHaveLength(2);
    expect(result.children[0].kind).toBe('file');
    if (result.children[0].kind === 'file') {
      expect(result.children[0].file.name).toBe('a.ts');
      expect(result.children[0].rects.length).toBeGreaterThanOrEqual(2);  // building + path
    }
    expect(result.children[1].kind).toBe('file');
    expect(result.road.length).toBeGreaterThan(0);
    expect(result.road.orient).toBe(StreetAxis.X);
  });

  it('nested tree — returns a recursive subdir struct', () => {
    const sub = makeDir('sub', [makeFile('x.ts')]);
    const tree = makeDir('root', [sub]);
    const lineStats = { min: 10, max: 10 };
    const byteStats = { min: 100, max: 100 };
    const result = _preComputeDirV4(tree as unknown as DirLike, undefined, lineStats, byteStats, StreetAxis.X);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].kind).toBe('subdir');
    if (result.children[0].kind === 'subdir') {
      expect(result.children[0].subtree.dir).toBe(sub);
      expect(result.children[0].subtree.children).toHaveLength(1);
      expect(result.children[0].subtree.children[0].kind).toBe('file');
      // Sub's road orientation is perpendicular to root's.
      expect(result.children[0].subtree.road.orient).toBe(StreetAxis.Y);
    }
  });

  it("subtree's road length is at least originPad + endPad", () => {
    const tree = makeDir('root', [makeFile('a.ts')]);
    const lineStats = { min: 10, max: 10 };
    const byteStats = { min: 100, max: 100 };
    const result = _preComputeDirV4(tree as unknown as DirLike, undefined, lineStats, byteStats, StreetAxis.X);
    expect(result.road.length).toBeGreaterThanOrEqual(result.originPad + result.endPad);
  });
});

describe('_commitDirV4', () => {
  it('flat tree — places files alphabetically on root road', () => {
    const tree = makeDir('root', [makeFile('a.ts'), makeFile('b.ts')]);
    const lineStats = { min: 10, max: 10 };
    const byteStats = { min: 100, max: 100 };
    const subtree = _preComputeDirV4(tree as unknown as DirLike, undefined, lineStats, byteStats, StreetAxis.X);

    const layout: CityLayout = {
      streets: [], buildings: [], paths: [],
      lineStats, byteStats,
    };
    const occupancy = new WorldOccupancy();
    _commitDirV4(subtree, 0, 0, undefined, occupancy, layout);

    expect(layout.buildings).toHaveLength(2);
    expect(layout.streets.length).toBeGreaterThanOrEqual(1);
    // Buildings should be ordered alphabetically along the root road.
    const aBuilding = layout.buildings.find((b) => (b.file as unknown as FileNode).name === 'a.ts');
    const bBuilding = layout.buildings.find((b) => (b.file as unknown as FileNode).name === 'b.ts');
    expect(aBuilding).toBeDefined();
    expect(bBuilding).toBeDefined();
    if (aBuilding && bBuilding) {
      // Alphabetical ordering: a.ts stem ≤ b.ts stem (they may share the same
      // stem if placed on opposite sides of the road).
      expect(aBuilding.x).toBeLessThanOrEqual(bBuilding.x);
    }
  });

  it("nested tree — subdir's road is placed, then its children", () => {
    const sub = makeDir('sub', [makeFile('x.ts')]);
    const tree = makeDir('root', [sub]);
    const lineStats = { min: 10, max: 10 };
    const byteStats = { min: 100, max: 100 };
    const subtree = _preComputeDirV4(tree as unknown as DirLike, undefined, lineStats, byteStats, StreetAxis.X);

    const layout: CityLayout = {
      streets: [], buildings: [], paths: [],
      lineStats, byteStats,
    };
    const occupancy = new WorldOccupancy();
    _commitDirV4(subtree, 0, 0, undefined, occupancy, layout);

    // 2 streets: root + sub.
    expect(layout.streets).toHaveLength(2);
    expect(layout.buildings).toHaveLength(1);
    const xBuilding = layout.buildings[0];
    expect((xBuilding.file as unknown as FileNode).name).toBe('x.ts');
  });

  it('road appears in layout with final (possibly extended) length', () => {
    const tree = makeDir('root', [makeFile('a.ts')]);
    const lineStats = { min: 10, max: 10 };
    const byteStats = { min: 100, max: 100 };
    const subtree = _preComputeDirV4(tree as unknown as DirLike, undefined, lineStats, byteStats, StreetAxis.X);

    const layout: CityLayout = {
      streets: [], buildings: [], paths: [],
      lineStats, byteStats,
    };
    const occupancy = new WorldOccupancy();
    _commitDirV4(subtree, 0, 0, undefined, occupancy, layout);

    expect(layout.streets).toHaveLength(1);
    // The road length should be at least the pre-compute estimate.
    expect(layout.streets[0].length).toBeGreaterThanOrEqual(subtree.road.length);
  });
});
