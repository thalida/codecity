// applyManifestReuse.test.ts — the reuse gate must key on the layout
// signature (structure + per-file size), not the structure-only
// tree_signature (#74). A live content edit changes a file's size without
// touching paths/nesting, so the old tree_signature-only gate reused a stale
// layout on every edit; the new gate re-packs (bumps structureRevision)
// whenever the packer's actual inputs change.

import { describe, it, expect, vi } from 'vitest';
import { createCityState } from '@/city/state';
import { NodeKind } from '@/types';
import type { CityLayout, DateRanges, Manifest } from '@/types';

const EMPTY_DATE_RANGES: DateRanges = {
  minCreated: null,
  maxCreated: null,
  minModified: null,
  maxModified: null,
} as unknown as DateRanges;

// Same path set/nesting (tree_signature) across every call in a test — the
// only thing that varies is the file's size (and optionally its modified
// date), isolating the layout-signature gate from the tree_signature one.
function manifestWithSize(size: number, modified = '2026-01-01T00:00:00Z'): Manifest {
  const file = {
    name: 'a.py',
    type: NodeKind.File,
    path: 'a.py',
    fullPath: '/r/a.py',
    extension: '.py',
    size,
    lines: 3,
    binary: false,
    created: '2026-01-01T00:00:00Z',
    modified,
    mediaKind: null,
    dirty: false,
  };
  return {
    tree: { name: 'r', type: NodeKind.Directory, path: '.', children: [file] },
    tree_signature: 'sig-fixed',
    dateRanges: EMPTY_DATE_RANGES,
    commits: [],
    busyness: { avg: 1, busy: 1 },
  } as unknown as Manifest;
}

// Distinct layout object per compute() unless reuseLayoutFrom is supplied, in
// which case it returns that exact reference — mirroring the real
// layoutClient's reuse contract (see applyManifestScenic.test.ts).
function fakeLayoutClient() {
  return {
    compute: vi.fn(async (_m: Manifest, reuseFrom?: CityLayout | null) => {
      return (
        reuseFrom ??
        ({
          buildings: [],
          streets: [],
          lineStats: { min: 0, max: 0 },
          byteStats: { min: 0, max: 0 },
          bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, width: 0, depth: 0 },
        } as unknown as CityLayout)
      );
    }),
    dispose: vi.fn(),
  };
}

describe('cityState.applyManifest — reuse gate keys on the layout signature (#74)', () => {
  it('bumps structureRevision when a file size changes (full re-pack)', async () => {
    const state = createCityState(fakeLayoutClient() as never);
    await state.applyManifest(manifestWithSize(10));
    const before = state.structureRevision.value;
    await state.applyManifest(manifestWithSize(20)); // same paths, new size
    expect(state.structureRevision.value).toBe(before + 1);
  });

  it('does not bump structureRevision when only dates change (reuse)', async () => {
    const state = createCityState(fakeLayoutClient() as never);
    await state.applyManifest(manifestWithSize(10, '2026-01-01T00:00:00Z'));
    const before = state.structureRevision.value;
    await state.applyManifest(manifestWithSize(10, '2026-09-09T00:00:00Z')); // size unchanged
    expect(state.structureRevision.value).toBe(before);
  });
});
