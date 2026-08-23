import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLayoutClient } from '@/city/layout';
import { NodeKind } from '@/types';
import type { Manifest, FileNode, RepoStats } from '@/types';
import { EMPTY_REPO_STATS } from '../../_helpers/manifestFixtures';
import { makeSession } from '../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

function makeMinimalManifest(): Manifest {
  return {
    src: '/tmp/x',
    branch: null,
    scanned_at: '2026-05-13T00:00:00Z',
    content_signature: 'sig',
    structure_signature: 'test-fp-1234',
    layout_signature: 'test-fp-1234',
    pending: [],
    readmePath: null,
    readmeModified: null,
    repo: { branch: null, remote_url: null, head_sha: null, head_subject: null, dirty: false },
    commits: [],
    busyness: { avg: 1, busy: 1 },
    dateRanges: { minCreated: null, maxCreated: null, minModified: null, maxModified: null },
    stats: EMPTY_REPO_STATS,
    tree: {
      name: 'x',
      type: NodeKind.Directory,
      path: '.',
      children: [
        {
          name: 'a.js',
          type: NodeKind.File,
          path: 'a.js',
          extension: '.js',
          size: 10,
          lines: 1,
          binary: false,
          dirty: false,
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
      descendants_created_min: null,
      descendants_modified_max: null,
      descendants_ext_breakdown: [],
    },
  };
}

describe('layoutClient', () => {
  let client: ReturnType<typeof createLayoutClient>;

  beforeEach(() => {
    client = createLayoutClient(session.config);
  });

  afterEach(() => {
    client.dispose();
  });

  it('compute() resolves with a populated CityLayout', async () => {
    const m = makeMinimalManifest();
    const layout = await client.compute(m);
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
    // Two files so the ranges have min != max and height normalization is
    // sensitive to line count. computeFileStats reads stats, not the tree.
    const STATS_WITH_RANGE: RepoStats = {
      ...EMPTY_REPO_STATS,
      lineCountRange: { min: 1, max: 1000 },
      byteSizeRange: { min: 10, max: 10000 },
    };
    const m1: Manifest = {
      src: '/tmp/x',
      branch: null,
      scanned_at: '2026-05-13T00:00:00Z',
      content_signature: 'sig',
      structure_signature: 'test-fp-reuse',
      layout_signature: 'test-fp-reuse',
      pending: [],
      readmePath: null,
      readmeModified: null,
      repo: { branch: null, remote_url: null, head_sha: null, head_subject: null, dirty: false },
      commits: [],
      busyness: { avg: 1, busy: 1 },
      dateRanges: { minCreated: null, maxCreated: null, minModified: null, maxModified: null },
      stats: STATS_WITH_RANGE,
      tree: {
        name: 'x',
        type: NodeKind.Directory,
        path: '.',
        children: [
          {
            name: 'small.js',
            type: NodeKind.File,
            path: 'small.js',
            extension: '.js',
            size: 10,
            lines: 1,
            binary: false,
            dirty: false,
            created: '2024-01-01T00:00:00Z',
            modified: '2024-01-01T00:00:00Z',
          },
          {
            name: 'large.js',
            type: NodeKind.File,
            path: 'large.js',
            extension: '.js',
            size: 10000,
            lines: 1000,
            binary: false,
            dirty: false,
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
        descendants_created_min: null,
        descendants_modified_max: null,
        descendants_ext_breakdown: [],
      },
    };
    const priorLayout = await client.compute(m1);
    expect(priorLayout.buildings.length).toBe(2);

    // In the new manifest, swap size/lines so the previously-small file becomes
    // large and vice-versa.
    const m2: Manifest = {
      ...m1,
      content_signature: 'sig2',
      tree: {
        ...m1.tree,
        children: [
          { ...(m1.tree.children[0] as FileNode), size: 10000, lines: 1000 } as FileNode,
          { ...(m1.tree.children[1] as FileNode), size: 10, lines: 1 } as FileNode,
        ],
      },
    };

    const reusedLayout = await client.compute(m2, priorLayout);
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
