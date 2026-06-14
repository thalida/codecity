import { describe, it, expect } from 'vitest';
import { SpatialGrid, MIN_CELL_SIZE } from '@/city/components/buildings/spatialGrid';

describe('SpatialGrid', () => {
  it('computes grid dimensions from world bounds', () => {
    const grid = new SpatialGrid({
      minX: 0,
      maxX: 100,
      minZ: 0,
      maxZ: 60,
    });
    expect(grid.gridW).toBe(Math.ceil(100 / MIN_CELL_SIZE));
    expect(grid.gridH).toBe(Math.ceil(60 / MIN_CELL_SIZE));
    expect(grid.cellCount).toBe(grid.gridW * grid.gridH);
  });

  it('maps world position to cell index', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 100, minZ: 0, maxZ: 60 });
    const cell = grid.worldToCell(15, 25);
    expect(cell.cx).toBe(Math.floor(15 / MIN_CELL_SIZE));
    expect(cell.cz).toBe(Math.floor(25 / MIN_CELL_SIZE));
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
    expect(sphere.radius).toBeGreaterThanOrEqual(MIN_CELL_SIZE / 2);
    expect(sphere.center.x).toBeCloseTo(MIN_CELL_SIZE / 2);
    expect(sphere.center.z).toBeCloseTo(MIN_CELL_SIZE / 2);
  });

  it('degenerate (single-cell) grid for tiny bounds', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
    expect(grid.gridW).toBe(1);
    expect(grid.gridH).toBe(1);
    expect(grid.worldToCell(0.5, 0.5).cellId).toBe(0);
  });

  it('constructor accepts explicit cellSize and uses it for grid math', () => {
    const grid = new SpatialGrid({ minX: 0, maxX: 100, minZ: 0, maxZ: 60 }, 25);
    expect(grid.cellSize).toBe(25);
    expect(grid.gridW).toBe(Math.ceil(100 / 25));
    expect(grid.gridH).toBe(Math.ceil(60 / 25));
  });
});

describe('SpatialGrid.computeOptimalCellSize', () => {
  it('returns MIN_CELL_SIZE for small bbox', () => {
    // 100×100 area → sqrt(10000/256) ≈ 6.25 → clamped to MIN_CELL_SIZE (12)
    const size = SpatialGrid.computeOptimalCellSize({ minX: 0, maxX: 100, minZ: 0, maxZ: 100 });
    expect(size).toBe(MIN_CELL_SIZE);
  });

  it('scales with bbox area', () => {
    const small = SpatialGrid.computeOptimalCellSize({ minX: 0, maxX: 100, minZ: 0, maxZ: 100 });
    const large = SpatialGrid.computeOptimalCellSize({
      minX: 0,
      maxX: 10000,
      minZ: 0,
      maxZ: 10000,
    });
    expect(large).toBeGreaterThan(small);
  });

  it('result yields ~256 cells for typical Linux-scale bbox', () => {
    // Linux kernel layout: ~86000 × 127000 world units
    const bounds = { minX: 0, maxX: 86000, minZ: 0, maxZ: 127000 };
    const cellSize = SpatialGrid.computeOptimalCellSize(bounds);
    const grid = new SpatialGrid(bounds, cellSize);
    // Grid cell count should be within a factor of ~2 of the 256 target
    expect(grid.cellCount).toBeGreaterThanOrEqual(128);
    expect(grid.cellCount).toBeLessThanOrEqual(512);
  });
});
