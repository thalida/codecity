import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpatialGrid } from '@/scene/spatialGrid.js';
import { createEmptyCellTile, type CellTile } from '@/scene/cellTile.js';

describe('CellTile', () => {
  it('createEmptyCellTile allocates meshes with preallocated capacity', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const tile = createEmptyCellTile(grid, /* cellId */ 5, /* capacity */ 128);

    expect(tile.cellId).toBe(5);
    expect(tile.capacity).toBe(128);
    expect(tile.used).toBe(0);
    expect(tile.freeSlots).toEqual([]);
    expect(tile.tier).toBe('hidden');
    expect(tile.buildings).toHaveLength(128);
    expect(tile.buildings.every((b) => b === null)).toBe(true);

    // Meshes exist and have correct count
    expect(tile.detailMesh.count).toBe(128);
    expect(tile.impostorMesh.count).toBe(128);
    expect(tile.labelMesh.count).toBe(128);

    // Until populated, every instance should be scale-zero (invisible)
    const m = new THREE.Matrix4();
    tile.detailMesh.getMatrixAt(0, m);
    // Zero-scale matrix has 0 on the scale-diagonal (elements 0, 5, 10).
    expect(m.elements[0]).toBe(0);
    expect(m.elements[5]).toBe(0);
    expect(m.elements[10]).toBe(0);
  });

  it('userData carries cellId for picker lookup', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 48, minZ: 0, maxZ: 48 });
    const tile = createEmptyCellTile(grid, 7, 64);
    expect(tile.detailMesh.userData.cellId).toBe(7);
    expect(tile.detailMesh.userData.meshKind).toBe('detail');
    expect(tile.impostorMesh.userData.cellId).toBe(7);
    expect(tile.impostorMesh.userData.meshKind).toBe('impostor');
  });
});
