// three-augment.d.ts — module augmentation for three.js.
// We attach app-specific data to mesh.userData throughout the renderer
// (selection state, layout back-pointers, animation parameters, etc.).
// Augmenting Object3D's userData here means the rest of the codebase
// reads typed fields without `as` casts at every call site.
//
// The shape lists every userData key currently stamped in scene/ and
// views/. All optional — most meshes only set a subset relevant to their
// kind (a building stamps {type, building, paired, …}, a label stamps
// {type, baseRotY, flipped, …}, etc).

import 'three';
import type { Building, DirNode, FileNode, NodeKind, Street } from './types';

declare module 'three' {
  interface Object3DUserData {
    type?: NodeKind;

    // Layout back-pointers stamped by buildCityScene
    building?: Building;
    street?: Street;
    file?: FileNode;
    dir?: DirNode;
    sidewalk?: boolean;
    asphalt?: boolean;
    gem?: boolean;

    // Selection / fade / outline animation state (per-frame writers/readers)
    bodyOp?: number;
    ghostOp?: number;
    outlineOp?: number;
    origColor?: number;

    // Outline + ghost paired with a building mesh (for disposeMesh fan-out)
    paired?: {
      outline: import('three').Object3D | null;
      ghost: import('three').Object3D | null;
      mat: import('three/addons/lines/LineMaterial.js').LineMaterial | null;
    } | null;

    // Street-label baked rotation + flip state (per-frame orientation)
    baseRotY?: number;
    flipped?: boolean;
    origHeightFrac?: number;
    textureAspect?: number;

    // Gem animation state
    baseY?: number;
    bobAmp?: number;
    radius?: number;
    streetWidth?: number;

    // Misc bookkeeping
    disposed?: boolean;
    exiting?: boolean;
    renderOrderLayer?: number;
  }

  interface Object3D {
    userData: Object3DUserData;
  }
}
