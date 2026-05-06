// types/picker.ts — selection / hover state shapes used by the
// raycaster and consumed by every selection-driven renderer.

import type * as THREE from 'three';
import type { Building } from './building';
import type { Street } from './street';
import type { DirNode, FileNode, NodeKind } from './manifest';
import type { SceneBlock } from '@/scene/blocks.js';

/** Hovered/selected file (a building mesh). */
export interface FileTarget {
  kind: NodeKind.File;
  mesh: THREE.Mesh;
  data: Building;
  file: FileNode;
  /** Per-block instance index. Set when the hit came from an InstancedMesh. */
  instanceId?: number;
  /** The SceneBlock this instance lives in. Set when the hit came from an InstancedMesh. */
  block?: SceneBlock;
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

/** Tagged union of every pick-able thing. */
export type PickTarget = FileTarget | DirTarget | GemTarget;

/**
 * Stable identity used to re-resolve a selection across cityScene
 * rebuilds. Persisted via attachPersistence.
 */
export interface PickerSelectionKey {
  kind: NodeKind.File | NodeKind.Directory;
  path: string;
}

/**
 * Subset of the cityScene API that the picker depends on. Real
 * cityScene structurally satisfies this; tests can mock just these
 * methods.
 */
export interface PickerCityScene {
  getBuildings(): THREE.Object3D[];
  getStreetPickables(): THREE.Object3D[];
  getRootGem(): THREE.Object3D | null;
  getBuildingByPath(path: string): { mesh: THREE.Mesh; building: Building; block?: SceneBlock; instanceId?: number } | null;
  getSidewalkByDir(path: string): THREE.Mesh | null;
  getStreetByDir(path: string): Street | null;
  onChange(cb: () => void): () => void;
}
