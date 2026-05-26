// scene/components/repoLabel/styleInstance.ts — Shared contract every
// style factory in this module returns. The dispatcher in repoLabel.ts
// holds one of these at a time and swaps it on STYLE config changes.

import type * as THREE from 'three';

export interface RepoLabelStyleInstance {
  /** Style-specific group; added as a child of the RepoLabel root group. */
  group: THREE.Group;
  /** Advance time-driven uniforms and per-frame transforms. */
  tick(dtSeconds: number, camera: THREE.Camera, animationSpeed: number): void;
  /** Push the master opacity into all style-internal uniforms. */
  setOpacity(opacity: number): void;
  /** Release all geometries and materials. */
  dispose(): void;
}
