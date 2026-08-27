import { describe, it, expect } from 'vitest';
import { findNodeByPath } from '@/utils/manifest';
import { NodeKind } from '@codecity/city';

const manifest = {
  tree: {
    name: 'r',
    type: NodeKind.Directory,
    path: '.',
    children: [
      { name: 'a.py', type: NodeKind.File, path: 'a.py', size: 1, lines: 1 },
      {
        name: 'sub',
        type: NodeKind.Directory,
        path: 'sub',
        children: [{ name: 'b.py', type: NodeKind.File, path: 'sub/b.py', size: 2, lines: 2 }],
      },
    ],
  },
} as any;

describe('findNodeByPath', () => {
  it('finds a nested file', () => {
    expect(findNodeByPath(manifest, 'sub/b.py')?.name).toBe('b.py');
  });
  it('finds the root dir', () => {
    expect(findNodeByPath(manifest, '.')?.type).toBe(NodeKind.Directory);
  });
  it('returns null on a miss', () => {
    expect(findNodeByPath(manifest, 'nope.py')).toBeNull();
  });
  it('returns null for an empty manifest', () => {
    expect(findNodeByPath(null, 'a.py')).toBeNull();
  });
});
