// city/components/buildings/cellAssembly.ts — turns a layout into a scene-ready
// set of cells. Only BUILDINGS are consolidated this way; streets, labels, paths
// and the gem stay engine-built, which holds up even at Linux scale.

import * as THREE from 'three';
import { SpatialGrid, type WorldBounds } from './spatialGrid';
import { createEmptyCellTile, type CellTile, allocateSlot } from './cellTile';
import { attachBuildingMeshToCell, writeBuildingToSlot } from './cellMesh';
import { InstancedFacadePanels } from './facadePanels';
import { isMediaFile } from '@/utils/mediaKind';
import { isDataBuilding } from '@/utils/binaryKind';
import { isEmptyFile } from '@/utils/emptyKind';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { BuildingIndex } from './buildingIndex';
import type { Building } from '@/types/index';

export interface CellAssemblyOutput {
  grid: SpatialGrid;
  cells: Map<number, CellTile>;
  index: BuildingIndex;
  sceneRoot: THREE.Group;
  /** Media + binary facade panels; null when there are neither. */
  facadePanels: InstancedFacadePanels | null;
}

/** Assemble a cell-based scene from a layout's buildings. Sparse: only occupied
 *  cells are allocated, so the count tracks directory density, not grid extent. */
export function buildCellsFromLayout(
  bounds: WorldBounds,
  buildings: Building[]
): CellAssemblyOutput {
  const cellSize = SpatialGrid.computeOptimalCellSize(bounds);
  const grid = new SpatialGrid(bounds, cellSize);

  // ---- Sparse pass: count buildings per occupied cell, and measure how far
  // each cell's contents reach, so its cull sphere covers them. ----
  const cellCounts = new Map<number, number>();
  const cellExtents = new Map<number, { maxHeight: number; overhang: number }>();
  for (const b of buildings) {
    const { cellId } = grid.worldToCell(b.x, b.y);
    cellCounts.set(cellId, (cellCounts.get(cellId) ?? 0) + 1);
    const prev = cellExtents.get(cellId);
    // A building tweens to b.h on a rebuild and is scrubbed no taller, so its
    // final size is the ceiling for every state the cell renders.
    const maxHeight = Math.max(prev?.maxHeight ?? 0, b.h);
    const overhang = Math.max(prev?.overhang ?? 0, b.w / 2, b.d / 2);
    cellExtents.set(cellId, { maxHeight, overhang });
  }

  // ---- Sparse allocation: each cell sized to its OWN load (a global average
  // over-fills sparse cells and overflows dense ones, e.g. a monorepo subtree). ----
  const cells = new Map<number, CellTile>();
  for (const [id, count] of cellCounts) {
    const cell = createEmptyCellTile(grid, id, cellCapacityFor(count), cellExtents.get(id));
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

  // One mesh serves both, so they share the LOD/streaming/fade machinery.
  // Textures load later: updateLOD streams in the ones actually on screen.
  const mediaBuildings = BUILDINGS.value.MEDIA_ENABLED
    ? buildings.filter((b) => isMediaFile(b.file) && !isEmptyFile(b.file))
    : [];
  // DATA_ENABLED gates only the facade texture; the windowless block still
  // renders from the building mesh (cellMesh) regardless.
  const binaryBuildings = BUILDINGS.value.DATA_ENABLED
    ? buildings.filter((b) => isDataBuilding(b.file) && !isEmptyFile(b.file))
    : [];
  let facadePanels: InstancedFacadePanels | null = null;
  const panelCount = mediaBuildings.length + binaryBuildings.length;
  if (panelCount > 0) {
    facadePanels = new InstancedFacadePanels(Math.max(64, Math.ceil(panelCount * 1.5)));
    for (const b of mediaBuildings) facadePanels.registerMediaBuilding(b);
    for (const b of binaryBuildings) facadePanels.registerBinaryBuilding(b);
    sceneRoot.add(facadePanels.mesh);
  }

  return { grid, cells, index, sceneRoot, facadePanels };
}

// Per-cell capacity: the cell's own building count plus 50% headroom for
// later growth (live edits), floored at 64.
function cellCapacityFor(count: number): number {
  return Math.max(64, Math.ceil(count * 1.5));
}
