import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLayoutClient } from '@/city/layout';
import { NodeKind } from '@/types';
import type { Manifest, FileNode, RepoStats } from '@/types';
import { EMPTY_REPO_STATS } from '@/constants/manifest';

function makeMinimalManifest(): Manifest {
  return {
    root: '/tmp/x',
    scanned_at: '2026-05-13T00:00:00Z',
    signature: 'sig',
    tree_signature: 'test-fp-1234',
    repo: { branch: null, remote_url: null, head_sha: null, head_subject: null, dirty: false },
    commits: [],
    busyness: { avg: 1, busy: 1 },
    dateRanges: { createdMin: null, createdMax: null, modifiedMin: null, modifiedMax: null },
    stats: EMPTY_REPO_STATS,
    tree: {
      name: 'x',
      type: NodeKind.Directory,
      path: '.',
      fullPath: '/tmp/x',
      children: [
        {
          name: 'a.js',
          type: NodeKind.File,
          path: 'a.js',
          fullPath: '/tmp/x/a.js',
          extension: '.js',
          size: 10,
          lines: 1,
          binary: false,
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-01T00:00:00Z',
        },
      ],
      children_count: 1,
      children_file_count: 1,
      children_dir_count: 0,
      descendants_count: 1,
      descendants_file_count: 1,
      descendants_dir_count: 0,
      descendants_size: 10,
      descendants_ext_breakdown: [],
    },
  };
}

describe('layoutClient', () => {
  let client: ReturnType<typeof createLayoutClient>;

  beforeEach(() => {
    client = createLayoutClient();
  });

  afterEach(() => {
    client.dispose();
  });

  it('compute() returns a Promise that resolves with a CityLayout', async () => {
    const m = makeMinimalManifest();
    const layout = await client.compute(m);
    expect(Array.isArray(layout.buildings)).toBe(true);
    expect(Array.isArray(layout.streets)).toBe(true);
    expect(layout.buildings.length).toBeGreaterThan(0);
    expect(layout.streets.length).toBeGreaterThan(0);
  });

  it('supersede: when a second compute() starts, the first promise rejects', async () => {
    const m = makeMinimalManifest();
    const first = client.compute(m);
    const second = client.compute(m);
    await expect(first).rejects.toThrow(/superseded/i);
    await expect(second).resolves.toBeDefined();
  });

  it('dispose() makes subsequent compute() calls reject', async () => {
    client.dispose();
    await expect(client.compute(makeMinimalManifest())).rejects.toThrow();
  });

  it('reuseLayoutFrom: skips the worker and returns a layout with same positions, fresh metadata', async () => {
    // Use a two-file manifest so lineStats has a real range (min != max),
    // making the height normalization sensitive to per-file line count.
    // stats.fileLines/fileBytes must reflect the actual file ranges so
    // computeFileStats (which reads manifest.stats, not the tree) uses the
    // correct range — matching the old tree-walk behaviour.
    const STATS_WITH_RANGE: RepoStats = {
      ...EMPTY_REPO_STATS,
      fileLines: { min: 1, max: 1000 },
      fileBytes: { min: 10, max: 10000 },
    };
    const m1: Manifest = {
      root: '/tmp/x',
      scanned_at: '2026-05-13T00:00:00Z',
      signature: 'sig',
      tree_signature: 'test-fp-reuse',
      repo: { branch: null, remote_url: null, head_sha: null, head_subject: null, dirty: false },
      commits: [],
      busyness: { avg: 1, busy: 1 },
      dateRanges: { createdMin: null, createdMax: null, modifiedMin: null, modifiedMax: null },
      stats: STATS_WITH_RANGE,
      tree: {
        name: 'x',
        type: NodeKind.Directory,
        path: '.',
        fullPath: '/tmp/x',
        children: [
          {
            name: 'small.js',
            type: NodeKind.File,
            path: 'small.js',
            fullPath: '/tmp/x/small.js',
            extension: '.js',
            size: 10,
            lines: 1,
            binary: false,
            created: '2024-01-01T00:00:00Z',
            modified: '2024-01-01T00:00:00Z',
          },
          {
            name: 'large.js',
            type: NodeKind.File,
            path: 'large.js',
            fullPath: '/tmp/x/large.js',
            extension: '.js',
            size: 10000,
            lines: 1000,
            binary: false,
            created: '2024-01-01T00:00:00Z',
            modified: '2024-01-01T00:00:00Z',
          },
        ],
        children_count: 2,
        children_file_count: 2,
        children_dir_count: 0,
        descendants_count: 2,
        descendants_file_count: 2,
        descendants_dir_count: 0,
        descendants_size: 10010,
        descendants_ext_breakdown: [],
      },
    };
    const priorLayout = await client.compute(m1);
    expect(priorLayout.buildings.length).toBe(2);

    // In the new manifest, swap size/lines so the previously-small file becomes
    // large and vice-versa.
    const m2: Manifest = {
      ...m1,
      signature: 'sig2',
      tree: {
        ...m1.tree,
        children: [
          { ...(m1.tree.children[0] as FileNode), size: 10000, lines: 1000 } as FileNode,
          { ...(m1.tree.children[1] as FileNode), size: 10, lines: 1 } as FileNode,
        ],
      },
    };

    const reusedLayout = await client.compute(m2, priorLayout);
    expect(Array.isArray(reusedLayout.buildings)).toBe(true);
    expect(reusedLayout.buildings.length).toBe(priorLayout.buildings.length);

    // All positions are preserved from the prior layout.
    for (let i = 0; i < priorLayout.buildings.length; i++) {
      expect(reusedLayout.buildings[i].x).toBe(priorLayout.buildings[i].x);
      expect(reusedLayout.buildings[i].y).toBe(priorLayout.buildings[i].y);
    }

    // Dimensions have been recomputed: building at index 0 (small.js) started
    // with 1 line and is now 1000 lines → its height should increase.
    const smallBuildingPrior = priorLayout.buildings.find((b) => b.file?.path === 'small.js')!;
    const smallBuildingReused = reusedLayout.buildings.find((b) => b.file?.path === 'small.js')!;
    expect(smallBuildingReused.h).toBeGreaterThan(smallBuildingPrior.h);

    // File ref points to the new manifest's FileNode.
    expect(smallBuildingReused.file?.size).toBe(10000);
  });

  it('reuseLayoutFrom: supersede protocol still works on the reuse path', async () => {
    const m = makeMinimalManifest();
    const priorLayout = await client.compute(m);
    const first = client.compute(m, priorLayout);
    const second = client.compute(m, priorLayout);
    await expect(first).rejects.toThrow(/superseded/i);
    await expect(second).resolves.toBeDefined();
  });
});
