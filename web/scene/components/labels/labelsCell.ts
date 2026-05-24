// scene/instanced/labelsCell.ts — Cell-aware label InstancedMesh factory.
//
// Replaces the per-block approach in labels.ts for the spatial-grid
// rendering path. Geometry + ShaderMaterial are constructed once
// per cell (each cell gets its own ShaderMaterial that references the
// shared-atlas page texture owned by the caller). Attribute buffers
// are pre-sized to cell.capacity via InstancedBufferAttribute so new
// buildings can be written to any slot without reallocating.
//
// Attribute semantics preserved from labels.ts / label.vert.glsl:
//   iUvRect — vec4 (u, v, w, h) in atlas UV space
//   iFlip   — float: 0 = normal, 1 = horizontally mirrored
//
// Label text for a building is b.file.name. Labels are looked up in
// the shared atlas built by buildLabelAtlas() from labelAtlas.ts.

import * as THREE from 'three';
import { LABEL_TYPOGRAPHY } from '@/config/index.js';
import { RENDER_ORDERS } from '@/constants';
import type { Building } from '@/types/index.js';
import type { CellTile } from '../../layout/cellTile.js';
import type { LabelAtlasResult } from './labelAtlas.js';

import labelVertSrc from './label.vert.glsl?raw';
import labelFragSrc from './label.frag.glsl?raw';

// ---------------------------------------------------------------------------
// Shared base geometry — unit plane (XY plane), shared across all cells.
// Per-cell InstancedBufferAttributes are attached to a shallow clone so
// they don't bleed between cells (BufferGeometry.clone() shares index +
// position buffers but creates new attribute slots).
// ---------------------------------------------------------------------------

const SHARED_LABEL_GEOMETRY = new THREE.PlaneGeometry(1, 1);

// ---------------------------------------------------------------------------
// Material cache — one ShaderMaterial shared across all cells that use the
// same uniforms object identity. Memoized on the REFERENCE of the uniforms
// bag (callers pass the same object every time — see cityScene.ts). This
// eliminates the per-cell ShaderMaterial + WebGL program compilation cost
// that was causing the tab to hang on large repos.
// ---------------------------------------------------------------------------

let _sharedLabelMaterial: THREE.ShaderMaterial | null = null;
let _sharedLabelMaterialUniforms: Record<string, THREE.IUniform> | null = null;

function getOrCreateLabelMaterial(uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  if (_sharedLabelMaterial && _sharedLabelMaterialUniforms === uniforms) {
    return _sharedLabelMaterial;
  }
  _sharedLabelMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: labelVertSrc,
    fragmentShader: labelFragSrc,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  _sharedLabelMaterialUniforms = uniforms;
  return _sharedLabelMaterial;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wire the cell's `labelMesh` with a real label geometry + ShaderMaterial
 * and allocate per-instance attribute buffers sized to `cell.capacity`.
 *
 * `sharedUniforms` must contain at least `{ uMap: { value: CanvasTexture } }`
 * referencing the atlas page texture for this cell's labels (callers choose
 * which page; the simplest strategy is page 0 for all cells and rely on the
 * atlas fitting in one page for typical repos). If `sharedUniforms.uMap.value`
 * is null or undefined (e.g., during the skeleton-manifest phase where no
 * atlas pages have been built yet), this function is a no-op and leaves the
 * placeholder mesh with `visible = false` so the cell renders correctly
 * without crashing.
 *
 * The ShaderMaterial is shared across all cells that pass the same uniforms
 * object reference (identity-memoized). Do NOT call material.dispose() on
 * the returned mesh's material — it is owned by this module, not by the cell.
 * The mesh's `userData.sharedMaterial = true` flag signals the cityScene
 * disposer to skip material disposal when tearing down the old cell root.
 *
 * Call once per cell after `createEmptyCellTile`.
 */
