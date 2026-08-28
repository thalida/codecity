// applyManifestReuse.test.ts — the reuse gate must key on the backend
// layout_signature (structure + per-file size), not structure_signature (#74):
// an edit changes a file's size without touching paths, so the structure-only
// gate reused a stale layout every time.

import { stubPlacementClient } from '../_helpers/cityFixtures';
import { describe, it, expect, vi } from 'vitest';
import { createCityState } from '@/city/state';
import { createTestCityResources } from '../_helpers/cityResources';
import { DateRanges, Manifest, NodeKind } from '@/city/types/manifest';
import { CityLayout } from '@/city/types/scene';
import { settingsStore } from '../_helpers/citySettings';
import type { LayoutConfig } from '@/city/layout/config';
import { createEmitter } from '../_helpers/cityEvents';

const SETTINGS = settingsStore();

const EMPTY_DATE_RANGES: DateRanges = {
  minCreated: null,
  maxCreated: null,
  minModified: null,
  maxModified: null,
} as unknown as DateRanges;

// layoutSig is set independently of `size`, so varying one while holding the
// other proves the FIELD drives the reuse decision, not the tree.
function manifest(layoutSig: string, size = 10, modified = '2026-01-01T00:00:00Z'): Manifest {
  const file = {
    name: 'a.py',
    type: NodeKind.File,
    path: 'a.py',
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
    structure_signature: 'sig-fixed',
    layout_signature: layoutSig,
    dateRanges: EMPTY_DATE_RANGES,
    commits: [],
    busyness: { avg: 1, busy: 1 },
  } as unknown as Manifest;
}

// A distinct layout per compute unless reuseLayoutFrom is supplied, mirroring
// the real client's reuse contract (see applyManifestScenic.test.ts).
function fakeLayoutClient() {
  return {
    compute: vi.fn(async (_m: Manifest, _cfg: LayoutConfig, reuseFrom?: CityLayout | null) => {
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
  it('bumps structureRevision when layout_signature changes (full re-pack)', async () => {
    const state = createCityState(
      fakeLayoutClient() as never,
      stubPlacementClient() as never,
      createTestCityResources(),
      SETTINGS,
      createEmitter()
    );
    await state.applyManifest(manifest('L1'));
    let structures = 0;
    state.on('structure', () => structures++);
    await state.applyManifest(manifest('L2')); // layout_signature changed
    expect(structures).toBe(1);
  });

  // The discriminating case: the file size changes but layout_signature does
  // not, so a gate recomputing it from the tree would re-pack and fail here.
  it('reuses when layout_signature is unchanged even if the tree size differs', async () => {
    const state = createCityState(
      fakeLayoutClient() as never,
      stubPlacementClient() as never,
      createTestCityResources(),
      SETTINGS,
      createEmitter()
    );
    await state.applyManifest(manifest('L1', 10));
    let structures = 0;
    state.on('structure', () => structures++);
    await state.applyManifest(manifest('L1', 999)); // different tree size, SAME field
    expect(structures).toBe(0);
  });
});
