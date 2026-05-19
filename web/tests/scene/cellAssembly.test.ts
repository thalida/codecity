// tests/scene/cellAssembly.test.ts — Tests for buildCellsFromLayout:
// sparse allocation, buildings-only scope, and Map-based output.
//
// SpatialGrid uses CELL_SIZE=12 world units per cell.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCellsFromLayout } from '@/scene/cellAssembly.js';
import { BuildingOrient, NodeKind } from '@/types/index.js';
import type { Building } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Minimal Building fixture — only fields needed by buildCellsFromLayout.
// ---------------------------------------------------------------------------

function fakeBuilding(x: number, y: number, overrides: Partial<Building> = {}): Building {
  return {
    x,
    y,
    w: overrides.w ?? 2,
    d: overrides.d ?? 2,
    h: overrides.h ?? 4,
    color: overrides.color ?? '#aabbcc',
    orient: overrides.orient ?? BuildingOrient.South,
    floors: overrides.floors ?? 1,
    cellId: 0,
    slotId: 0,
    createdAge: 0,
    modifiedAge: 0,
    file: {
      path: overrides.file?.path ?? `file_${x}_${y}.ts`,
      name: overrides.file?.name ?? `file_${x}_${y}.ts`,
      type: NodeKind.File,
      fullPath: `/abs/file_${x}_${y}.ts`,
      extension: '.ts',
      size: 100,
      lines: 10,
      binary: false,
      created: '',
      modified: '',
      git: null,
    },
    ...overrides,
  } as Building;
}

const EMPTY_UNIFORMS: Record<string, THREE.IUniform> = {};

// CELL_SIZE from spatialGrid.ts is 12 world units.
// Use this constant to reason about which cell buildings land in.
const CELL_SIZE = 12;

// ---------------------------------------------------------------------------

describe('buildCellsFromLayout', () => {
  it('returns a Map, SpatialGrid, BuildingIndex, and a sceneRoot Group', () => {
    const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
    const buildings = [fakeBuilding(10, 10), fakeBuilding(20, 20)];
    const out = buildCellsFromLayout(bounds, buildings, EMPTY_UNIFORMS);

    expect(out.cells).toBeInstanceOf(Map);
    expect(out.grid).toBeDefined();
    expect(out.index).toBeDefined();
    expect(out.sceneRoot).toBeInstanceOf(THREE.Group);
    expect(out.sceneRoot.name).toBe('CellRoot');
  });

  it('sparse allocation: only occupied cells are created', () => {
    // Large bounds with buildings clustered in one corner.
    // 600×600 / CELL_SIZE(12) = 50×50 = 2500 total cells.
    // All buildings are at (x<12, z<12) → all land in cell 0.
    const bounds = { minX: 0, maxX: 600, minZ: 0, maxZ: 600 };
    const buildings = [
      fakeBuilding(1, 1),
      fakeBuilding(3, 5),
      fakeBuilding(7, 2),
      fakeBuilding(10, 9),
    ];
    const out = buildCellsFromLayout(bounds, buildings, EMPTY_UNIFORMS);

    // All buildings land in the same cell (x<CELL_SIZE and z<CELL_SIZE).
    expect(out.cells.size).toBe(1);
    // Full grid covers the 600×600 space → many more cells.
    expect(out.grid.cellCount).toBe(50 * 50); // 2500
    // Sparse: occupied cells  total cells.
    expect(out.cells.size).toBeLessThan(out.grid.cellCount);
  });

  it('sparse allocation: buildings in N distinct cells → cells.size === N', () => {
    // Place buildings so each lands in a different CELL_SIZE×CELL_SIZE bucket.
    // Stride by CELL_SIZE to guarantee a distinct cell per building.
    const N = 5;
    const bounds = { minX: 0, maxX: N * CELL_SIZE * 2, minZ: 0, maxZ: N * CELL_SIZE * 2 };
    // Each building at (i*CELL_SIZE + 1, 1) → distinct column cells.
    const buildings = Array.from({ length: N }, (_, i) =>
      fakeBuilding(i * CELL_SIZE + 1, 1),
    );
    const out = buildCellsFromLayout(bounds, buildings, EMPTY_UNIFORMS);

    expect(out.cells.size).toBe(N);
    expect(out.grid.cellCount).toBeGreaterThan(N);
  });

  it('sceneRoot has 2 children per occupied cell (detailMesh + impostorMesh)', () => {
    // 2 buildings in different cells → 2 occupied cells → 4 scene children.
    // Stride by CELL_SIZE to guarantee distinct cells.
    const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
    const buildings = [
      fakeBuilding(1, 1),              // cell at grid-col 0, row 0
      fakeBuilding(CELL_SIZE + 1, 1),  // cell at grid-col 1, row 0
    ];
    const out = buildCellsFromLayout(bounds, buildings, EMPTY_UNIFORMS);

    expect(out.cells.size).toBe(2);
    // 2 cells × 2 meshes (detail + impostor) = 4 children in sceneRoot.
    expect(out.sceneRoot.children.length).toBe(4);
  });

  it('each occupied cell has detailMesh visible and impostorMesh hidden', () => {
    const bounds = { minX: 0, maxX: 50, minZ: 0, maxZ: 50 };
    const buildings = [fakeBuilding(5, 5)];
    const out = buildCellsFromLayout(bounds, buildings, EMPTY_UNIFORMS);

    expect(out.cells.size).toBe(1);
    const [cell] = out.cells.values();
    expect(cell.detailMesh.visible).toBe(true);
    expect(cell.impostorMesh.visible).toBe(false);
    // labelMesh stays off — labels come from legacy streetLabels path.
    expect(cell.labelMesh.visible).toBe(false);
  });

  it('no Mesh (street tile) is added to sceneRoot — only InstancedMeshes', () => {
    const bounds = { minX: 0, maxX: 50, minZ: 0, maxZ: 50 };
    const buildings = [fakeBuilding(5, 5)];
    const out = buildCellsFromLayout(bounds, buildings, EMPTY_UNIFORMS);

    for (const child of out.sceneRoot.children) {
      expect(child).toBeInstanceOf(THREE.InstancedMesh);
    }
  });

  it('buildings are indexed and retrievable by path', () => {
    const bounds = { minX: 0, maxX: 50, minZ: 0, maxZ: 50 };
    const b = fakeBuilding(5, 5, {
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
        git: null,
      },
    });
    const out = buildCellsFromLayout(bounds, [b], EMPTY_UNIFORMS);

    expect(out.index.byPath.get('src/foo.ts')).toBeDefined();
  });

  it('handles empty buildings array without throwing', () => {
    const bounds = { minX: 0, maxX: 200, minZ: 0, maxZ: 200 };
    const out = buildCellsFromLayout(bounds, [], EMPTY_UNIFORMS);

    expect(out.cells.size).toBe(0);
    expect(out.sceneRoot.children.length).toBe(0);
  });
});
