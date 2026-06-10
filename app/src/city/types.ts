// city/types.ts — shared scene-component contracts.
//
// These interfaces define the uniform shape every scene component, the city
// composer, and the render loop agree on. Nothing in this file is runtime
// code; it is types-only. Implementations live in the individual component
// and system files; wiring happens in later tasks.

import type * as THREE from 'three';
import type { Picker } from './runtime/picker';
import type { CameraRig } from './runtime/cameraRig';
import type { Manifest } from '@/types';

/** Everything a scene component needs to wire itself into the scene at
 *  construction time (renderer, camera, raycaster/picker). */
export interface SceneContext {
  scene: THREE.Scene;
  picker: Picker;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
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

/** The top-level city object returned by the city composer. */
export interface City {
  scene: THREE.Scene;
  applyManifest(m: Manifest): Promise<void>;
  dispose(): void;
  picker: Picker;
  rig: CameraRig;
  focusByPath(path: string): void;
}