export function attachLabelMeshToCell(
  cell: CellTile,
  sharedUniforms: Record<string, THREE.IUniform>,
): void {
  // Guard: if no atlas texture is available (empty manifest or skeleton phase),
  // or if no labelMesh has been allocated on this cell, skip attachment.
  if (!cell.labelMesh || !sharedUniforms.uMap?.value) {
    if (cell.labelMesh) cell.labelMesh.visible = false;
    return;
  }

  const geom = SHARED_LABEL_GEOMETRY.clone();

  // Per-instance attributes — matching label.vert.glsl attribute declarations.
  // iUvRect: vec4 — (u, v, w, h) atlas sub-rect in [0,1] space.
  geom.setAttribute(
    'iUvRect',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity * 4), 4),
  );
  // iFlip: float — 0 = normal, 1 = horizontally mirrored.
  geom.setAttribute(
    'iFlip',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1),
  );

  const mat = getOrCreateLabelMaterial(sharedUniforms);

  // Replace the placeholder mesh in-place.
  cell.labelMesh.geometry.dispose();
  cell.labelMesh.geometry = geom;
  cell.labelMesh.material = mat;
  // Signal to cityScene's _disposeObject traversal that this material is
  // module-owned (shared) and must not be disposed when the cell root is
  // torn down between applyManifest calls.
  cell.labelMesh.userData.sharedMaterial = true;
  cell.labelMesh.renderOrder = RENDER_ORDERS.STREET_LABEL;
}

/**
 * Write a building's label into the cell's `labelMesh` at `b.slotId`.
 *
 * The label text is `b.file.name`. If the atlas has no rect for that text
 * (e.g. atlas wasn't built with this file's name), the slot is zeroed out
 * (scale-zero matrix → invisible).
 *
 * The instance matrix positions the label plane flat (XZ) above the
 * building's top face, scaled to a fraction of the building's footprint
 * width and oriented along the building's street axis. This mirrors the
 * per-block approach in labels.ts (rotateX(-π/2) to lay PlaneGeometry
 * flat, then translate to world position).
 *
 * Callers must set `cell.labelMesh.instanceMatrix.needsUpdate = true`
 * (and attribute `.needsUpdate = true`) after a batch of writes.
 *
 * Both `b.cellId` and `b.slotId` must already be set before calling.
 */
export function writeLabelToSlot(
  cell: CellTile,
  b: Building,
  atlas: LabelAtlasResult,
): void {
  if (!cell.labelMesh) return;
  const slot = b.slotId!;
  const mesh = cell.labelMesh;
  const label = LABEL_TYPOGRAPHY.get();

  const text = b.file?.name ?? '';
  const rect = text ? atlas.rectByText.get(text) : undefined;

  if (!rect) {
    // No atlas entry — zero-scale this slot so it renders invisible.
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    mesh.setMatrixAt(slot, zero);
    return;
  }

  // --- Label plane sizing ---
  // Height = building footprint width × HEIGHT_FRAC; width preserves aspect.
  // Cap at 90% of building footprint so long filenames don't overflow.
  const baseH = b.w * label.HEIGHT_FRAC;
  const baseW = baseH * rect.aspect;
  const maxW = b.w * 0.9;
  let worldH: number;
  let worldW: number;
  if (baseW > maxW && rect.aspect > 0) {
    worldW = maxW;
    worldH = worldW / rect.aspect;
  } else {
    worldH = baseH;
    worldW = baseW;
  }

  // --- Instance matrix ---
  // PlaneGeometry lives in the XY plane. Rotate X by -π/2 to lay it flat
  // in the XZ plane (same convention as per-block labels.ts). Then translate
  // to (b.x, b.h + label.ELEVATION, b.y) so the label sits above the roof.
  const m = new THREE.Matrix4();
  m.makeScale(worldW, worldH, 1);
  const flatRot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  m.premultiply(flatRot);
  m.setPosition(b.x, b.h + label.ELEVATION, b.y);
  mesh.setMatrixAt(slot, m);

  // --- UV rect ---
  const iUvRectAttr = mesh.geometry.getAttribute('iUvRect') as THREE.InstancedBufferAttribute;
  iUvRectAttr.setXYZW(slot, rect.u, rect.v, rect.w, rect.h);

  // iFlip defaults to 0 (normal) — flip is managed externally by the
  // camera-orient system when it calls back to rewrite iFlip per-frame.
  const iFlipAttr = mesh.geometry.getAttribute('iFlip') as THREE.InstancedBufferAttribute;
  iFlipAttr.setX(slot, 0);
}
