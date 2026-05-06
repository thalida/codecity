import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { groupBuildingsByDirectory, type SceneBlock } from '@/scene/blocks.js';
import type { Building, Street } from '@/types/index.js';
import { BuildingOrient, StreetAxis, NodeKind } from '@/types/index.js';

function fakeBuilding(file: string, x = 0, y = 0, w = 1, h = 1, d = 1, color = '#abc123'): Building {
  return {
    x, y, w, d, h,
    color,
    floors: 1,
    orient: BuildingOrient.North,
    file: { path: file, name: file.split('/').pop()!, type: NodeKind.File,
            fullPath: '/abs/' + file, extension: '.txt', size: 0, lines: 1,
            binary: false, created: '', modified: '', git: null },
  } as Building;
}
function fakeStreet(dirPath: string): Street {
  return { x: 0, y: 0, length: 10, width: 1, label: dirPath.split('/').pop() || '/',
           orientation: StreetAxis.X,
           dir: { path: dirPath, name: dirPath.split('/').pop() || 'root',
                  type: NodeKind.Directory, fullPath: '/abs/' + dirPath,
                  children: [], children_count: 0, children_file_count: 0,
                  children_dir_count: 0, descendants_count: 0,
                  descendants_file_count: 0, descendants_dir_count: 0,
                  descendants_size: 0 } } as Street;
}

describe('groupBuildingsByDirectory', () => {
  it('groups buildings by their parent directory (= street)', () => {
    const buildings = [
      fakeBuilding('src/a.ts'),
      fakeBuilding('src/b.ts'),
      fakeBuilding('tests/x.ts'),
    ];
    const streets = [fakeStreet('src'), fakeStreet('tests')];
    const blocks = groupBuildingsByDirectory(buildings, streets);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].dir.path).toBe('src');
    expect(blocks[0].buildings).toHaveLength(2);
    expect(blocks[1].dir.path).toBe('tests');
    expect(blocks[1].buildings).toHaveLength(1);
  });

  it('computes a bounding box covering all buildings in the block', () => {
    const buildings = [
      fakeBuilding('src/a', 0, 0, 2, 1, 2),
      fakeBuilding('src/b', 5, 5, 4, 3, 4),
    ];
    const streets = [fakeStreet('src')];
    const [block] = groupBuildingsByDirectory(buildings, streets);
    // Building.h is in scene-Y; .x/.y are layout (mapped to scene XZ).
    // bbox should cover both extents.
    expect(block.bbox.min.x).toBeLessThanOrEqual(-1); // a's left edge
    expect(block.bbox.max.x).toBeGreaterThanOrEqual(7); // b's right edge
    expect(block.bbox.max.y).toBeGreaterThanOrEqual(3); // b's height
  });

  it('computes mean color across the block', () => {
    const buildings = [
      fakeBuilding('src/a', 0, 0, 1, 1, 1, '#ff0000'),
      fakeBuilding('src/b', 0, 0, 1, 1, 1, '#0000ff'),
    ];
    const streets = [fakeStreet('src')];
    const [block] = groupBuildingsByDirectory(buildings, streets);
    // Mean of red + blue ≈ purple. R=128, G=0, B=128.
    expect(block.meanColor.r).toBeCloseTo(0.5, 1);
    expect(block.meanColor.g).toBeCloseTo(0, 1);
    expect(block.meanColor.b).toBeCloseTo(0.5, 1);
  });

  it('computes mean color correctly for non-primary colors (guards sRGB→linear)', () => {
    // '#804000' is a mid-orange-brown; its sRGB→linear values differ from
    // naive 0–255 division, catching color-space regressions.
    const buildings = [fakeBuilding('src/a', 0, 0, 1, 1, 1, '#804000')];
    const streets = [fakeStreet('src')];
    const [block] = groupBuildingsByDirectory(buildings, streets);
    const expected = new THREE.Color('#804000');
    expect(block.meanColor.r).toBeCloseTo(expected.r, 2);
    expect(block.meanColor.g).toBeCloseTo(expected.g, 2);
    expect(block.meanColor.b).toBeCloseTo(expected.b, 2);
  });

  it('includes root-level files (no slash in path) in the "." block', () => {
    // Regression for C1: root-level files had dirPath='' which never matched
    // the root street's dir.path='.', causing them to be silently dropped.
    const buildings = [
      fakeBuilding('README.md'),
      fakeBuilding('package.json'),
    ];
    const streets = [fakeStreet('.')];
    const blocks = groupBuildingsByDirectory(buildings, streets);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dir.path).toBe('.');
    expect(blocks[0].buildings).toHaveLength(2);
  });

  it('preserves building order within a block', () => {
    const buildings = [
      fakeBuilding('src/a'),
      fakeBuilding('src/b'),
      fakeBuilding('src/c'),
    ];
    const streets = [fakeStreet('src')];
    const [block] = groupBuildingsByDirectory(buildings, streets);
    expect(block.buildings.map((b) => b.file!.path)).toEqual(['src/a', 'src/b', 'src/c']);
  });

  it('handles a directory with no buildings', () => {
    const streets = [fakeStreet('empty')];
    const blocks = groupBuildingsByDirectory([], streets);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].buildings).toHaveLength(0);
    // Fallback hash path must still produce a valid color.
    const mc = blocks[0].meanColor;
    expect(mc).toBeInstanceOf(THREE.Color);
    expect(mc.r).toBeGreaterThanOrEqual(0);
    expect(mc.r).toBeLessThanOrEqual(1);
    expect(mc.g).toBeGreaterThanOrEqual(0);
    expect(mc.g).toBeLessThanOrEqual(1);
    expect(mc.b).toBeGreaterThanOrEqual(0);
    expect(mc.b).toBeLessThanOrEqual(1);
  });
});
