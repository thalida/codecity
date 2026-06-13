// city/types/index.ts — shared scene-component contracts.
//
// These interfaces define the uniform shape every scene component, the city
// composer, and the render loop agree on. Nothing in this file is runtime
// code; it is types-only. Implementations live in the individual component
// and system files; wiring happens in later tasks.

import type * as THREE from 'three';
import type { Picker } from '../interaction/picker';
import type { CameraRig } from '../render/cameraRig';
import type { CityState } from '../state';
import type { Trees } from '../components/trees/treeRenderer';
import type { Manifest, DirNode, Street } from '@/types';

/** Everything a scene component needs to wire itself into the scene at
 *  construction time (renderer, camera, raycaster/picker, per-city state). */
export interface SceneContext {
  scene: THREE.Scene;
  picker: Picker;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  cityState: CityState;
}

/** Per-frame state passed to each component's tick() method. */
export interface FrameContext {
  dt: number;
  time: number;
  camera: THREE.PerspectiveCamera;
}

/** Minimal uniform contract every scene component satisfies. */
export interface SceneComponent {
  /** The composer adds this to the scene. */
  group: THREE.Object3D;
  /** Frame loop calls it if present. */
  tick?(dt: number, ctx: FrameContext): void;
  /** Frees GPU resources AND stops own effects. */
  dispose(): void;
}

/** View/debug read API exposed on City.world — the only world surface
 *  consumers still touch (header/sidebar reads + the two debug diagnostics). */
export interface CityWorld {
  getRoot(): DirNode | null;
  getManifest(): Manifest | null;
  getTrees(): Trees | null;
  getStreetByDir(path: string): Street | null;
  runCollisionCheck(): void;
  runStemPlacementDiagnostic(): void;
}

/** The top-level city object returned by the city composer (createCity). */
export interface City {
  scene: THREE.Scene;
  picker: Picker;
  rig: CameraRig;
  applyTheme(): void;
  applyManifest(m: Manifest): Promise<void>;
  invalidateLayoutCache(): void;
  focusByPath(path: string): void;
  world: CityWorld;
}
