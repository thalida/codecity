// layoutV4-trace.test.ts — exercise the optional `trace` params on
// findSmallestValidStem, placeChild, and the layoutCityV4WithTrace entry.

import { describe, it, expect } from 'vitest';
import {
  findSmallestValidStem,
  placeChild,
  layoutCityV4WithTrace,
} from '@/scene/layoutV4.js';
import type {
  VariantTrace,
  StemPlacementTrace,
} from '@/scene/layoutV4.js';
import { WorldOccupancy } from '@/scene/worldOccupancy.js';
import { StreetAxis, NodeKind } from '@/types';
import type { DirNode, FileNode, Manifest } from '@/types';

describe('findSmallestValidStem with trace', () => {
  it('no obstacles — stem at baseline, no forbidden intervals, no binding', () => {
    const occupancy = new WorldOccupancy();
    const trace: VariantTrace = {
      side: 0, mirror: false, stem: 0,
      forbidden: [], bindingIndex: null,
    };
    const stem = findSmallestValidStem(
      {
        childRects: [{ x: 0, y: 0, w: 2, d: 2 }],
        parentOrient: StreetAxis.X,
        side: 0, mirror: false,
        parentOriginX: 0, parentOriginY: 0,
        priorStem: 0, originPad: 5, childGap: 1,
        occupancy,
      },
      trace,
    );
    expect(stem).toBe(5);
    expect(trace.stem).toBe(5);
    expect(trace.forbidden).toEqual([]);
    expect(trace.bindingIndex).toBe(null);
  });

  it('one obstacle in perp band — interval recorded, binding null when baseline already in gap', () => {
    const occupancy = new WorldOccupancy();
    // Obstacle: a building rect at along [10, 14], perp [-1, 1].
    const obstacle = {
      minX: 10, maxX: 14, minY: -1, maxY: 1,
      kind: 'building' as const,
      ref: { x: 12, y: 0, w: 4, d: 2 } as never,
    };
    occupancy.insert(obstacle);
    const trace: VariantTrace = {
      side: 0, mirror: false, stem: 0,
      forbidden: [], bindingIndex: null,
    };
    const stem = findSmallestValidStem(
      {
        childRects: [{ x: 0, y: 0, w: 2, d: 2 }],   // perp [-1, 1] — overlaps
        parentOrient: StreetAxis.X,
        side: 0, mirror: false,
        parentOriginX: 0, parentOriginY: 0,
        priorStem: 0, originPad: 5, childGap: 1,
        occupancy,
      },
      trace,
    );
    // baseline = 5. Forbidden interval: (10 - 1 - 1, 14 + 1 + 1) = (8, 16).
    // s=5 < lower=8 → return 5; no jump.
    expect(stem).toBe(5);
    expect(trace.forbidden).toHaveLength(1);
    expect(trace.forbidden[0].obstacle).toBe(obstacle);
    expect(trace.forbidden[0].fromChildRectIndex).toBe(0);
    expect(trace.bindingIndex).toBe(null);
  });

  it('obstacle forces jump — bindingIndex points to the interval that set the stem', () => {
    const occupancy = new WorldOccupancy();
    const obstacle = {
      minX: 4, maxX: 10, minY: -1, maxY: 1,
      kind: 'building' as const,
      ref: { x: 7, y: 0, w: 6, d: 2 } as never,
    };
    occupancy.insert(obstacle);
    const trace: VariantTrace = {
      side: 0, mirror: false, stem: 0,
      forbidden: [], bindingIndex: null,
    };
    const stem = findSmallestValidStem(
      {
        childRects: [{ x: 0, y: 0, w: 2, d: 2 }],
        parentOrient: StreetAxis.X,
        side: 0, mirror: false,
        parentOriginX: 0, parentOriginY: 0,
        priorStem: 0, originPad: 5, childGap: 1,
        occupancy,
      },
      trace,
    );
    // baseline=5. Forbidden: (4 - 1 - 1, 10 + 1 + 1) = (2, 12).
    // s=5 inside, jump to 12.
    expect(stem).toBe(12);
    expect(trace.forbidden).toHaveLength(1);
    expect(trace.bindingIndex).toBe(0);
  });
});

describe('placeChild with trace', () => {
  it('records every variant attempted with its stem and forbidden intervals', () => {
    const occupancy = new WorldOccupancy();
    // No obstacles — every variant returns baseline.
    const variants: VariantTrace[] = [];
    const result = placeChild(
      {
        childRects: [{ x: 0, y: 0, w: 2, d: 2 }],
        parentOrient: StreetAxis.X,
        parentOriginX: 0, parentOriginY: 0,
        priorStem: 0, originPad: 5, childGap: 1,
        occupancy,
      },
      { variants },
    );
    expect(result.stem).toBe(5);
    // Symmetric rect ⇒ mirror-invariant ⇒ only 2 variants evaluated.
    expect(variants).toHaveLength(2);
    expect(variants.map((v) => ({ side: v.side, mirror: v.mirror, stem: v.stem }))).toEqual([
      { side: 0, mirror: false, stem: 5 },
      { side: 1, mirror: false, stem: 5 },
    ]);
  });

  it('asymmetric rect list evaluates all 4 variants', () => {
    const occupancy = new WorldOccupancy();
    const variants: VariantTrace[] = [];
    // Asymmetric rect: x != 0 ⇒ not invariant under mirror flip.
    placeChild(
      {
        childRects: [{ x: 3, y: 0, w: 2, d: 2 }],
        parentOrient: StreetAxis.X,
        parentOriginX: 0, parentOriginY: 0,
        priorStem: 0, originPad: 5, childGap: 1,
        occupancy,
      },
      { variants },
    );
    expect(variants).toHaveLength(4);
    expect(variants.map((v) => ({ side: v.side, mirror: v.mirror }))).toEqual([
      { side: 0, mirror: false },
      { side: 1, mirror: false },
      { side: 0, mirror: true },
      { side: 1, mirror: true },
    ]);
  });
});

