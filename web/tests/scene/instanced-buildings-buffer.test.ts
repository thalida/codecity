import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildBuildingInstanceBuffer } from '@/scene/instanced/buildings.js';
import { groupBuildingsByDirectory } from '@/scene/blocks.js';
import type { Building, Street } from '@/types/index.js';
import { BuildingOrient, StreetAxis, NodeKind } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Test fixtures — copied from blocks.test.ts and extended with orient helper.
// ---------------------------------------------------------------------------

function fakeBuilding(
  file: string,
  x = 0,
  y = 0,
  w = 1,
  h = 1,
  d = 1,
  color = '#abc123',
): Building {
  return {
    x,
    y,
    w,
    d,
    h,
    color,
    floors: 1,
    orient: BuildingOrient.North,
    file: {
      path: file,
      name: file.split('/').pop()!,
      type: NodeKind.File,
      fullPath: '/abs/' + file,
      extension: '.txt',
      size: 0,
      lines: 1,
      binary: false,
      created: '',
      modified: '',
      git: null,
    },
  } as Building;
}

function fakeBuildingWithOrient(
  file: string,
  orient: 'south' | 'north' | 'east' | 'west',
): Building {
  const orientMap = {
    south: BuildingOrient.South,
    north: BuildingOrient.North,
    east: BuildingOrient.East,
    west: BuildingOrient.West,
  };
  const b = fakeBuilding(file);
  b.orient = orientMap[orient];
  return b;
}

function fakeStreet(dirPath: string): Street {
  return {
    x: 0,
    y: 0,
    length: 10,
    width: 1,
    label: dirPath.split('/').pop() || '/',
    orientation: StreetAxis.X,
    dir: {
      path: dirPath,
      name: dirPath.split('/').pop() || 'root',
      type: NodeKind.Directory,
      fullPath: '/abs/' + dirPath,
      children: [],
      children_count: 0,
      children_file_count: 0,
      children_dir_count: 0,
      descendants_count: 0,
      descendants_file_count: 0,
      descendants_dir_count: 0,
      descendants_size: 0,
    },
  } as Street;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildBuildingInstanceBuffer', () => {
  it('produces typed arrays sized N × stride per attribute', () => {
    const buildings = [
      fakeBuilding('src/a.ts'),
      fakeBuilding('src/b.ts'),
      fakeBuilding('src/c.ts'),
    ];
    const streets = [fakeStreet('src')];
    const blocks = groupBuildingsByDirectory(buildings, streets);
    const buf = buildBuildingInstanceBuffer(blocks[0]);
    expect(buf.matrix).toBeInstanceOf(Float32Array);
    expect(buf.matrix.length).toBe(3 * 16);
    expect(buf.color.length).toBe(3 * 3);
    expect(buf.cols.length).toBe(3 * 2);
    expect(buf.floors.length).toBe(3);
    expect(buf.orient.length).toBe(3);
    expect(buf.doorWidth.length).toBe(3);
    expect(buf.fade.length).toBe(3 * 3);
  });

  it('matrix decodes back to the building dimensions', () => {
    const b = fakeBuilding('src/a.ts', 5, 10, 2, 4, 3);
    const blocks = groupBuildingsByDirectory([b], [fakeStreet('src')]);
    const buf = buildBuildingInstanceBuffer(blocks[0]);
    const m = new THREE.Matrix4().fromArray(buf.matrix.subarray(0, 16));
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    m.decompose(pos, new THREE.Quaternion(), scale);
    expect(pos.x).toBeCloseTo(5);
    expect(pos.y).toBeCloseTo(2); // h/2
    expect(pos.z).toBeCloseTo(10);
    expect(scale.x).toBeCloseTo(2); // w
    expect(scale.y).toBeCloseTo(4); // h
    expect(scale.z).toBeCloseTo(3); // d
  });

  it('orient encoding maps BuildingOrient enum to 0/1/2/3 (S/N/E/W)', () => {
    // BuildingOrient: South='s', North='n', East='e', West='w'
    // Shader contract: 0=S, 1=N, 2=E, 3=W
    const buildings = [
      fakeBuildingWithOrient('src/s.ts', 'south'),
      fakeBuildingWithOrient('src/n.ts', 'north'),
      fakeBuildingWithOrient('src/e.ts', 'east'),
      fakeBuildingWithOrient('src/w.ts', 'west'),
    ];
    const blocks = groupBuildingsByDirectory(buildings, [fakeStreet('src')]);
    const buf = buildBuildingInstanceBuffer(blocks[0]);
    expect(Array.from(buf.orient)).toEqual([0, 1, 2, 3]);
  });

  it('opacity defaults to 1.0', () => {
    const blocks = groupBuildingsByDirectory(
      [fakeBuilding('src/a.ts'), fakeBuilding('src/b.ts')],
      [fakeStreet('src')],
    );
    const buf = buildBuildingInstanceBuffer(blocks[0]);
    expect(Array.from(buf.fade)).toEqual([1.0, 0, 0, 1.0, 0, 0]);
  });
});
