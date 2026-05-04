// types.ts — shared type definitions used across scene/ + views/ +
// coordinator. Grown leaf-first as conversions surface what's needed.

import type { BuildingOrient, NodeKind, StreetAxis } from './constants';

// ── Manifest (what the Python scanner emits, what the renderer ingests) ──

/**
 * Git metadata for a single file. Both fields are ISO 8601 strings or null
 * (file is untracked, or git history doesn't go back that far).
 */
export interface GitMeta {
  created: string | null;
  modified: string | null;
}

export interface FileNode {
  name: string;
  type: 'file';
  path: string;
  fullPath: string;
  extension: string;
  size: number;
  lines: number;
  binary: boolean;
  created: string;
  modified: string;
  git: GitMeta | null;
}

export interface DirNode {
  name: string;
  type: 'directory';
  path: string;
  fullPath: string;
  children: TreeNode[];
  children_count: number;
  children_file_count: number;
  children_dir_count: number;
  descendants_count: number;
  descendants_file_count: number;
  descendants_dir_count: number;
  descendants_size: number;
}

export type TreeNode = FileNode | DirNode;

export interface Manifest {
  root: string;
  scanned_at: string;
  signature: string;
  tree: DirNode;
}

// ── Layout (scene/layout.ts → buildings + streets the engine renders) ────

export interface Building {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  color: string;
  file: FileNode;
  orient: BuildingOrient;
  // Floor count is stamped during layout for label/tooltip use; not
  // strictly required by every consumer.
  floors?: number;
}

export interface Street {
  x: number;
  y: number;
  width: number;
  length: number;
  label: string;
  dir: DirNode;
  orientation: StreetAxis;
  isRoot?: boolean;
}

export interface CityBbox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
  width: number;
  depth: number;
}

export interface CityLayout {
  buildings: Building[];
  streets: Street[];
  bbox: CityBbox;
}

// ── Picker (scene/picker.ts) ─────────────────────────────────────────────

import type * as THREE from 'three';

export interface FileTarget {
  kind: typeof import('./constants').NODE_KIND.FILE;
  mesh: THREE.Mesh;
  data: Building;
  file: FileNode;
}

export interface DirTarget {
  kind: typeof import('./constants').NODE_KIND.DIRECTORY;
  sidewalk: THREE.Mesh;
  street: Street;
  dir: DirNode;
}

export interface GemTarget {
  kind: typeof import('./constants').NODE_KIND.GEM;
  mesh: THREE.Object3D;
}

export type PickTarget = FileTarget | DirTarget | GemTarget;

/** Stable identity used to re-resolve a selection across cityScene rebuilds. */
export interface PickerSelectionKey {
  kind: NodeKind;
  path: string;
}

// ── Date ranges (scene/colors.ts) ─────────────────────────────────────────

export interface DateRange {
  min: number;
  max: number;
}

export interface DateRanges {
  created: DateRange;
  modified: DateRange;
}

// ── Stats over the project's files (scene/layout.ts) ──────────────────────

export interface RangeStat {
  min: number;
  max: number;
}

export interface FileStats {
  lines: RangeStat;
  bytes: RangeStat;
}