describe('layoutCityV4WithTrace', () => {
  it('returns { layout, trace } with one placement per child across the tree', () => {
    const files = [
      { path: 'a.ts', size: 100, lines: 10 },
      { path: 'b.ts', size: 200, lines: 20 },
    ];
    const tree: DirNode = {
      name: 'root',
      type: NodeKind.Directory,
      path: '.',
      fullPath: '/tmp/root',
      children: files.map((f) => ({
        name: f.path.split('/').pop()!,
        type: NodeKind.File,
        path: f.path,
        fullPath: `/tmp/root/${f.path}`,
        extension: '.ts',
        size: f.size,
        lines: f.lines,
        binary: false,
        created: '2024-01-10T09:00:00Z',
        modified: '2024-03-22T14:30:00Z',
        git: null,
      })) as unknown as FileNode[],
      children_count: files.length,
      children_file_count: files.length,
      children_dir_count: 0,
      descendants_count: files.length,
      descendants_file_count: files.length,
      descendants_dir_count: 0,
      descendants_size: files.reduce((s, f) => s + f.size, 0),
    } as unknown as DirNode;
    const manifest: Manifest = {
      root: '/tmp/root',
      scanned_at: '2026-05-11T00:00:00Z',
      signature: 'test',
      tree_signature: 'test-fp-1234',
      repo: null,
      commits: null,
      tree,
    };

    const { layout, trace } = layoutCityV4WithTrace(manifest as unknown as Parameters<typeof layoutCityV4WithTrace>[0]);

    expect(layout.buildings).toHaveLength(2);
    expect(layout.streets.length).toBeGreaterThanOrEqual(1);

    expect(trace.placements).toHaveLength(2);
    expect(trace.placements[0].childLabel).toBe('a.ts');
    expect(trace.placements[0].childKind).toBe('file');
    expect(trace.placements[0].parentPath).toBe('.');
    expect(trace.placements[1].childLabel).toBe('b.ts');
    expect(trace.placements[1].parentPath).toBe('.');

    for (const p of trace.placements) {
      expect(p.others.length + 1).toBeGreaterThanOrEqual(2);
      expect(p.chosen).toBeDefined();
      expect(typeof p.chosen.stem).toBe('number');
    }
  });

  it('captures the parentPath for grandchildren on a subdir road', () => {
    const subDir: DirNode = {
      name: 'sub',
      type: NodeKind.Directory,
      path: 'sub',
      fullPath: '/tmp/root/sub',
      children: [
        {
          name: 'x.ts',
          type: NodeKind.File,
          path: 'sub/x.ts',
          fullPath: '/tmp/root/sub/x.ts',
          extension: '.ts',
          size: 50,
          lines: 5,
          binary: false,
          created: '2024-01-10T09:00:00Z',
          modified: '2024-03-22T14:30:00Z',
          git: null,
        },
      ] as unknown as FileNode[],
      children_count: 1, children_file_count: 1, children_dir_count: 0,
      descendants_count: 1, descendants_file_count: 1, descendants_dir_count: 0,
      descendants_size: 50,
    } as unknown as DirNode;
    const tree: DirNode = {
      name: 'root',
      type: NodeKind.Directory,
      path: '.',
      fullPath: '/tmp/root',
      children: [subDir] as unknown as FileNode[],
      children_count: 1, children_file_count: 0, children_dir_count: 1,
      descendants_count: 2, descendants_file_count: 1, descendants_dir_count: 1,
      descendants_size: 50,
    } as unknown as DirNode;
    const manifest: Manifest = {
      root: '/tmp/root',
      scanned_at: '2026-05-11T00:00:00Z',
      signature: 'test2',
      tree_signature: 'test-fp-5678',
      repo: null,
      commits: null,
      tree,
    };

    const { trace } = layoutCityV4WithTrace(manifest as unknown as Parameters<typeof layoutCityV4WithTrace>[0]);

    expect(trace.placements).toHaveLength(2);
    const sub = trace.placements.find((p) => p.childLabel === 'sub');
    const x = trace.placements.find((p) => p.childLabel === 'x.ts');
    expect(sub?.parentPath).toBe('.');
    expect(x?.parentPath).toBe('sub');
    expect(sub?.childKind).toBe('dir');
    expect(x?.childKind).toBe('file');
  });
});
