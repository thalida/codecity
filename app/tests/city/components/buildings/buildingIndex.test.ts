import { describe, it, expect } from 'vitest';
import { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import { NodeKind } from '@/types/index';
import type { FileNode } from '@/types/manifest';
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

describe('BuildingIndex', () => {
  it('round-trips path → building and (cellId, slotId) → building', () => {
    const idx = new BuildingIndex();
    const b = building({
      file: fileFor('src/foo.ts'),
      cellId: /* cellId */ 3,
      slotId: /* slotId */ 7,
    });

    idx.insert(b);

    expect(idx.byPath.get('src/foo.ts')).toBe(b);
    expect(idx.byCellSlot('3:7')).toBe(b);
  });
});
