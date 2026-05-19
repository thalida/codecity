import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SpatialGrid,
  CELL_SIZE,
} from '@/scene/spatialGrid.js';

describe('SpatialGrid', () => {
  it('computes grid dimensions from world bounds', () => {
    const grid = new SpatialGrid({
      minX: 0, maxX: 100,
      minZ: 0, maxZ: 60,
    });
    expect(grid.gridW).toBe(Math.ceil(100 / CELL_SIZE));
    expect(grid.gridH).toBe(Math.ceil(60 / CELL_SIZE));
    expect(grid.cellCount).toBe(grid.gridW * grid.gridH);
  });

  it('maps world position to cell index', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 100, minZ: 0, maxZ: 60 });
    const cell = grid.worldToCell(15, 25);
    expect(cell.cx).toBe(Math.floor(15 / CELL_SIZE));
    expect(cell.cz).toBe(Math.floor(25 / CELL_SIZE));
    expect(cell.cellId).toBe(cell.cz * grid.gridW + cell.cx);
  });

  it('clamps out-of-bounds coords to edge cells', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 100, minZ: 0, maxZ: 60 });
    expect(grid.worldToCell(-5, -5).cellId).toBe(0);
    const last = grid.worldToCell(1000, 1000);
    expect(last.cellId).toBe(grid.cellCount - 1);
  });

  it('cellBoundsSphere covers the cell footprint', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 100, minZ: 0, maxZ: 60 });
    const sphere = grid.cellBoundsSphere(0);
    expect(sphere.radius).toBeGreaterThanOrEqual(CELL_SIZE / 2);
    expect(sphere.center.x).toBeCloseTo(CELL_SIZE / 2);
    expect(sphere.center.z).toBeCloseTo(CELL_SIZE / 2);
  });

  it('degenerate (single-cell) grid for tiny bounds', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
    expect(grid.gridW).toBe(1);
    expect(grid.gridH).toBe(1);
    expect(grid.worldToCell(0.5, 0.5).cellId).toBe(0);
  });
});
