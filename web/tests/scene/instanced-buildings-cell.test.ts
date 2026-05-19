// tests/scene/instanced-buildings-cell.test.ts — Round-trip write test for
// the cell-aware building InstancedMesh factory.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpatialGrid } from '@/scene/spatialGrid.js';
import { createEmptyCellTile } from '@/scene/cellTile.js';
import { attachBuildingMeshToCell, writeBuildingToSlot } from '@/scene/instanced/buildingsCell.js';
import { BuildingOrient, NodeKind } from '@/types/index.js';
import type { Building } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Minimal Building fixture — only the fields read by writeBuildingToSlot.
// ---------------------------------------------------------------------------

function fakeBuilding(overrides: Partial<Building> & { x: number; y: number; h: number }): Building {
  return {
    x: overrides.x,
    y: overrides.y,
    w: overrides.w ?? 2,
    d: overrides.d ?? 2,
    h: overrides.h,
    color: overrides.color ?? '#ff0000',
    orient: overrides.orient ?? BuildingOrient.South,
    floors: overrides.floors ?? 1,
    cellId: overrides.cellId ?? 0,
    slotId: overrides.slotId ?? 0,
    createdAge: overrides.createdAge ?? 0,
    modifiedAge: overrides.modifiedAge ?? 0,
    file: overrides.file ?? {
      path: 'a.ts',
      name: 'a.ts',
      type: NodeKind.File,
      fullPath: '/abs/a.ts',
      extension: '.ts',
      size: 100,
      lines: 10,
      binary: false,
      created: '',
      modified: '',
      git: null,
    },
  } as Building;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildingsCell factory', () => {
  it('attachBuildingMeshToCell replaces placeholder geometry and allocates per-instance attributes', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);

    attachBuildingMeshToCell(cell, {} as Record<string, THREE.IUniform>);

    // Geometry should have all required instanced attributes.
    expect(cell.detailMesh.geometry.getAttribute('iCols')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iFloors')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iOrient')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iDoorWidth')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iFade')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iIconUV')).toBeTruthy();
    expect(cell.detailMesh.geometry.getAttribute('iModifiedAge')).toBeTruthy();

    // instanceColor should be allocated.
    expect(cell.detailMesh.instanceColor).toBeTruthy();
    expect(cell.detailMesh.instanceColor!.count).toBe(64);

    // Attribute sizes should match capacity.
    const colsAttr = cell.detailMesh.geometry.getAttribute('iCols') as THREE.InstancedBufferAttribute;
    expect(colsAttr.count).toBe(64); // N instances
    expect(colsAttr.itemSize).toBe(2); // vec2
    const fadeAttr = cell.detailMesh.geometry.getAttribute('iFade') as THREE.InstancedBufferAttribute;
    expect(fadeAttr.count).toBe(64);
    expect(fadeAttr.itemSize).toBe(3); // vec3
    const iconAttr = cell.detailMesh.geometry.getAttribute('iIconUV') as THREE.InstancedBufferAttribute;
    expect(iconAttr.count).toBe(64);
    expect(iconAttr.itemSize).toBe(4); // vec4

    // Material should be a ShaderMaterial.
    expect(cell.detailMesh.material).toBeInstanceOf(THREE.ShaderMaterial);
  });

  it('writeBuildingToSlot sets matrix position matching (b.x, b.h/2, b.y)', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, {} as Record<string, THREE.IUniform>);

    const b = fakeBuilding({ x: 5, y: 7, h: 4, slotId: 3 });
    writeBuildingToSlot(cell, b);

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
    attachBuildingMeshToCell(cell, {} as Record<string, THREE.IUniform>);

    const b = fakeBuilding({ x: 0, y: 0, w: 3, d: 4, h: 6, slotId: 0 });
    writeBuildingToSlot(cell, b);

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
    attachBuildingMeshToCell(cell, {} as Record<string, THREE.IUniform>);

    const b = fakeBuilding({ x: 0, y: 0, h: 2, slotId: 1 });
    writeBuildingToSlot(cell, b);

    const fadeAttr = cell.detailMesh.geometry.getAttribute('iFade') as THREE.InstancedBufferAttribute;
    expect(fadeAttr.getX(1)).toBeCloseTo(1.0); // opacity = 1
    expect(fadeAttr.getY(1)).toBeCloseTo(0.0); // silhouette = 0
    expect(fadeAttr.getZ(1)).toBeCloseTo(0.0); // outlineOpacity = 0
  });

  it('writeBuildingToSlot writes iconUV.xy=-1 (no icon) when no atlas is set', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, {} as Record<string, THREE.IUniform>);

    const b = fakeBuilding({ x: 0, y: 0, h: 2, slotId: 2 });
    writeBuildingToSlot(cell, b);

    const iconAttr = cell.detailMesh.geometry.getAttribute('iIconUV') as THREE.InstancedBufferAttribute;
    expect(iconAttr.getX(2)).toBeCloseTo(-1.0); // no icon — shader skips atlas sample
    expect(iconAttr.getY(2)).toBeCloseTo(-1.0);
  });

  it('writeBuildingToSlot writes orient=0 for South (shader contract)', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, {} as Record<string, THREE.IUniform>);

    const b = fakeBuilding({ x: 0, y: 0, h: 2, orient: BuildingOrient.South, slotId: 5 });
    writeBuildingToSlot(cell, b);

    const orientAttr = cell.detailMesh.geometry.getAttribute('iOrient') as THREE.InstancedBufferAttribute;
    expect(orientAttr.getX(5)).toBe(0); // South = 0
  });

  it('writeBuildingToSlot writes into the correct slot without touching adjacent slots', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const cell = createEmptyCellTile(grid, 0, 64);
    attachBuildingMeshToCell(cell, {} as Record<string, THREE.IUniform>);

    // Write to slot 10; slots 9 and 11 should remain scale-zero (from createEmptyCellTile).
    const b = fakeBuilding({ x: 1, y: 2, h: 3, slotId: 10 });
    writeBuildingToSlot(cell, b);

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
});
