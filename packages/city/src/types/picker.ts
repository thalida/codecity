// types/picker.ts — selection / hover state shapes used by the
// raycaster and consumed by every selection-driven renderer.
//
// TEMPORARY HOME. This belongs in @codecity/city and moves there in step 10 of
// #208, in the same commit as src/city/. It cannot go first: every shape below
// carries a real THREE.Mesh, so moving it alone puts a second copy of
// @types/three in the tree and the app's Mesh stops being assignable to the
// package's. The two imports below point back at the meshes it describes —
// when they cross, so does this.

import type * as THREE from 'three';
import type { Building } from '@/city/types/building';
import type { CommitEntry, DirNode, FileNode, NodeKind } from '@/city/types/manifest';
import type { Street } from '@/city/types/street';
import type { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import type { CellTile } from '@/city/components/buildings/cellTile';

/** Hovered/selected file (a building mesh). */
export interface FileTarget {
  kind: NodeKind.File;
  mesh: THREE.Mesh;
  data: Building;
  file: FileNode;
  /** Slot index within the cell's InstancedMesh. */
  instanceId?: number;
  /** Timeline mode: this building is a ghost-ruin (deleted before the scrubbed commit). */
  isRuin?: boolean;
}

/** Hovered/selected directory (a sidewalk mesh + its street group). */
export interface DirTarget {
  kind: NodeKind.Directory;
  sidewalk: THREE.Mesh;
  street: Street;
  dir: DirNode;
  /** Timeline mode: this road's folder is a ghost-ruin (all its files deleted). */
  isRuin?: boolean;
  /** The picked face's first sidewalk vertex — lets the scrub-hidden re-check
   *  read this street's aOpacity without a fresh raycast. */
  vertexHint?: number;
}

/** Hovered/selected root gem. */
export interface GemTarget {
  kind: NodeKind.Gem;
  mesh: THREE.Object3D;
}

/** A commit. Its mesh is absent when the city drew no tree for it: it stays
 *  selectable, and the pane reads the entry rather than the mesh. */
export interface CommitTarget {
  kind: NodeKind.Commit;
  mesh?: THREE.Mesh;
  instanceId?: number;
  commit: CommitEntry;
}

/** Tagged union of every pick-able thing. */
export type PickTarget = FileTarget | DirTarget | GemTarget | CommitTarget;

/** Stable identity for re-resolving a selection across world rebuilds. */
export type PickerSelectionKey =
  | { kind: NodeKind.File; path: string }
  | { kind: NodeKind.Directory; path: string }
  | { kind: NodeKind.Commit; sha: string };

/** The world surface the picker depends on; the real world satisfies it
 *  structurally, so tests can mock these methods alone. */
export interface PickerWorld {
  getStreetPickables(): THREE.Object3D[];
  getRootGem(): THREE.Object3D | null;
  getBuildingByPath(
    path: string
  ): { mesh: THREE.Mesh; building: Building; instanceId?: number } | null;
  getSidewalkByDir(path: string): THREE.Mesh | null;
  getStreetByDir(path: string): Street | null;
  /** Returns the BuildingIndex. */
  getBuildingIndex(): BuildingIndex | null;
  /** Returns the cells map. */
  getCells(): Map<number, CellTile>;
  /** Returns the Trees instance (null when no manifest applied yet
   *  or when ENABLED is off). */
  getTrees(): {
    group: THREE.Group;
    commitForFace(
      mesh: THREE.Object3D,
      faceIndex: number | null | undefined
    ): { commit: CommitEntry; placementIndex: number } | null;
    findTreeBySha(sha: string): {
      mesh: THREE.Mesh;
      instanceId: number;
      commit: CommitEntry;
    } | null;
    getInstanceTransform(sha: string, out: THREE.Matrix4): boolean;
    colorForSha(sha: string): string | null;
    isScrubHidden(placementIndex: number): boolean;
  } | null;
}
