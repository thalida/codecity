// scene/components/repoLabel/styleInstance.ts — Shared contract every
// style factory in this module returns. The dispatcher in repoLabel.ts
// holds one of these at a time and swaps it on STYLE config changes.

import type * as THREE from 'three';

/**
 * Per-frame dimensions that drive geometry scaling.
 *
 * cityRadius — half of the city's max horizontal extent in world units.
 *   Used by Ring/Concentric (torus radius) and Hologram (text panel
 *   width).
 * beamLength — world-space distance from the anchor base (gem) to the
 *   label's center. Equal to HEIGHT_ABOVE_CITY. Used only by Hologram
 *   (beam cylinder length); Ring and Concentric ignore it.
 */
export interface RepoLabelDimensions {
  cityRadius: number;
  beamLength: number;
}

export interface RepoLabelStyleInstance {
  /** Style-specific group; added as a child of the RepoLabel root group. */
  group: THREE.Group;
  /** Advance time-driven uniforms and per-frame transforms. */
  tick(dtSeconds: number, camera: THREE.Camera, animationSpeed: number): void;
  /** Push the master opacity into all style-internal uniforms. */
  setOpacity(opacity: number): void;
  /**
   * Push the current world-space dimensions. Implementations adjust
   * mesh.scale / mesh.position to fit — no geometry rebuild. Called by
   * the dispatcher after style creation and whenever cityRadius or
   * beamLength changes.
   */
  setDimensions(dimensions: RepoLabelDimensions): void;
  /** Release all geometries and materials. */
  dispose(): void;
}
