import { describe, it, expect } from 'vitest';
import { BuildingIndex } from '@/scene/buildingIndex.js';
import type { Building } from '@/types/index.js';
import type { DirNode } from '@/types/manifest.js';

function makeBuilding(path: string, dir: DirNode, cellId: number, slotId: number): Building {
  return {
    file: { path, name: path.split('/').pop()! } as Building['file'],
    x: 0, y: 0, w: 1, d: 1, h: 1,
    color: '#888',
    cellId,
    slotId,
    dirNode: dir,
  } as unknown as Building;
}

function makeDir(path: string): DirNode {
  return { name: path.split('/').pop() || 'root', path, type: 'dir' } as unknown as DirNode;
}

describe('BuildingIndex', () => {
  it('round-trips path → building and (cellId, slotId) → building', () => {
    const idx = new BuildingIndex();
    const dir = makeDir('src');
    const b = makeBuilding('src/foo.ts', dir, /* cellId */ 3, /* slotId */ 7);

    idx.insert(b);

    expect(idx.byPath.get('src/foo.ts')).toBe(b);
    expect(idx.byCellSlot('3:7')).toBe(b);
    expect(idx.forEachInDir(dir)).toContain(b);
  });

  it('remove clears all maps', () => {
    const idx = new BuildingIndex();
    const dir = makeDir('src');
    const b = makeBuilding('src/foo.ts', dir, 3, 7);
    idx.insert(b);
    idx.remove(b);

    expect(idx.byPath.get('src/foo.ts')).toBeUndefined();
    expect(idx.byCellSlot('3:7')).toBeUndefined();
    expect(Array.from(idx.forEachInDir(dir))).toHaveLength(0);
  });

  it('multiple buildings in same dir', () => {
    const idx = new BuildingIndex();
    const dir = makeDir('src');
    idx.insert(makeBuilding('src/a.ts', dir, 1, 0));
    idx.insert(makeBuilding('src/b.ts', dir, 1, 1));
    idx.insert(makeBuilding('src/c.ts', dir, 2, 0));

    const inDir = Array.from(idx.forEachInDir(dir));
    expect(inDir).toHaveLength(3);
  });
});
