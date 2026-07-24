// tests/city/components/buildings/cellAssembly.test.ts — Tests for buildCellsFromLayout:
// sparse allocation, buildings-only scope, and Map-based output.
//
// SpatialGrid uses MIN_CELL_SIZE=12 world units per cell.

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { BUILDINGS } from '@/state/stores/settings/buildings';
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

  it('a dense cell over the global average allocates every building (no overflow skip)', () => {
    // 96×96 → cellSize 12. 100 buildings in cell 0 (x,z < 12) + 4 lone cells.
    // Old global cap = max(64, avg*4) ≈ 84 < 100, so the dense cell dropped
    // buildings; per-cell sizing must place all 100.
    const bounds = { minX: 0, maxX: 96, minZ: 0, maxZ: 96 };
    const dense = Array.from({ length: 100 }, (_, i) => building({ x: i % 10, y: 1 }));
    const sparse = [20, 32, 44, 56].map((x) => building({ x, y: 1 }));
    const out = buildCellsFromLayout(bounds, [...dense, ...sparse]);

    const cell0 = out.cells.get(0)!;
    expect(cell0.buildings.filter(Boolean).length).toBe(100);
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
        dirty: false,
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

  describe('MEDIA_ENABLED gate', () => {
    const bounds = { minX: 0, maxX: 50, minZ: 0, maxZ: 50 };
    const mediaBuilding = () =>
      building({
        x: 5,
        y: 5,
        file: {
          path: 'logo.png',
          name: 'logo.png',
          type: NodeKind.File,
          fullPath: '/abs/logo.png',
          extension: '.png',
          mediaKind: 'image',
          size: 100,
          lines: 0,
          binary: true,
          dirty: false,
          created: '',
          modified: '',
        },
      });

    afterEach(() => {
      BUILDINGS.value = { ...BUILDINGS.value, MEDIA_ENABLED: true };
    });

    it('builds an ad-panel mesh for media buildings when MEDIA_ENABLED (default)', () => {
      const out = buildCellsFromLayout(bounds, [mediaBuilding()]);
      expect(out.facadePanels).not.toBeNull();
    });

    it('skips the ad-panel mesh entirely when MEDIA_ENABLED is off', () => {
      BUILDINGS.value = { ...BUILDINGS.value, MEDIA_ENABLED: false };
      const out = buildCellsFromLayout(bounds, [mediaBuilding()]);
      expect(out.facadePanels).toBeNull();
      // The building itself still renders (its cell + detail mesh exist).
      expect(out.cells.size).toBeGreaterThan(0);
      expect(out.index.byPath.get('logo.png')).toBeDefined();
    });
  });

  describe('DATA_ENABLED gate', () => {
    const bounds = { minX: 0, maxX: 50, minZ: 0, maxZ: 50 };
    const dataBuilding = () =>
      building({
        x: 5,
        y: 5,
        file: {
          path: 'app.db',
          name: 'app.db',
          type: NodeKind.File,
          fullPath: '/abs/app.db',
          extension: '.db',
          mediaKind: null,
          size: 5000,
          lines: 0,
          binary: true,
          dirty: false,
          created: '',
          modified: '',
        },
      });

    afterEach(() => {
      BUILDINGS.value = { ...BUILDINGS.value, DATA_ENABLED: true };
    });

    it('registers a facade panel for a binary building when DATA_ENABLED (default)', () => {
      expect(buildCellsFromLayout(bounds, [dataBuilding()]).facadePanels).not.toBeNull();
    });

    it('skips the facade when DATA_ENABLED is off, but the block still renders', () => {
      BUILDINGS.value = { ...BUILDINGS.value, DATA_ENABLED: false };
      const out = buildCellsFromLayout(bounds, [dataBuilding()]);
      expect(out.facadePanels).toBeNull();
      expect(out.cells.size).toBeGreaterThan(0);
      expect(out.index.byPath.get('app.db')).toBeDefined();
    });
  });
});
