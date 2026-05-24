// scene/instanced/labels.ts — Re-exports of the shared label atlas builder
// + the label-material cache disposer.
//
// The atlas builder itself lives in labelAtlas.ts (reused by the
// cell-aware factory in labelsCell.ts); this module re-exports the public
// types/function and owns the disposal hook for any cached materials
// keyed by atlas CanvasTexture.

import * as THREE from 'three';

// Re-export shared atlas types + builder from the extracted module.
export type { LabelAtlasRect, LabelAtlasResult } from './labelAtlas.js';
export { buildLabelAtlas } from './labelAtlas.js';

// One ShaderMaterial per atlas texture (= per atlas page). world owns
// the textures' lifetime; when it disposes them it calls
// disposeLabelMaterials() to evict.
const _labelMaterials = new Map<THREE.CanvasTexture, THREE.ShaderMaterial>();

export function disposeLabelMaterials(): void {
  for (const mat of _labelMaterials.values()) mat.dispose();
  _labelMaterials.clear();
}
