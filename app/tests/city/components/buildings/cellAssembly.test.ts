// tests/city/components/buildings/cellAssembly.test.ts — Tests for buildCellsFromLayout:
// sparse allocation, buildings-only scope, and Map-based output.
//
// SpatialGrid uses MIN_CELL_SIZE=12 world units per cell.

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { buildCellsFromLayout } from '@/city/components/buildings/cellAssembly';
import { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import { createEmptyCellTile } from '@/city/components/buildings/cellTile';
import { dataFacadeKind } from '@/city/components/buildings/dataFacade';
import { SpatialGrid } from '@/city/components/buildings/spatialGrid';
import { BUILDINGS } from '@/state/settings/fields/buildings';
import { NodeKind } from '@/types/index';
import type { FileNode } from '@/types/manifest';
import { building } from '../../../_helpers/buildingFixture';

// BuildingIndex reads only file.path; the rest satisfies the type.
const FILE_DEFAULTS: FileNode = {
  path: '',
  name: '',
  type: NodeKind.File,
  fullPath: '',
  extension: '.ts',
  size: 0,
  lines: 0,
  binary: false,
  dirty: false,
  created: '',
  modified: '',
};

// Bounds under ~192x192 keep cellSize at MIN_CELL_SIZE (12), so these tests
// can reason about cell assignment at a known granularity.
const CELL_SIZE = 12;

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
    // The old global cap of max(64, avg*4) came to ~84, so the dense cell
    // dropped buildings. Per-cell sizing must place all 100.
    const bounds = { minX: 0, maxX: 96, minZ: 0, maxZ: 96 };
    const dense = Array.from({ length: 100 }, (_, i) => building({ x: i % 10, y: 1 }));
    const sparse = [20, 32, 44, 56].map((x) => building({ x, y: 1 }));
    const out = buildCellsFromLayout(bounds, [...dense, ...sparse]);

    const cell0 = out.cells.get(0)!;
    expect(cell0.buildings.filter(Boolean).length).toBe(100);
  });

  it('sparse allocation: only occupied cells are created', () => {
    // 96x96 at cellSize 12 is 64 cells, and every building sits at x,z < 12,
    // so they all land in cell 0.
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
    // Striding by CELL_SIZE guarantees a distinct bucket per building, with
    // bounds small enough to hold cellSize at 12.
    const N = 5;
    const bounds = { minX: 0, maxX: N * CELL_SIZE * 2, minZ: 0, maxZ: CELL_SIZE * 2 };
    // Each building at (i*CELL_SIZE + 1, 1) → distinct column cells.
    const buildings = Array.from({ length: N }, (_, i) => building({ x: i * CELL_SIZE + 1, y: 1 }));
    const out = buildCellsFromLayout(bounds, buildings);

    expect(out.cells.size).toBe(N);
    expect(out.grid.cellCount).toBeGreaterThan(N);
  });

  it('sceneRoot has 1 child per occupied cell (detailMesh)', () => {
    // Two buildings CELL_SIZE apart occupy two cells, so the scene gets two
    // children.
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

    it('skips the panel for a 0-byte image (nothing to billboard)', () => {
      const empty = building({
        x: 5,
        y: 5,
        file: {
          path: 'blank.png',
          name: 'blank.png',
          type: NodeKind.File,
          fullPath: '/abs/blank.png',
          extension: '.png',
          mediaKind: 'image',
          size: 0,
          lines: 0,
          binary: true,
          dirty: false,
          created: '',
          modified: '',
        },
      });
      const out = buildCellsFromLayout(bounds, [empty]);
      expect(out.facadePanels).toBeNull();
      expect(out.index.byPath.get('blank.png')).toBeDefined();
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

    it('skips the fingerprint for a 0-byte binary (no bytes to fingerprint)', () => {
      const empty = building({
        x: 5,
        y: 5,
        file: {
          path: 'empty.db',
          name: 'empty.db',
          type: NodeKind.File,
          fullPath: '/abs/empty.db',
          extension: '.db',
          mediaKind: null,
          size: 0,
          lines: 0,
          binary: true,
          dirty: false,
          created: '',
          modified: '',
        },
      });
      const out = buildCellsFromLayout(bounds, [empty]);
      expect(out.facadePanels).toBeNull();
      expect(out.index.byPath.get('empty.db')).toBeDefined();
    });

    it('mixed scene: empty binary excluded, non-empty binary registered', () => {
      const empty = building({
        x: 5,
        y: 5,
        file: {
          path: 'empty.db',
          name: 'empty.db',
          type: NodeKind.File,
          fullPath: '/abs/empty.db',
          extension: '.db',
          mediaKind: null,
          size: 0,
          lines: 0,
          binary: true,
          dirty: false,
          created: '',
          modified: '',
        },
      });

      const nonEmpty = building({
        x: 10,
        y: 10,
        file: {
          path: 'data.db',
          name: 'data.db',
          type: NodeKind.File,
          fullPath: '/abs/data.db',
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

      const out = buildCellsFromLayout(bounds, [empty, nonEmpty]);
      // Only the non-empty building should be registered (4 slots).
      expect(out.facadePanels).not.toBeNull();
      expect(out.facadePanels!.mesh.count).toBe(4);
      // Both buildings exist and are indexed (empty one still renders as slab).
      expect(out.index.byPath.get('empty.db')).toBeDefined();
      expect(out.index.byPath.get('data.db')).toBeDefined();
    });
  });
});

describe('BuildingIndex', () => {
  it('round-trips path → building and (cellId, slotId) → building', () => {
    const idx = new BuildingIndex();
    const b = building({
      file: { ...FILE_DEFAULTS, path: 'src/foo.ts', name: 'foo.ts' },
      cellId: 3,
      slotId: 7,
    });
    idx.insert(b);
    expect(idx.byPath.get('src/foo.ts')).toBe(b);
    expect(idx.byCellSlot('3:7')).toBe(b);
  });
});

describe('createEmptyCellTile', () => {
  const grid = () => new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });

  it('preallocates the full capacity with every slot empty and zero-scaled', () => {
    const tile = createEmptyCellTile(grid(), 5, 128);
    expect(tile.cellId).toBe(5);
    expect(tile.capacity).toBe(128);
    expect(tile.used).toBe(0);
    expect(tile.buildings).toHaveLength(128);
    expect(tile.buildings.every((b) => b === null)).toBe(true);
    expect(tile.detailMesh.count).toBe(128);

    // An unpopulated slot must be scale-zero, or it draws a unit cube at the
    // origin. Scale sits on the matrix diagonal (0, 5, 10).
    const m = new THREE.Matrix4();
    tile.detailMesh.getMatrixAt(0, m);
    expect([m.elements[0], m.elements[5], m.elements[10]]).toEqual([0, 0, 0]);
  });

  it('stamps cellId and meshKind for the picker to resolve a hit', () => {
    const tile = createEmptyCellTile(grid(), 7, 64);
    expect(tile.detailMesh.userData.cellId).toBe(7);
    expect(tile.detailMesh.userData.meshKind).toBe('detail');
  });
});

describe('dataFacadeKind', () => {
  it.each([
    ['font', ['.woff2', '.woff', '.ttf', '.otf', '.TTF']],
    ['audio', ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.MP3']],
    ['fingerprint', ['.db', '.wasm', '.so', '.bin', '']],
  ] as const)('routes %s extensions', (kind, exts) => {
    for (const ext of exts) expect(dataFacadeKind(ext)).toBe(kind);
  });
});
