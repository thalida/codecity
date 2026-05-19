// scene/cellAssembly.ts — Wires SpatialGrid + CellTile + per-cell
// building factory into a complete scene-ready set of cells given a
// layout. Called from cityScene.ts when CELL_RENDERING.enabled.
//
// Only BUILDINGS are consolidated into spatial-grid cells. Streets,
// labels, paths, and the root gem stay on the legacy path because the
// legacy renderer handles those fine even at Linux scale.

import * as THREE from 'three';
import { SpatialGrid, type WorldBounds } from './spatialGrid.js';
import { createEmptyCellTile, type CellTile, allocateSlot } from './cellTile.js';
import { attachBuildingMeshToCell, writeBuildingToSlot } from './instanced/buildingsCell.js';
import { BuildingIndex } from './buildingIndex.js';
import type { Building } from '@/types/index.js';
import { debugCell } from '@/config/debugLogs.js';

export interface CellAssemblyOutput {
  grid: SpatialGrid;
  cells: Map<number, CellTile>;
  index: BuildingIndex;
  sceneRoot: THREE.Group;
}

/**
 * Assemble a cell-based scene from a layout's buildings and a shared
 * uniform bag. Only buildings are placed into cells — streets, labels,
 * paths, and the gem remain on the legacy rendering path.
 *
 * Sparse allocation: only grid cells that contain at least one building
 * are allocated. For a 194-file project this is a small fraction of the
 * full grid; for an 80k-file repo the occupied-cell count scales with
 * directory density rather than full grid extent.
 *
 * Steps:
 *   1. Build a SpatialGrid from bounds.
 *   2. Walk buildings once to collect the set of occupied cellIds.
 *   3. Allocate CellTiles only for occupied cells; attach building mesh.
 *   4. Walk buildings again to write each building into its cell slot.
 *   5. Force detail tier visible on all occupied cells (no LOD yet).
 *   6. Flush instanceMatrix.needsUpdate.
 */
export function buildCellsFromLayout(
  bounds: WorldBounds,
  buildings: Building[],
  sharedBuildingUniforms: Record<string, THREE.IUniform>,
): CellAssemblyOutput {
  // [cell-debug]
  const _t0 = performance.now();
  const cellSize = SpatialGrid.computeOptimalCellSize(bounds);
  const grid = new SpatialGrid(bounds, cellSize);
  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 1 entered', { buildings: buildings.length, cellSize, gridCellCount: grid.cellCount });
  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 2 SpatialGrid created', { gridW: grid.gridW, gridH: grid.gridH, cellCount: grid.cellCount, cellSize });

  // ---- Sparse pass: collect occupied cellIds ----
  const occupiedIds = new Set<number>();
  for (const b of buildings) {
    const { cellId } = grid.worldToCell(b.x, b.y);
    occupiedIds.add(cellId);
  }
  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 3 occupied cells identified', { occupiedCells: occupiedIds.size, totalCells: grid.cellCount });

  const capacity = computeCellCapacity(occupiedIds.size || 1, buildings.length);
  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 4 capacity computed', { capacity });

  // ---- Sparse allocation: only occupied cells ----
  // [cell-debug]
  const _allocT0 = performance.now();
  const cells = new Map<number, CellTile>();
  for (const id of occupiedIds) {
    const cell = createEmptyCellTile(grid, id, capacity);
    attachBuildingMeshToCell(cell, sharedBuildingUniforms);
    cells.set(id, cell);
  }
  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 5 allocated occupied cells', { count: cells.size, elapsedMs: performance.now() - _allocT0 });

  // ---- Insert buildings ----
  // [cell-debug]
  const _buildT0 = performance.now();
  const index = new BuildingIndex();
  for (const b of buildings) {
    const { cellId } = grid.worldToCell(b.x, b.y);
    const cell = cells.get(cellId);
    if (!cell) {
      // Shouldn't happen — we just allocated every occupied cell.
      console.warn('[cellAssembly] no cell for building', b.file?.path, '(cellId', cellId, ')');
      continue;
    }
    const slot = allocateSlot(cell);
    if (slot < 0) {
      // Overflow: capacity was under-estimated. Log and skip — Task 17
      // adds overflow tile chaining so no building is silently dropped.
      console.warn('[cellAssembly] capacity overflow for cell', cellId, '— building', b.file?.path, 'skipped');
      continue;
    }
    b.cellId = cellId;
    b.slotId = slot;
    cell.buildings[slot] = b;
    if (b.dirNode) cell.dirs.add(b.dirNode);
    writeBuildingToSlot(cell, b);
    index.insert(b);
  }
  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 6 buildings assigned to slots', { count: buildings.length, elapsedMs: performance.now() - _buildT0 });

  // ---- Force detail tier visible (no LOD yet — Task 14 adds the evaluator) ----
  // [cell-debug]
  const _visT0 = performance.now();
  const sceneRoot = new THREE.Group();
  sceneRoot.name = 'CellRoot';
  for (const cell of cells.values()) {
    cell.tier = 'detail';
    cell.detailMesh.visible = true;
    // impostorMesh stays hidden until Task 13 attaches impostor geometry.
    // labelMesh stays hidden — labels are handled by the legacy streetLabels path.
    sceneRoot.add(cell.detailMesh);
    sceneRoot.add(cell.impostorMesh);
  }
  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 7 visibility flags set', { count: cells.size, elapsedMs: performance.now() - _visT0 });
  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 8 SceneRoot constructed', { childCount: sceneRoot.children.length });

  // ---- Flush attribute uploads ----
  for (const cell of cells.values()) {
    cell.detailMesh.instanceMatrix.needsUpdate = true;
    cell.impostorMesh.instanceMatrix.needsUpdate = true;
  }

  // [cell-debug]
  debugCell('[cell] buildCellsFromLayout: 9 returning', { totalMs: performance.now() - _t0 });
  return { grid, cells, index, sceneRoot };
}

function computeCellCapacity(occupiedCellCount: number, expectedFiles: number): number {
  if (expectedFiles === 0) return 64;
  const avg = Math.ceil(expectedFiles / occupiedCellCount);
  return Math.max(64, avg * 4);
}
