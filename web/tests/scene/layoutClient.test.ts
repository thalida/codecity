import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLayoutClient } from '@/scene/layoutClient.js';
import { NodeKind } from '@/types';
import type { Manifest } from '@/types';

function makeMinimalManifest(): Manifest {
  return {
    root: '/tmp/x',
    scanned_at: '2026-05-13T00:00:00Z',
    signature: 'sig',
    tree_signature: 'test-fp-1234',
    repo: null,
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
          git: null,
        },
      ],
      children_count: 1,
      children_file_count: 1,
      children_dir_count: 0,
      descendants_count: 1,
      descendants_file_count: 1,
      descendants_dir_count: 0,
      descendants_size: 10,
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
});
