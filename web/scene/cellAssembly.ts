// scene/cellAssembly.ts — Wires SpatialGrid + CellTile + per-cell
// factories (buildings, labels, streets) into a complete scene-
// ready set of cells given a layout. Called from cityScene.ts
// when CELL_RENDERING.enabled. The progressive build path
// (Task 17) calls into similar primitives but inserts
// incrementally; this path inserts everything at once for the
// initial flag-on smoke test.

import * as THREE from 'three';
import { SpatialGrid, type WorldBounds } from './spatialGrid.js';
import { createEmptyCellTile, type CellTile, allocateSlot } from './cellTile.js';
import { attachBuildingMeshToCell, writeBuildingToSlot } from './instanced/buildingsCell.js';
import { attachLabelMeshToCell, writeLabelToSlot } from './instanced/labelsCell.js';
import { buildCellStreetMesh, type SidewalkRect } from './instanced/streetTile.js';
import { BuildingIndex } from './buildingIndex.js';
import type { LabelAtlasResult } from './instanced/labels.js';
import type { Building } from '@/types/index.js';

export interface CellAssemblyOutput {
  grid: SpatialGrid;
  cells: CellTile[];
  index: BuildingIndex;
  sceneRoot: THREE.Group;
}

/**
 * Convert a Street's bounding information into a SidewalkRect (axis-aligned
 * rectangle) for use by buildCellStreetMesh. Streets are stadium-shaped in
 * the legacy renderer but the cell street builder expects simple rects — we
 * approximate each street as an axis-aligned rectangle using the street's
 * center (x, y) and dimensions (width, length). The approximation loses the
 * rounded end-caps but covers the bulk of the sidewalk area correctly.
 *
 * Street.y maps to scene-Z (same axis convention as Building.y).
 */
export interface StreetLike {
  x: number;
  y: number;
  width: number;
  length: number;
}

export function streetToSidewalkRect(street: StreetLike, color: string): SidewalkRect {
  return {
    x: street.x,
    z: street.y, // layout Y → scene Z, matching Building.y convention
    w: street.length, // length along street axis = rect width in larger dim
    d: street.width,  // perpendicular width = rect depth
    color,
  };
}

/**
 * Assemble a full cell-based scene from a layout's buildings, sidewalks,
 * and a shared uniform bag. Returns the grid, cells, building index, and
 * a ready-to-add THREE.Group.
 *
 * Steps:
 *   1. Build a SpatialGrid from bounds.
 *   2. Preallocate all CellTiles and wire their InstancedMeshes.
 *   3. Insert every building into its cell, writing building + label slots.
 *   4. Build per-cell street merged geometry.
 *   5. Force detail tier visible on all cells (no LOD yet — Task 14).
 *   6. Flush instanceMatrix.needsUpdate.
 *
 * `sharedUniforms` is passed verbatim to the building ShaderMaterial
 * factory (attachBuildingMeshToCell) and the label ShaderMaterial factory
 * (attachLabelMeshToCell). Both factories tolerate unknown keys so a
 * superset of all required uniforms (the bag produced by the building
 * material factory in buildings.ts) works for both.
 *
 * `atlas` is the label text-atlas produced by buildLabelAtlas(); used by
 * writeLabelToSlot to look up the UV rect for each building's filename.
 * Pass null if labels aren't available (slots stay zero-scale / invisible).
 */
export function buildCellsFromLayout(
  bounds: WorldBounds,
  buildings: Building[],
  sidewalks: SidewalkRect[],
  sharedUniforms: Record<string, THREE.IUniform>,
  atlas: LabelAtlasResult | null,
): CellAssemblyOutput {
  // [cell-debug]
  const _t0 = performance.now();
  const grid = new SpatialGrid(bounds);
  const capacity = computeCellCapacity(grid.cellCount, buildings.length);
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 1 entered', { buildings: buildings.length, sidewalks: sidewalks.length, expectedCellCount: grid.cellCount });
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 2 SpatialGrid created', { gridW: grid.gridW, gridH: grid.gridH, cellCount: grid.cellCount });
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 3 capacity computed', { capacity });

  // ---- Preallocate all cells ----
  // [cell-debug]
  const _allocT0 = performance.now();
  const cells: CellTile[] = [];
  for (let id = 0; id < grid.cellCount; id++) {
    const cell = createEmptyCellTile(grid, id, capacity);
    attachBuildingMeshToCell(cell, sharedUniforms);
    attachLabelMeshToCell(cell, sharedUniforms);
    cells.push(cell);
  }
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 4 allocated empty cells', { count: cells.length, elapsedMs: performance.now() - _allocT0 });
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 5 material attachments done', { count: cells.length, elapsedMs: performance.now() - _allocT0 });

  // ---- Insert buildings ----
  // [cell-debug]
  const _buildT0 = performance.now();
  const index = new BuildingIndex();
  for (const b of buildings) {
    // building.y is layout-Z (world XZ plane — same convention as
    // buildBuildingInstanceBuffer and blocks.ts:88). worldToCell takes
    // (worldX, worldZ) so we pass b.x and b.y.
    const { cellId } = grid.worldToCell(b.x, b.y);
    const cell = cells[cellId];
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
    if (atlas) {
      writeLabelToSlot(cell, b, atlas);
    }
    index.insert(b);
  }
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 6 buildings assigned to slots', { count: buildings.length, elapsedMs: performance.now() - _buildT0 });

  // ---- Build per-cell street geometry ----
  // [cell-debug]
  const _streetT0 = performance.now();
  let streetMeshCount = 0;
  for (const cell of cells) {
    cell.streetMesh = buildCellStreetMesh(grid, cell.cellId, sidewalks);
    if (cell.streetMesh) streetMeshCount++;
  }
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 7 street meshes built', { total: cells.length, nonNull: streetMeshCount, elapsedMs: performance.now() - _streetT0 });

  // ---- Force detail tier visible (no LOD yet — Task 14 adds the evaluator) ----
  // [cell-debug]
  const _visT0 = performance.now();
  const sceneRoot = new THREE.Group();
  sceneRoot.name = 'CellRoot';
  for (const cell of cells) {
    cell.tier = 'detail';
    cell.detailMesh.visible = true;
    cell.labelMesh.visible = atlas !== null; // visible only when atlas is available
    // impostorMesh stays hidden until Task 13 attaches an impostor geometry.
    // Adding it to the group now so the scene hierarchy is complete; its
    // `visible = false` default (set by createEmptyCellTile) keeps it dark.
    sceneRoot.add(cell.detailMesh);
    sceneRoot.add(cell.impostorMesh);
    sceneRoot.add(cell.labelMesh);
    if (cell.streetMesh) sceneRoot.add(cell.streetMesh);
  }
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 8 visibility flags set', { count: cells.length, elapsedMs: performance.now() - _visT0 });
  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 9 SceneRoot constructed', { childCount: sceneRoot.children.length });

  // ---- Flush attribute uploads ----
  for (const cell of cells) {
    cell.detailMesh.instanceMatrix.needsUpdate = true;
    cell.impostorMesh.instanceMatrix.needsUpdate = true;
    cell.labelMesh.instanceMatrix.needsUpdate = true;
  }

  // [cell-debug]
  console.log('[cell] buildCellsFromLayout: 10 returning', { totalMs: performance.now() - _t0 });
  return { grid, cells, index, sceneRoot };
}

function computeCellCapacity(cellCount: number, expectedFiles: number): number {
  if (expectedFiles === 0) return 64;
  const avg = Math.ceil(expectedFiles / cellCount);
  return Math.max(64, avg * 4);
}
