// tests/city/components/buildings/cellMesh.test.ts — Round-trip write test for
// the cell-aware building InstancedMesh factory.

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { SpatialGrid } from '@/city/components/buildings/spatialGrid';
import { createEmptyCellTile } from '@/city/components/buildings/cellTile';
import type { CellTile } from '@/city/components/buildings/cellTile';
import {
  attachBuildingMeshToCell,
  writeBuildingToSlot,
} from '@/city/components/buildings/cellMesh';

import { BuildingKind } from '@/city/components/buildings/buildingKind';
import { BuildingOrient, NodeKind } from '@codecity/city';
import type { IconAtlas } from '@/city/components/buildings/atlas';
import { building } from '../../../_helpers/buildingFixture';
import { createTestCityResources } from '../../../_helpers/cityResources';
import type { FileNode } from '@codecity/city';

const _res = createTestCityResources();

// Fake IconAtlas — minimal implementation of the IconAtlas interface that
// returns a known UV for any icon name it was seeded with.

function fakeAtlas(uvMap: Record<string, [number, number]>): IconAtlas {
  return {
    texture: new THREE.CanvasTexture(document.createElement('canvas')),
    slotSize: 0.0625,
    uvFor(name: string): [number, number] | null {
      return uvMap[name] ?? null;
    },
  };
}

describe('cellMesh factory', () => {
  // Clear the module-level atlas after each test so tests don't bleed into each other.
  afterEach(() => {
    _res.buildings.setIconAtlas(null);
  });
  it('attachBuildingMeshToCell replaces placeholder geometry and allocates per-instance attributes', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);

    attachBuildingMeshToCell(cell, _res.buildings);

    // Geometry should have all required instanced attributes.
    expect(cell.detailMesh.geometry.getAttribute('iCols')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iFloors')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iDoor')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iFade')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iIconUV')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iModifiedAge')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iRefColor')).toBeTruthy();

    // instanceColor should be allocated.
    expect(cell.detailMesh.instanceColor).toBeTruthy();
    expect(cell.detailMesh.instanceColor!.count).toBe(64);

    // Attribute sizes should match capacity.
    const colsAttr = cell.detailMesh.geometry.getAttribute(
      'iCols'
    ) as THREE.InstancedBufferAttribute;
    expect(colsAttr.count).toBe(64); // N instances
    expect(colsAttr.itemSize).toBe(2); // vec2
    const fadeAttr = cell.detailMesh.geometry.getAttribute(
      'iFade'
    ) as THREE.InstancedBufferAttribute;
    expect(fadeAttr.count).toBe(64);
    expect(fadeAttr.itemSize).toBe(3); // vec3
    const iconAttr = cell.detailMesh.geometry.getAttribute(
      'iIconUV'
    ) as THREE.InstancedBufferAttribute;
    expect(iconAttr.count).toBe(64);
    expect(iconAttr.itemSize).toBe(4); // vec4

    // Material should be a ShaderMaterial.
    expect(cell.detailMesh.material).toBeInstanceOf(THREE.ShaderMaterial);
  });

  it('writeBuildingToSlot sets matrix position matching (b.x, b.h/2, b.y)', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, _res.buildings);

    const b = building({ x: 5, y: 7, h: 4, slotId: 3 });
    writeBuildingToSlot(cell, b, _res.buildings);

    const matrix = new THREE.Matrix4();
    cell.detailMesh.getMatrixAt(3, matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(pos.x).toBeCloseTo(5);
    expect(pos.y).toBeCloseTo(2); // h/2 = 4/2
    expect(pos.z).toBeCloseTo(7);
  });

  it('writeBuildingToSlot sets matrix scale matching (b.w, b.h, b.d)', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, _res.buildings);

    const b = building({ x: 0, y: 0, w: 3, d: 4, h: 6, slotId: 0 });
    writeBuildingToSlot(cell, b, _res.buildings);

    const matrix = new THREE.Matrix4();
    cell.detailMesh.getMatrixAt(0, matrix);
    const scale = new THREE.Vector3();
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(3); // w
    expect(scale.y).toBeCloseTo(6); // h
    expect(scale.z).toBeCloseTo(4); // d
  });

  it('writeBuildingToSlot writes iFade.x=1.0 (opacity defaults to full visibility)', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, _res.buildings);

    const b = building({ x: 0, y: 0, h: 2, slotId: 1 });
    writeBuildingToSlot(cell, b, _res.buildings);

    const fadeAttr = cell.detailMesh.geometry.getAttribute(
      'iFade'
    ) as THREE.InstancedBufferAttribute;
    expect(fadeAttr.getX(1)).toBeCloseTo(1.0); // opacity = 1
    expect(fadeAttr.getY(1)).toBeCloseTo(0.0); // silhouette = 0
    expect(fadeAttr.getZ(1)).toBeCloseTo(0.0); // outlineOpacity = 0
  });

  it('writeBuildingToSlot writes iconUV.xy=-1 (no icon) when no atlas is set', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, _res.buildings);

    const b = building({ x: 0, y: 0, h: 2, slotId: 2 });
    writeBuildingToSlot(cell, b, _res.buildings);

    const iconAttr = cell.detailMesh.geometry.getAttribute(
      'iIconUV'
    ) as THREE.InstancedBufferAttribute;
    expect(iconAttr.getX(2)).toBeCloseTo(-1.0); // no icon — shader skips atlas sample
    expect(iconAttr.getY(2)).toBeCloseTo(-1.0);
  });

  it('writeBuildingToSlot writes resolved atlas UV into iconUV.xy when atlas is set', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, _res.buildings);

    // The icon name is resolved at runtime, so seed the plausible ones: a
    // plain object can't catch-all the way a Proxy would.
    const knownUV: [number, number] = [0.125, 0.25];
    const atlas = fakeAtlas({
      typescript: knownUV,
      file_type_typescript: knownUV,
      ts: knownUV,
    });
    _res.buildings.setIconAtlas(atlas);

    const b = building({ x: 0, y: 0, h: 2, slotId: 4 });
    writeBuildingToSlot(cell, b, _res.buildings);

    const iconAttr = cell.detailMesh.geometry.getAttribute(
      'iIconUV'
    ) as THREE.InstancedBufferAttribute;
    // iIconUV.xy must NOT be (-1, -1) — the atlas lookup must have succeeded.
    const u = iconAttr.getX(4);
    const v = iconAttr.getY(4);
    expect(u).not.toBeCloseTo(-1.0);
    expect(v).not.toBeCloseTo(-1.0);
    // The exact UV must match what the atlas returned.
    expect(u).toBeCloseTo(knownUV[0]);
    expect(v).toBeCloseTo(knownUV[1]);
    // iIconUV.zw (seed + createdAge) must still be intact.
    expect(iconAttr.getZ(4)).toBeGreaterThanOrEqual(0); // seed in [0, 1)
    expect(iconAttr.getW(4)).toBeCloseTo(0); // createdAge default
  });

  it('writeBuildingToSlot writes orient=0 for South (shader contract)', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, _res.buildings);

    const b = building({ x: 0, y: 0, h: 2, orient: BuildingOrient.South, slotId: 5 });
    writeBuildingToSlot(cell, b, _res.buildings);

    const doorAttr = cell.detailMesh.geometry.getAttribute(
      'iDoor'
    ) as THREE.InstancedBufferAttribute;
    expect(doorAttr.getX(5)).toBe(0); // South = 0
  });

  it('writeBuildingToSlot writes into the correct slot without touching adjacent slots', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, _res.buildings);

    // Write to slot 10; slots 9 and 11 should remain scale-zero (from createEmptyCellTile).
    const b = building({ x: 1, y: 2, h: 3, slotId: 10 });
    writeBuildingToSlot(cell, b, _res.buildings);

    // Slot 10 should have a real position.
    const m10 = new THREE.Matrix4();
    cell.detailMesh.getMatrixAt(10, m10);
    const p10 = new THREE.Vector3().setFromMatrixPosition(m10);
    expect(p10.x).toBeCloseTo(1);

    // Slot 9 should still be scale-zero (untouched by the write).
    const m9 = new THREE.Matrix4();
    cell.detailMesh.getMatrixAt(9, m9);
    // Scale-zero matrix has 0 on the diagonal (elements 0, 5, 10).
    expect(m9.elements[0]).toBe(0);
    expect(m9.elements[5]).toBe(0);
    expect(m9.elements[10]).toBe(0);
  });

  it('writeBuildingToSlot tags a 0-byte file as BuildingKind.Empty', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, _res.buildings);

    const emptyFile: FileNode = {
      name: '__init__.py',
      type: NodeKind.File,
      path: 'pkg/__init__.py',
      extension: '.py',
      size: 0,
      lines: 0,
      binary: false,
      dirty: false,
      created: '',
      modified: '',
    };
    writeBuildingToSlot(
      cell,
      building({ slotId: 0, h: 0.8, floors: 0, file: emptyFile }),
      _res.buildings
    );

    const iKind = cell.detailMesh.geometry.getAttribute('iKind');
    expect(iKind.getX(0)).toBe(BuildingKind.Empty);
  });
});

