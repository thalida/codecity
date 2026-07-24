// city/components/buildings/cellAssembly.ts — Wires SpatialGrid + CellTile + per-cell
// building factory into a complete scene-ready set of cells given a
// layout. Called from the buildings component (index.ts).
//
// Only BUILDINGS are consolidated into spatial-grid cells. Streets,
// labels, paths, and the root gem stay on the engine-built path because
// the engine handles those fine even at Linux scale.

import * as THREE from 'three';
import { SpatialGrid, type WorldBounds } from './spatialGrid';
import { createEmptyCellTile, type CellTile, allocateSlot } from './cellTile';
import { attachBuildingMeshToCell, writeBuildingToSlot } from './cellMesh';
import { InstancedAdPanels } from './adPanels';
import { isMediaFile } from '@/city/utils/mediaKind';
import { isDataBuilding } from '@/city/utils/binaryKind';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { BuildingIndex } from './buildingIndex';
import type { Building } from '@/types/index';

export interface CellAssemblyOutput {
  grid: SpatialGrid;
  cells: Map<number, CellTile>;
  index: BuildingIndex;
  sceneRoot: THREE.Group;
  /** Instanced ad panels for media files. Null when there are no media buildings. */
  adPanels: InstancedAdPanels | null;
}

/**
 * Assemble a cell-based scene from a layout's buildings. Only buildings are
 * placed into cells — streets, labels, paths, and the gem remain on the
 * engine-built rendering path. Cells share the one building material
 * (material.getBuildingMaterial(), via attachBuildingMeshToCell).
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
  buildings: Building[]
): CellAssemblyOutput {
  const cellSize = SpatialGrid.computeOptimalCellSize(bounds);
  const grid = new SpatialGrid(bounds, cellSize);

  // ---- Sparse pass: count buildings per occupied cell ----
  const cellCounts = new Map<number, number>();
  for (const b of buildings) {
    const { cellId } = grid.worldToCell(b.x, b.y);
    cellCounts.set(cellId, (cellCounts.get(cellId) ?? 0) + 1);
  }

  // ---- Sparse allocation: each cell sized to its OWN load (a global average
  // over-fills sparse cells and overflows dense ones, e.g. a monorepo subtree). ----
  const cells = new Map<number, CellTile>();
  for (const [id, count] of cellCounts) {
    const cell = createEmptyCellTile(grid, id, cellCapacityFor(count));
    attachBuildingMeshToCell(cell);
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
      // Overflow: capacity was under-estimated. Log and skip.
      console.warn(
        '[cellAssembly] capacity overflow for cell',
        cellId,
        '— building',
        b.file?.path,
        'skipped'
      );
      continue;
    }
    b.cellId = cellId;
    b.slotId = slot;
    cell.buildings[slot] = b;
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

  // ---- Instanced facade panels (media billboards + binary fingerprints) ----
  // One InstancedMesh backed by a DataArrayTexture serves both: each registered
  // building carries its own loader (media image vs byte-pattern fingerprint) and
  // aspect, so the LOD/streaming/fade machinery is shared. Media panels are gated
  // on AD_ENABLED (the A/B toggle for isolating billboard perf cost); binary
  // fingerprint panels are a distinct feature and always render.
  const mediaBuildings = BUILDINGS.value.AD_ENABLED
    ? buildings.filter((b) => isMediaFile(b.file))
    : [];
  const binaryBuildings = buildings.filter((b) => isDataBuilding(b.file));
  let adPanels: InstancedAdPanels | null = null;
  const panelCount = mediaBuildings.length + binaryBuildings.length;
  if (panelCount > 0) {
    const capacity = Math.max(64, Math.ceil(panelCount * 1.5));
    adPanels = new InstancedAdPanels(capacity);
    // Register (allocate slots + faces) now, but DON'T load the textures here —
    // the per-frame updateLOD streams them in for on-screen panels only, so a
    // media/binary-heavy repo doesn't hang on a load burst. See InstancedAdPanels.
    for (const b of mediaBuildings) adPanels.registerMediaBuilding(b);
    for (const b of binaryBuildings) adPanels.registerBinaryBuilding(b);
    sceneRoot.add(adPanels.mesh);
  }

  return { grid, cells, index, sceneRoot, adPanels };
}

// Per-cell capacity: the cell's own building count plus 50% headroom for
// later growth (live edits), floored at 64.
function cellCapacityFor(count: number): number {
  return Math.max(64, Math.ceil(count * 1.5));
}
