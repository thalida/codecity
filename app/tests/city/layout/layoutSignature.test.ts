import { it, expect } from 'vitest';
import { computeLayoutSignature } from '@/city/layout';
import type { Manifest } from '@/types';
import { NodeKind } from '@/types';

function mkManifest(aSize: number, aModified = '2026-01-01T00:00:00Z'): Manifest {
  const file = {
    name: 'a.py',
    type: NodeKind.File,
    path: 'a.py',
    fullPath: '/r/a.py',
    extension: '.py',
    size: aSize,
    lines: 3,
    binary: false,
    created: '2026-01-01T00:00:00Z',
    modified: aModified,
    mediaKind: null,
    dirty: false,
  };
  return {
    tree: { name: 'r', type: NodeKind.Directory, path: '.', children: [file] },
  } as unknown as Manifest;
}

it('changes when a file size changes', () => {
  expect(computeLayoutSignature(mkManifest(10))).not.toBe(computeLayoutSignature(mkManifest(20)));
});

it('is stable when only dates change (size unchanged)', () => {
  expect(computeLayoutSignature(mkManifest(10, '2026-01-01T00:00:00Z'))).toBe(
    computeLayoutSignature(mkManifest(10, '2026-09-09T00:00:00Z'))
  );
});
