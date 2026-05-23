// scene/instanced/impostorCell.ts — Cell-aware impostor mesh factory.
//
// Each cell's impostorMesh is a cheap flat-shaded box InstancedMesh that
// replaces the full building shader when the cell's projected pixel area
// drops below SWAP_TO_IMPOSTOR_PX. A single shared BoxGeometry is cloned
// per cell (so each cell has its own InstancedBufferAttributes), and a
// single shared ShaderMaterial is reused across all cells.

import * as THREE from 'three';
import type { CellTile } from '@/scene/cellTile.js';
import type { Building } from '@/types/index.js';
import impostorVert from '@/scene/shaders/impostor.vert.glsl?raw';
import impostorFrag from '@/scene/shaders/impostor.frag.glsl?raw';

const SHARED_IMPOSTOR_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
let _sharedImpostorMaterial: THREE.ShaderMaterial | null = null;
let _sharedImpostorMaterialUniforms: Record<string, THREE.IUniform> | null = null;

function getOrCreateImpostorMaterial(
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  if (_sharedImpostorMaterial && _sharedImpostorMaterialUniforms === uniforms) {
    return _sharedImpostorMaterial;
  }
  // Chunks are registered via THREE.ShaderChunk in registerShaderChunks.ts;
  // Three.js's native preprocessor resolves #include <name> at compile time.
  const fragSrc = impostorFrag;
  _sharedImpostorMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: impostorVert,
    fragmentShader: fragSrc,
    transparent: true,
  });
  _sharedImpostorMaterialUniforms = uniforms;
  return _sharedImpostorMaterial;
}

/**
 * Attach impostor geometry and material to an existing cell's impostorMesh.
 * Disposes the placeholder geometry that was set in createEmptyCellTile and
 * replaces it with a cloned BoxGeometry carrying per-instance iColor and iFade
 * attributes. The shared ShaderMaterial is reused (not cloned).
 *
 * `uniforms` should be the same shared uniforms passed to the detail mesh so
 * impostors pick up theme/lighting changes consistently. The fragment shader
 * reads `uSunDirWorld`, `uAmbient`, and `uSunContrast` from this bag — extra
 * keys (e.g. building-shader uniforms) are ignored.
 *
 * Call this once per cell after createEmptyCellTile and attachBuildingMeshToCell.
 */
export function attachImpostorMeshToCell(
  cell: CellTile,
  uniforms: Record<string, THREE.IUniform>,
): void {
  const geom = SHARED_IMPOSTOR_GEOMETRY.clone();
  geom.setAttribute(
    'iColor',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity * 3), 3),
  );
  geom.setAttribute(
    'iFade',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1),
  );
  const mat = getOrCreateImpostorMaterial(uniforms);
  cell.impostorMesh.geometry.dispose();
  cell.impostorMesh.geometry = geom;
  cell.impostorMesh.material = mat;
  // Signal to any dispose path that the material is shared and must not be
  // disposed by the cell.
  cell.impostorMesh.userData.sharedMaterial = true;
}

/**
 * Write a building's impostor instance into the cell's impostorMesh slot.
 * Computes a compose(position, identity, scale) matrix from building dimensions,
 * then writes iColor and iFade attributes. Call after writeBuildingToSlot.
 *
 * No-ops silently when b.slotId is null (building was not allocated a slot).
 */
export function writeImpostorToSlot(cell: CellTile, b: Building): void {
  if (b.slotId == null) return;
  const slot = b.slotId;

  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(b.x, b.h / 2, b.y),
    new THREE.Quaternion(),
    new THREE.Vector3(b.w, b.h, b.d),
  );
  cell.impostorMesh.setMatrixAt(slot, m);

  const color = new THREE.Color(b.color);
  const iColor = cell.impostorMesh.geometry.getAttribute(
    'iColor',
  ) as THREE.InstancedBufferAttribute;
  iColor.setXYZ(slot, color.r, color.g, color.b);
  iColor.needsUpdate = true;

  const iFade = cell.impostorMesh.geometry.getAttribute(
    'iFade',
  ) as THREE.InstancedBufferAttribute;
  iFade.setX(slot, 1);
  iFade.needsUpdate = true;
}
