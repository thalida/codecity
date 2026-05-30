import { describe, it, expect } from 'vitest';
import { BuildingIndex } from '@/scene/components/buildings/buildingIndex';
import { NodeKind } from '@/types/index';
import type { FileNode, DirNode } from '@/types/manifest';
import { building } from '../../../_helpers/buildingFixture';

// Build a FileNode whose only meaningful fields are `path` and `name` (which
// is what BuildingIndex.insert reads via b.file.path). Other FileNode fields
// are defaulted to satisfy the type.
function fileFor(path: string): FileNode {
  return {
    path,
    name: path.split('/').pop()!,
    type: NodeKind.File,
    fullPath: `/abs/${path}`,
    extension: '.ts',
    size: 0,
    lines: 0,
    binary: false,
    created: '',
    modified: '',
    git: { created: null, modified: null },
  };
}

function makeDir(path: string): DirNode {
  return { name: path.split('/').pop() || 'root', path, type: 'dir' } as unknown as DirNode;
}

describe('BuildingIndex', () => {
  it('round-trips path → building and (cellId, slotId) → building', () => {
    const idx = new BuildingIndex();
    const dir = makeDir('src');
    const b = building({
      file: fileFor('src/foo.ts'),
      cellId: /* cellId */ 3,
      slotId: /* slotId */ 7,
      dirNode: dir,
    });

    idx.insert(b);

    expect(idx.byPath.get('src/foo.ts')).toBe(b);
    expect(idx.byCellSlot('3:7')).toBe(b);
    expect(idx.forEachInDir(dir)).toContain(b);
  });

  it('remove clears all maps', () => {
    const idx = new BuildingIndex();
    const dir = makeDir('src');
    const b = building({ file: fileFor('src/foo.ts'), cellId: 3, slotId: 7, dirNode: dir });
    idx.insert(b);
    idx.remove(b);

    expect(idx.byPath.get('src/foo.ts')).toBeUndefined();
    expect(idx.byCellSlot('3:7')).toBeUndefined();
    expect(Array.from(idx.forEachInDir(dir))).toHaveLength(0);
  });

  it('multiple buildings in same dir', () => {
    const idx = new BuildingIndex();
    const dir = makeDir('src');
    idx.insert(building({ file: fileFor('src/a.ts'), cellId: 1, slotId: 0, dirNode: dir }));
    idx.insert(building({ file: fileFor('src/b.ts'), cellId: 1, slotId: 1, dirNode: dir }));
    idx.insert(building({ file: fileFor('src/c.ts'), cellId: 2, slotId: 0, dirNode: dir }));

    const inDir = Array.from(idx.forEachInDir(dir));
    expect(inDir).toHaveLength(3);
  });
});
