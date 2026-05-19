// scene/instanced/labels.ts — Per-block label InstancedMesh + atlas builder.
//
// The atlas builder has been extracted into labelAtlas.ts for reuse
// by the cell-aware factory (labelsCell.ts). This file re-exports the
// public types + buildLabelAtlas from that module for backward
// compatibility, then adds the per-block mesh assembly logic.
import * as THREE from 'three';
import type { LabelTypographyConfig } from '@/config/index.js';
import { LABEL_TYPOGRAPHY } from '@/config/index.js';
import { RENDER_ORDERS } from '@/constants';
import { StreetAxis } from '@/types';
import type { SceneBlock } from '../blocks.js';

import labelVertSrc from '../shaders/label.vert.glsl?raw';
import labelFragSrc from '../shaders/label.frag.glsl?raw';

// Re-export shared atlas types + builder from the extracted module.
export type { LabelAtlasRect, LabelAtlasResult } from './labelAtlas.js';
export { buildLabelAtlas } from './labelAtlas.js';
// Local import for use in function parameter types below.
import type { LabelAtlasResult } from './labelAtlas.js';

/**
 * Truncate a label so it fits on its street.
 *
 * Labels are rendered at a height of `street.width * HEIGHT_FRAC` world
 * units; canvas height is `FONT_SIZE_PX + 2 * padding` pixels, where
 * `padding = round(FONT_SIZE_PX * CANVAS_PADDING_FRAC)`.
 * That ratio gives world-units-per-canvas-pixel, which we use to compute
 * the maximum canvas-pixel width that fits in `street.length * 0.9`
 * world units. If the full label exceeds that, we trim characters off
 * the end and append an ellipsis until it fits.
 *
 * Caller passes a 2D canvas context whose font has already been set to
 * the label typography spec (one ctx is reused across all blocks per
 * scene build to amortize the cost).
 *
 * Returns the original text if it already fits, the longest "<prefix>…"
 * that fits otherwise, or just "…" if even that doesn't fit.
 */
export function truncateLabelToFit(
  text: string,
  street: { length: number; width: number },
  typography: LabelTypographyConfig,
  measureCtx: CanvasRenderingContext2D,
): string {
  if (!text) return text;
  const paddingPx = Math.round(typography.FONT_SIZE_PX * typography.CANVAS_PADDING_FRAC);
  const labelHeightPx = typography.FONT_SIZE_PX + 2 * paddingPx;
  const worldPerCanvasPx =
    (street.width * typography.HEIGHT_FRAC) / labelHeightPx;
  if (worldPerCanvasPx <= 0) return text;
  const maxCanvasWidthPx = (street.length * 0.9) / worldPerCanvasPx;
  if (maxCanvasWidthPx <= 0) return text;
  const measure = (s: string): number =>
    measureCtx.measureText(s).width + 2 * paddingPx;
  if (measure(text) <= maxCanvasWidthPx) return text;

  const ellipsis = '…';
  // Linear search from longest to shortest. Labels are short; binary
  // search would be premature.
  for (let len = text.length - 1; len > 0; len--) {
    const candidate = text.slice(0, len) + ellipsis;
    if (measure(candidate) <= maxCanvasWidthPx) return candidate;
  }
  return ellipsis;
}

// ---------------------------------------------------------------------------
// Shared geometry + material for label InstancedMeshes.
// ---------------------------------------------------------------------------

// Unit plane in the XY plane. Each instance positions and scales this quad
// via instanceMatrix to produce the correctly-sized, correctly-positioned label.
const _SHARED_LABEL_GEOMETRY = new THREE.PlaneGeometry(1, 1);

// One ShaderMaterial per atlas texture (= per atlas page). Cached by the
// CanvasTexture identity. cityScene owns the textures' lifetime; when it
// disposes them it should also call disposeLabelMaterials() to evict.
const _labelMaterials = new Map<THREE.CanvasTexture, THREE.ShaderMaterial>();

