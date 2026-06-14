// tests/city/components/buildings/cellAssembly.test.ts — Tests for buildCellsFromLayout:
// sparse allocation, buildings-only scope, and Map-based output.
//
// SpatialGrid uses MIN_CELL_SIZE=12 world units per cell.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { NodeKind } from '@/types/index';
import { building } from '../../../_helpers/buildingFixture';

// Use MIN_CELL_SIZE-sized bounds so computeOptimalCellSize returns 12
// and tests can reason about cell assignments with known granularity.
// Any bounds <= ~192×192 keeps cellSize at MIN_CELL_SIZE (12).
const CELL_SIZE = 12;

// ---------------------------------------------------------------------------

describe('buildCellsFromLayout', () => {
  it('returns a Map, SpatialGrid, BuildingIndex, and a sceneRoot Group', () => {
    const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
    const buildings = [building({ x: 10, y: 10 }), building({ x: 20, y: 20 })];
    const out = buildCellsFromLayout(bounds, buildings);

    expect(out.cells).toBeInstanceOf(Map);
    expect(out.grid).toBeDefined();
    expect(out.index).toBeDefined();
    expect(out.sceneRoot).toBeInstanceOf(THREE.Group);
    expect(out.sceneRoot.name).toBe('CellRoot');
  });

  it('sparse allocation: only occupied cells are created', () => {
    // Small bounds (96×96) keep cellSize at MIN_CELL_SIZE(12).
    // 96×96 / 12 = 8×8 = 64 total cells.
    // All buildings are at (x<12, z<12) → all land in cell 0.
    const bounds = { minX: 0, maxX: 96, minZ: 0, maxZ: 96 };
    const buildings = [
      building({ x: 1, y: 1 }),
      building({ x: 3, y: 5 }),
      building({ x: 7, y: 2 }),
      building({ x: 10, y: 9 }),
    ];
    const out = buildCellsFromLayout(bounds, buildings);

    // All buildings land in the same cell (x<CELL_SIZE and z<CELL_SIZE).
    expect(out.cells.size).toBe(1);
    // Full grid covers the 96×96 space → many more cells.
    expect(out.grid.cellCount).toBe(8 * 8); // 64
    // Sparse: occupied cells  total cells.
    expect(out.cells.size).toBeLessThan(out.grid.cellCount);
  });

  it('sparse allocation: buildings in N distinct cells → cells.size === N', () => {
    // Place buildings so each lands in a different CELL_SIZE×CELL_SIZE bucket.
    // Stride by CELL_SIZE to guarantee a distinct cell per building.
    // Use small enough bounds that cellSize stays at MIN_CELL_SIZE(12).
    const N = 5;
    const bounds = { minX: 0, maxX: N * CELL_SIZE * 2, minZ: 0, maxZ: CELL_SIZE * 2 };
    // Each building at (i*CELL_SIZE + 1, 1) → distinct column cells.
    const buildings = Array.from({ length: N }, (_, i) => building({ x: i * CELL_SIZE + 1, y: 1 }));
    const out = buildCellsFromLayout(bounds, buildings);

    expect(out.cells.size).toBe(N);
    expect(out.grid.cellCount).toBeGreaterThan(N);
  });

  it('sceneRoot has 1 child per occupied cell (detailMesh)', () => {
    // 2 buildings in different cells → 2 occupied cells → 2 scene children.
    // Use small bounds so cellSize stays at MIN_CELL_SIZE(12) and positions
    // CELL_SIZE apart guarantee distinct cells.
    const bounds = { minX: 0, maxX: 48, minZ: 0, maxZ: 48 };
    const buildings = [
      building({ x: 1, y: 1 }), // cell at grid-col 0, row 0
      building({ x: CELL_SIZE + 1, y: 1 }), // cell at grid-col 1, row 0
    ];
    const out = buildCellsFromLayout(bounds, buildings);

    expect(out.cells.size).toBe(2);
    // 2 cells × 1 mesh (detail) = 2 children in sceneRoot.
    expect(out.sceneRoot.children.length).toBe(2);
  });

  it('each occupied cell has a detailMesh', () => {
    const bounds = { minX: 0, maxX: 50, minZ: 0, maxZ: 50 };
    const buildings = [building({ x: 5, y: 5 })];
    const out = buildCellsFromLayout(bounds, buildings);

    expect(out.cells.size).toBe(1);
    const [cell] = out.cells.values();
    expect(cell.detailMesh).toBeDefined();
  });

  it('no Mesh (street tile) is added to sceneRoot — only InstancedMeshes', () => {
    const bounds = { minX: 0, maxX: 50, minZ: 0, maxZ: 50 };
    const buildings = [building({ x: 5, y: 5 })];
    const out = buildCellsFromLayout(bounds, buildings);

    for (const child of out.sceneRoot.children) {
      expect(child).toBeInstanceOf(THREE.InstancedMesh);
    }
  });

  it('buildings are indexed and retrievable by path', () => {
    const bounds = { minX: 0, maxX: 50, minZ: 0, maxZ: 50 };
    const b = building({
      x: 5,
      y: 5,
      file: {
        path: 'src/foo.ts',
        name: 'foo.ts',
        type: NodeKind.File,
        fullPath: '/abs/src/foo.ts',
        extension: '.ts',
        size: 100,
        lines: 10,
        binary: false,
        created: '',
        modified: '',
      },
    });
    const out = buildCellsFromLayout(bounds, [b]);

    expect(out.index.byPath.get('src/foo.ts')).toBeDefined();
  });

  it('handles empty buildings array without throwing', () => {
    const bounds = { minX: 0, maxX: 200, minZ: 0, maxZ: 200 };
    const out = buildCellsFromLayout(bounds, []);

    expect(out.cells.size).toBe(0);
    expect(out.sceneRoot.children.length).toBe(0);
  });
});