// 300 cells, the ~17×17 grid a large repo produces: one shared material across
// all of them, one InstancedMesh each (per-cell visibility needs that).

describe('cellMesh shared-material stress test (300 cells)', () => {
  it('all 300 cells share exactly one ShaderMaterial instance', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 1600, minZ: 0, maxZ: 1600 });
    const CELL_COUNT = 300;
    const capacity = 64;

    const cells: CellTile[] = [];
    for (let id = 0; id < CELL_COUNT; id++) {
      const cell = createEmptyCellTile(grid, id % grid.cellCount, capacity);
      attachBuildingMeshToCell(cell, _res.buildings);
      cells.push(cell);
    }

    // All 300 meshes must reference the same ShaderMaterial instance.
    const firstMat = cells[0].detailMesh.material as THREE.ShaderMaterial;
    expect(firstMat).toBeInstanceOf(THREE.ShaderMaterial);
    for (let i = 1; i < CELL_COUNT; i++) {
      expect(cells[i].detailMesh.material).toBe(firstMat);
    }

    // 300 distinct InstancedMesh objects must exist (one per cell).
    const meshSet = new Set(cells.map((c) => c.detailMesh));
    expect(meshSet.size).toBe(CELL_COUNT);
  });

  it('300-cell allocation completes in under 1 second', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 1600, minZ: 0, maxZ: 1600 });
    const CELL_COUNT = 300;
    const capacity = 64;

    const start = performance.now();
    for (let id = 0; id < CELL_COUNT; id++) {
      const cell = createEmptyCellTile(grid, id % grid.cellCount, capacity);
      attachBuildingMeshToCell(cell, _res.buildings);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});
