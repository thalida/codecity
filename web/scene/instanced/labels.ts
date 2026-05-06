// scene/instanced/labels.ts — Per-block label InstancedMesh + atlas builder.
import * as THREE from 'three';
import type { LabelTypographyConfig } from '@/config/index.js';
import { LABEL_TYPOGRAPHY } from '@/config/index.js';
import { RENDER_ORDERS } from '@/constants';
import { StreetAxis } from '@/types';
import type { SceneBlock } from '../blocks.js';

import labelVertSrc from '../shaders/label.vert.glsl?raw';
import labelFragSrc from '../shaders/label.frag.glsl?raw';

export interface LabelAtlasResult {
  canvas: HTMLCanvasElement;
  rectByText: Map<string, { u: number; v: number; w: number; h: number; aspect: number }>;
}

const ATLAS_WIDTH = 4096;
const ATLAS_HEIGHT_MAX = 8192;

export function buildLabelAtlas(
  uniqueTexts: string[],
  typography: LabelTypographyConfig,
): LabelAtlasResult {
  if (uniqueTexts.length === 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return { canvas, rectByText: new Map() };
  }

  // Step 1: measure each text.
  const measureCtx = document.createElement('canvas').getContext('2d')!;
  const fontSpec = `${typography.FONT_WEIGHT} ${typography.FONT_SIZE_PX}px ${typography.FONT_FAMILY}`;
  measureCtx.font = fontSpec;
  const items = uniqueTexts.map((text) => {
    const w =
      Math.ceil(measureCtx.measureText(text).width) + typography.CANVAS_PADDING_PX * 2;
    const h = typography.FONT_SIZE_PX + typography.CANVAS_PADDING_PX * 2;
    return { text, w, h };
  });

  // Step 2: shelf-fit pack. Sort by height desc; left-to-right with row wraps.
  items.sort((a, b) => b.h - a.h);
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  const placements: Array<{ text: string; x: number; y: number; w: number; h: number }> = [];
  for (const item of items) {
    if (cursorX + item.w > ATLAS_WIDTH) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    if (cursorY + item.h > ATLAS_HEIGHT_MAX) {
      throw new Error(
        `label atlas overflow at ${cursorY + item.h}px height (max ${ATLAS_HEIGHT_MAX}). ` +
          `${uniqueTexts.length} unique labels — paged atlas not yet implemented.`,
      );
    }
    placements.push({ text: item.text, x: cursorX, y: cursorY, w: item.w, h: item.h });
    cursorX += item.w;
    rowH = Math.max(rowH, item.h);
  }
  const atlasH = Math.max(1, cursorY + rowH);

  // Step 3: paint into the atlas canvas.
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = atlasH;
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontSpec;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const rectByText: LabelAtlasResult['rectByText'] = new Map();
  for (const p of placements) {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    ctx.lineWidth = typography.STROKE_WIDTH_PX;
    ctx.strokeStyle = typography.STROKE;
    ctx.strokeText(p.text, cx, cy);
    ctx.fillStyle = typography.FILL;
    ctx.fillText(p.text, cx, cy);
    rectByText.set(p.text, {
      u: p.x / ATLAS_WIDTH,
      v: p.y / atlasH,
      w: p.w / ATLAS_WIDTH,
      h: p.h / atlasH,
      aspect: p.w / p.h,
    });
  }
  return { canvas, rectByText };
}

// ---------------------------------------------------------------------------
// Shared geometry + material for label InstancedMeshes.
// ---------------------------------------------------------------------------

// Unit plane in the XY plane. Each instance positions and scales this quad
// via instanceMatrix to produce the correctly-sized, correctly-positioned label.
const _SHARED_LABEL_GEOMETRY = new THREE.PlaneGeometry(1, 1);

// Lazy singleton material. One ShaderMaterial per atlas texture.
// Since there is exactly one atlas per applyManifest call the material
// is recreated lazily whenever the atlas texture changes.
let _sharedLabelMaterial: THREE.ShaderMaterial | null = null;
let _sharedLabelTexture: THREE.CanvasTexture | null = null;

/**
 * Get (or create) the shared label ShaderMaterial, updating it if the
 * provided atlasTexture is different from the one it was last built with.
 */
function getLabelMaterial(atlasTexture: THREE.CanvasTexture): THREE.ShaderMaterial {
  if (_sharedLabelMaterial && _sharedLabelTexture === atlasTexture) {
    return _sharedLabelMaterial;
  }
  // Dispose old material if we're rebuilding (applyManifest called again).
  if (_sharedLabelMaterial) {
    _sharedLabelMaterial.dispose();
    _sharedLabelMaterial = null;
  }
  _sharedLabelTexture = atlasTexture;
  _sharedLabelMaterial = new THREE.ShaderMaterial({
    vertexShader: labelVertSrc,
    fragmentShader: labelFragSrc,
    uniforms: {
      uMap: { value: atlasTexture },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return _sharedLabelMaterial;
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

  // Label sizing scales with street width.
  const worldH = street.width * label.HEIGHT_FRAC;
  const worldW = worldH * rect.aspect;

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
  atlasTexture: THREE.CanvasTexture,
): THREE.InstancedMesh | null {
  const buf = buildLabelInstanceBuffer(block, atlas);
  if (!buf || buf.count === 0) return null;

  const material = getLabelMaterial(atlasTexture);
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
