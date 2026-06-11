// city/utils/cityDiff.ts — pure manifest-diff computation extracted from
// world.ts. Compares the prior city state against the next one at the
// per-instance (file.path / dir.path key) level, producing entering /
// staying / exiting buckets that the animator consumes to write instance
// matrices.
//
// Pure function: everything it reads is passed in via `prev` (the snapshot
// captured before disposal) and `next` (the freshly-rebuilt state). It never
// touches module-level state, so it can be unit-tested in isolation.

import * as THREE from 'three';

import type { CellTile } from '../components/buildings/cellTile';
import { BuildingIndex } from '../components/buildings/buildingIndex';
import type {
  CityLayout,
  EnteringBuilding,
  EnteringStreet,
  ExitingEntry,
  Manifest,
  StayingBuilding,
  StayingStreet,
  WorldDiff,
} from '@/types';

// The flat ground meshes (sidewalks, paths, asphalt) all use a single
// MeshBasicMaterial. Typed with a single material (rather than the default
// `Material | Material[]`) to match world.ts's FlatMesh alias.
type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

// Snapshot of the prior manifest state captured at the top of applyManifest,
// used by the diff and the change-listener payload.
export interface PrevState {
  streetPickables: FlatMesh[];
  streetLabels: THREE.Group[];
  asphaltMeshes: FlatMesh[];
  manifest: Manifest | null;
  layout: CityLayout | null;
  /** Snapshot of cells before they are replaced/disposed. */
  cells: Map<number, CellTile>;
  /** Snapshot of building index before it is replaced. */
  buildingIndex: BuildingIndex | null;
}

// The freshly-rebuilt state the diff classifies `prev` against. These are the
// module vars world.ts's _computeDiff used to read directly (_buildingIndex,
// streetPickables) — now passed explicitly so the function is pure.
export interface NextState {
  cells: Map<number, CellTile>;
  buildingIndex: BuildingIndex | null;
  streetPickables: FlatMesh[];
}

// computeCityDiff compares prev cells vs new cells at the per-instance
// (file.path key) level, producing entering / staying / exiting buckets
// that the animator uses to write instance matrices.
//
// Prev cell transforms are read from prev.cells (captured before the cell
// root is disposed) because disposal releases the InstancedMesh attribute
// buffers. The Map reference is stable across the disposal because world
// replaces its module-level `_cells` binding but the snapshot still points
// at the old Map.
export function computeCityDiff(prev: PrevState, next: NextState): WorldDiff {
  const entering: { buildings: EnteringBuilding[]; streets: EnteringStreet[] } = {
    buildings: [],
    streets: [],
  };
  const exiting: { buildings: ExitingEntry[]; streets: ExitingEntry[] } = {
    buildings: [],
    streets: [],
  };
  const staying: { buildings: StayingBuilding[]; streets: StayingStreet[] } = {
    buildings: [],
    streets: [],
  };

  // --- Buildings diff (InstancedMesh semantics) ---
  //
  // Build a map from file.path → prior transform (scale + position).
  // Read from each cell's detailMesh at the building's slotId to capture
  // whatever the animator left it at (so a rapid edit doesn't snap to layout).
  const prevTransforms = new Map<
    string,
    { scaleX: number; scaleY: number; scaleZ: number; posX: number; posY: number; posZ: number }
  >();
  const _readMatrix = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _scale = new THREE.Vector3();
  const _quat = new THREE.Quaternion();

  // Read prior transforms from the old CellTile meshes.
  // NOTE: prev.cells is the snapshot captured before _cells was replaced.
  // The old cell root may already be disposed, but the CellTile.detailMesh
  // references are still valid until GC collects them — we only read, not draw.
  for (const cell of prev.cells.values()) {
    for (let slot = 0; slot < cell.buildings.length; slot++) {
      const b = cell.buildings[slot];
      if (!b?.file?.path) continue;
      if (cell.detailMesh) {
        cell.detailMesh.getMatrixAt(slot, _readMatrix);
        _readMatrix.decompose(_pos, _quat, _scale);
        prevTransforms.set(b.file.path, {
          scaleX: _scale.x,
          scaleY: _scale.y,
          scaleZ: _scale.z,
          posX: _pos.x,
          posY: _pos.y,
          posZ: _pos.z,
        });
      } else {
        prevTransforms.set(b.file.path, {
          scaleX: b.w,
          scaleY: b.h,
          scaleZ: b.d,
          posX: b.x,
          posY: b.h / 2,
          posZ: b.y,
        });
      }
    }
  }

  // Walk the new BuildingIndex to classify entering vs staying.
  if (next.buildingIndex) {
    for (const b of next.buildingIndex.byPath.values()) {
      if (!b.file?.path) continue;
      const newScaleX = b.w;
      const newScaleY = b.h;
      const newScaleZ = b.d;
      const newPosX = b.x;
      const newPosY = b.h / 2;
      const newPosZ = b.y;
      const instanceId = b.slotId ?? 0;

      const prior = prevTransforms.get(b.file.path);
      if (prior) {
        staying.buildings.push({
          building: b,
          instanceId,
          newScaleX,
          newScaleY,
          newScaleZ,
          newPosX,
          newPosY,
          newPosZ,
          oldScaleX: prior.scaleX,
          oldScaleY: prior.scaleY,
          oldScaleZ: prior.scaleZ,
          oldPosX: prior.posX,
          oldPosY: prior.posY,
          oldPosZ: prior.posZ,
        });
      } else {
        entering.buildings.push({
          building: b,
          instanceId,
          newScaleX,
          newScaleY,
          newScaleZ,
          newPosX,
          newPosY,
          newPosZ,
        });
      }
    }
  }

  // Exiting buildings: paths present in prev but absent from new.
  // V1: no exit animation — they just vanish when cells are rebuilt.
  // We still populate the exiting bucket so subscribers can track counts.
  const newPaths = new Set<string>();
  if (next.buildingIndex) {
    for (const path of next.buildingIndex.byPath.keys()) newPaths.add(path);
  }
  for (const [path] of prevTransforms) {
    if (!newPaths.has(path)) {
      exiting.buildings.push({});
    }
  }

  // --- Streets diff (still per-mesh) ---
  const prevStreets: Record<string, THREE.Mesh> = {};
  for (const sw of prev.streetPickables ?? []) {
    const dp = sw.userData.street?.dir?.path;
    if (dp != null) prevStreets[dp] = sw;
  }
  for (const nsw of next.streetPickables) {
    const ndp = nsw.userData.street?.dir?.path;
    if (ndp == null) continue;
    if (Object.hasOwn(prevStreets, ndp)) {
      staying.streets.push({ oldMesh: prevStreets[ndp], newMesh: nsw });
      delete prevStreets[ndp];
    } else {
      entering.streets.push({ mesh: nsw });
    }
  }
  for (const sk in prevStreets) {
    if (Object.hasOwn(prevStreets, sk)) {
      exiting.streets.push({ mesh: prevStreets[sk] });
    }
  }

  return { entering, exiting, staying };
}
