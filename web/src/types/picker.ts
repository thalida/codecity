// types/picker.ts — selection / hover state shapes used by the
// raycaster and consumed by every selection-driven renderer.

import type * as THREE from 'three';
import type { Building } from './building';
import type { Street } from './street';
import type { CommitEntry, DirNode, FileNode, NodeKind } from './manifest';
import type { BuildingIndex } from '@/scene/components/buildings/buildingIndex.js';
import type { CellTile } from '@/scene/layout/cellTile.js';

/** Hovered/selected file (a building mesh). */
export interface FileTarget {
  kind: NodeKind.File;
  mesh: THREE.Mesh;
  data: Building;
  file: FileNode;
  /** Slot index within the cell's InstancedMesh. */
  instanceId?: number;
}

/** Hovered/selected directory (a sidewalk mesh + its street group). */
export interface DirTarget {
  kind: NodeKind.Directory;
  sidewalk: THREE.Mesh;
  street: Street;
  dir: DirNode;
}

/** Hovered/selected root gem. */
export interface GemTarget {
  kind: NodeKind.Gem;
  mesh: THREE.Object3D;
}

/** Hovered/selected tree (a canopy or trunk InstancedMesh instance). */
export interface CommitTarget {
  kind: NodeKind.Commit;
  mesh: THREE.InstancedMesh;
  instanceId: number;
  commit: CommitEntry;
}

/** Tagged union of every pick-able thing. */
export type PickTarget = FileTarget | DirTarget | GemTarget | CommitTarget;

/**
 * Stable identity used to re-resolve a selection across world
 * rebuilds. Persisted via attachPersistence.
 */
export type PickerSelectionKey =
  | { kind: NodeKind.File; path: string }
  | { kind: NodeKind.Directory; path: string }
  | { kind: NodeKind.Commit; sha: string };

/**
 * Subset of the world API that the picker depends on. Real
 * world structurally satisfies this; tests can mock just these
 * methods.
 */
export interface PickerWorld {
  getStreetPickables(): THREE.Object3D[];
  getRootGem(): THREE.Object3D | null;
  getBuildingByPath(path: string): { mesh: THREE.Mesh; building: Building; instanceId?: number } | null;
  getSidewalkByDir(path: string): THREE.Mesh | null;
  getStreetByDir(path: string): Street | null;
  onChange(cb: () => void): () => void;
  /** Returns the BuildingIndex. */
  getBuildingIndex(): BuildingIndex | null;
  /** Returns the cells map. */
  getCells(): Map<number, CellTile>;
  /** Returns the Trees instance (null when no manifest applied yet
   *  or when TREES_ENABLED is off). */
  getTrees(): {
    group: THREE.Group;
    commitForInstance(mesh: THREE.InstancedMesh, instanceId: number): CommitEntry | null;
    findTreeBySha(sha: string): {
      mesh: THREE.InstancedMesh;
      instanceId: number;
      commit: CommitEntry;
    } | null;
    colorForSha(sha: string): string | null;
  } | null;
}
