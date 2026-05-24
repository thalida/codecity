// scene/cellAssembly.ts — Wires SpatialGrid + CellTile + per-cell
// building factory into a complete scene-ready set of cells given a
// layout. Called from world.ts.
//
// Only BUILDINGS are consolidated into spatial-grid cells. Streets,
// labels, paths, and the root gem stay on the engine-built path because
// the engine handles those fine even at Linux scale.

import * as THREE from 'three';
import { SpatialGrid, type WorldBounds } from './spatialGrid.js';
import { createEmptyCellTile, type CellTile, allocateSlot } from './cellTile.js';
import { attachBuildingMeshToCell, writeBuildingToSlot } from '../components/buildings/buildingsCell.js';
import { InstancedAdPanels, asyncLoadMediaForBuilding } from '../components/adPanels/adPanelsInstanced.js';
import { isMediaFile } from '../components/adPanels/adPanels.js';
import { BuildingIndex } from '../components/buildings/buildingIndex.js';
import type { Building } from '@/types/index.js';

export interface CellAssemblyOutput {
  grid: SpatialGrid;
  cells: Map<number, CellTile>;
  index: BuildingIndex;
  sceneRoot: THREE.Group;
  /** Instanced ad panels for media files. Null when there are no media buildings. */
  adPanels: InstancedAdPanels | null;
}

/**
 * Assemble a cell-based scene from a layout's buildings and a shared
 * uniform bag. Only buildings are placed into cells — streets, labels,
 * paths, and the gem remain on the engine-built rendering path.
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
 *   5. Flush instanceMatrix.needsUpdate.
 */
export function buildCellsFromLayout(
  bounds: WorldBounds,
  buildings: Building[],
  sharedBuildingUniforms: Record<string, THREE.IUniform>,
): CellAssemblyOutput {
  const cellSize = SpatialGrid.computeOptimalCellSize(bounds);
  const grid = new SpatialGrid(bounds, cellSize);

  // ---- Sparse pass: collect occupied cellIds ----
  const occupiedIds = new Set<number>();
  for (const b of buildings) {
    const { cellId } = grid.worldToCell(b.x, b.y);
    occupiedIds.add(cellId);
  }

  const capacity = computeCellCapacity(occupiedIds.size || 1, buildings.length);

  // ---- Sparse allocation: only occupied cells ----
  const cells = new Map<number, CellTile>();
  for (const id of occupiedIds) {
    const cell = createEmptyCellTile(grid, id, capacity);
    attachBuildingMeshToCell(cell, sharedBuildingUniforms);
    cells.set(id, cell);
  }

  // ---- Insert buildings ----
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

  // ---- Add all cell meshes to scene root ----
  // Cells render at detail tier unconditionally; the legacy LOD tier
  // machinery has been removed.
  const sceneRoot = new THREE.Group();
  sceneRoot.name = 'CellRoot';
  for (const cell of cells.values()) {
    sceneRoot.add(cell.detailMesh);
  }

  // ---- Flush attribute uploads ----
  for (const cell of cells.values()) {
    cell.detailMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- Instanced ad panels for media buildings ----
  // Build one InstancedMesh backed by a DataArrayTexture for all media files.
  const mediaBuildings = buildings.filter((b) => isMediaFile(b.file));
  let adPanels: InstancedAdPanels | null = null;
  if (mediaBuildings.length > 0) {
    const adCapacity = Math.max(64, Math.ceil(mediaBuildings.length * 1.5));
    adPanels = new InstancedAdPanels(adCapacity);
    for (const b of mediaBuildings) {
      const reg = adPanels.registerMediaBuilding(b);
      if (reg) {
        // Async: fetch + upload texture, then set iTextureFade → 1.
        asyncLoadMediaForBuilding(adPanels, b, reg.layer, reg.panelSlots);
      }
    }
    sceneRoot.add(adPanels.mesh);
  }

  return { grid, cells, index, sceneRoot, adPanels };
}

function computeCellCapacity(occupiedCellCount: number, expectedFiles: number): number {
  if (expectedFiles === 0) return 64;
  const avg = Math.ceil(expectedFiles / occupiedCellCount);
  return Math.max(64, avg * 4);
}