function getLabelMaterial(atlasTexture: THREE.CanvasTexture): THREE.ShaderMaterial {
  const cached = _labelMaterials.get(atlasTexture);
  if (cached) return cached;
  const mat = new THREE.ShaderMaterial({
    vertexShader: labelVertSrc,
    fragmentShader: labelFragSrc,
    uniforms: {
      uMap: { value: atlasTexture },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  _labelMaterials.set(atlasTexture, mat);
  return mat;
}

export function disposeLabelMaterials(): void {
  for (const mat of _labelMaterials.values()) mat.dispose();
  _labelMaterials.clear();
}

/**
 * Build per-instance attribute buffers for a block's labels.
 *
 * Each label is a separate instance of a unit PlaneGeometry.
 * The instance matrix encodes: world position, Y-axis orientation rotation,
 * and scale (worldW × worldH).
 *
 * Returns null if the block's street has no label text.
 */
export interface LabelInstanceBuffer {
  count: number;
  matrices: Float32Array; // count × 16
  uvRects: Float32Array;  // count × 4 (u, v, w, h)
  flips: Float32Array;    // count × 1 (0 or 1)
}

export function buildLabelInstanceBuffer(
  block: SceneBlock,
  atlas: LabelAtlasResult,
): LabelInstanceBuffer | null {
  const street = block.primaryStreet;
  const text = street.label || '';
  if (!text) return null;

  const rect = atlas.rectByText.get(text);
  if (!rect) return null;

  const label = LABEL_TYPOGRAPHY.get();

  // Label sizing scales with street width — but the rendered plane must
  // also fit the street's length, otherwise long directory names overflow
  // off the road and clip into adjacent blocks. Cap worldW at 90% of
  // street.length and shrink worldH proportionally to preserve aspect.
  const baseH = street.width * label.HEIGHT_FRAC;
  const baseW = baseH * rect.aspect;
  const maxW = street.length * 0.9;
  let worldH: number;
  let worldW: number;
  if (baseW > maxW && rect.aspect > 0) {
    worldW = maxW;
    worldH = worldW / rect.aspect;
  } else {
    worldH = baseH;
    worldW = baseW;
  }

  // Repetition: spacing based on rendered width.
  const spacing = Math.max(worldW * label.SPACING_MULT, label.SPACING_FLOOR);
  const count = Math.max(1, Math.floor(street.length / spacing));

  const matrices = new Float32Array(count * 16);
  const uvRects = new Float32Array(count * 4);
  const flips = new Float32Array(count); // initially all 0

  const m = new THREE.Matrix4();
  // Base rotation: Y-orient streets need -90° rotation around Y so the
  // label's "right" axis runs along scene-Z (matching the old Group
  // rotation.y = -Math.PI/2 from engine.ts).
  const baseRotY = street.orientation === StreetAxis.Y ? -Math.PI / 2 : 0;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    const offset = (t - 0.5) * street.length;
    let sx = street.x;
    let sz = street.y;
    if (street.orientation === StreetAxis.X) sx += offset;
    else sz += offset;

    // Build matrix: scale(worldW, worldH, 1) × rotateY(baseRotY) × translate(sx, ELEVATION, sz).
    // PlaneGeometry is in the XY plane; we rotate around X by -π/2 to lay it
    // flat (same as the old engine.ts approach: plane.rotation.x = -Math.PI/2
    // inside a group). Then apply the baseRotY on top.
    //
    // Three.js matrix composition: T × Ry × Rx × S (right-to-left application)
    m.identity();
    // Scale
    m.makeScale(worldW, worldH, 1);
    // Rotate X by -π/2 to lay flat in XZ plane.
    const flatRot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.premultiply(flatRot);
    // Rotate Y for street orientation.
    if (baseRotY !== 0) {
      const yRot = new THREE.Matrix4().makeRotationY(baseRotY);
      m.premultiply(yRot);
    }
    // Translate to world position.
    m.setPosition(sx, label.ELEVATION, sz);

    matrices.set(m.toArray(), i * 16);

    // UV rect for this label (same for all instances of same text).
    uvRects[i * 4 + 0] = rect.u;
    uvRects[i * 4 + 1] = rect.v;
    uvRects[i * 4 + 2] = rect.w;
    uvRects[i * 4 + 3] = rect.h;
  }

  return { count, matrices, uvRects, flips };
}

/**
 * Create a THREE.InstancedMesh for all label instances in a block.
 *
 * - Shared geometry: PlaneGeometry(1, 1)
 * - Shared material: ShaderMaterial with uMap = atlasTexture
 * - Per-instance attributes: instanceMatrix, iUvRect (vec4), iFlip (float)
 *
 * Returns null if the block has no label text.
 *
 * mesh.userData.kind  = 'labels'
 * mesh.userData.block = block
 */
export function createLabelsInstancedMesh(
  block: SceneBlock,
  atlas: LabelAtlasResult,
  atlasTextures: THREE.CanvasTexture[],
): THREE.InstancedMesh | null {
  const buf = buildLabelInstanceBuffer(block, atlas);
  if (!buf || buf.count === 0) return null;

  const text = block.primaryStreet?.label || '';
  const rect = atlas.rectByText.get(text);
  if (!rect) return null;
  const texture = atlasTextures[rect.page];
  if (!texture) return null;
  const material = getLabelMaterial(texture);
  const mesh = new THREE.InstancedMesh(_SHARED_LABEL_GEOMETRY, material, buf.count);

  // Set instance transforms.
  const tmpM = new THREE.Matrix4();
  for (let i = 0; i < buf.count; i++) {
    tmpM.fromArray(buf.matrices, i * 16);
    mesh.setMatrixAt(i, tmpM);
  }
  mesh.instanceMatrix.needsUpdate = true;

  // Clone geometry so per-block attributes don't bleed across blocks.
  mesh.geometry = mesh.geometry.clone();
  mesh.geometry.setAttribute(
    'iUvRect',
    new THREE.InstancedBufferAttribute(buf.uvRects, 4),
  );
  mesh.geometry.setAttribute(
    'iFlip',
    new THREE.InstancedBufferAttribute(buf.flips, 1),
  );

  mesh.renderOrder = RENDER_ORDERS.STREET_LABEL;
  mesh.userData.kind = 'labels';
  mesh.userData.block = block;

  return mesh;
}
