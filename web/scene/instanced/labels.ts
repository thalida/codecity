// scene/instanced/labels.ts — Per-block label InstancedMesh + atlas builder.
import * as THREE from 'three';
import type { LabelTypographyConfig } from '@/config/index.js';
import { LABEL_TYPOGRAPHY } from '@/config/index.js';
import { RENDER_ORDERS } from '@/constants';
import { StreetAxis } from '@/types';
import type { SceneBlock } from '../blocks.js';

import labelVertSrc from '../shaders/label.vert.glsl?raw';
import labelFragSrc from '../shaders/label.frag.glsl?raw';

export interface LabelAtlasRect {
  page: number;
  u: number;
  v: number;
  w: number;
  h: number;
  aspect: number;
}

export interface LabelAtlasResult {
  pages: HTMLCanvasElement[];
  rectByText: Map<string, LabelAtlasRect>;
}

// WebGL2 guarantees MAX_TEXTURE_SIZE >= 2048; virtually all desktop GPUs
// support 8192. We pack labels into multiple pages of this size so a single
// codebase can have arbitrarily many distinct directory names.
const ATLAS_WIDTH = 8192;
const ATLAS_HEIGHT_MAX = 8192;
// Sanity bound. 16 pages of 8192×8192 = 1 GiB of texture memory if every
// page is full-bleed RGBA; in practice each page renders only the rows it
// uses, so memory tracks the actual label count. A real monorepo would
// need >2000 unique directory names to push past page 1 at default font.
const MAX_PAGES = 16;

export function buildLabelAtlas(
  uniqueTexts: string[],
  typography: LabelTypographyConfig,
): LabelAtlasResult {
  if (uniqueTexts.length === 0) {
    return { pages: [], rectByText: new Map() };
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

  // Step 2: shelf-fit pack across multiple pages. Sort by height desc; place
  // left-to-right with row wraps. When a row would overflow page height,
  // start a new page.
  items.sort((a, b) => b.h - a.h);
  type Placement = { text: string; page: number; x: number; y: number; w: number; h: number };
  const placements: Placement[] = [];
  let page = 0;
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  const pageHeights: number[] = [];

  for (const item of items) {
    // Wrap to next row when the current row is full.
    if (cursorX + item.w > ATLAS_WIDTH) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    // If the next row would overflow this page, start a new page.
    if (cursorY + item.h > ATLAS_HEIGHT_MAX) {
      pageHeights[page] = cursorY;
      page += 1;
      if (page >= MAX_PAGES) {
        throw new Error(
          `label atlas overflow: would need >${MAX_PAGES} pages of ` +
            `${ATLAS_WIDTH}x${ATLAS_HEIGHT_MAX} for ${uniqueTexts.length} unique labels.`,
        );
      }
      cursorX = 0;
      cursorY = 0;
      rowH = 0;
    }
    placements.push({ text: item.text, page, x: cursorX, y: cursorY, w: item.w, h: item.h });
    cursorX += item.w;
    rowH = Math.max(rowH, item.h);
  }
  pageHeights[page] = cursorY + rowH;

  // Step 3: paint each page into its own canvas. Trim each canvas to the
  // height actually used so we don't upload empty pixels to the GPU.
  const pages: HTMLCanvasElement[] = [];
  const pageContexts: CanvasRenderingContext2D[] = [];
  for (let p = 0; p <= page; p++) {
    const c = document.createElement('canvas');
    c.width = ATLAS_WIDTH;
    c.height = Math.max(1, pageHeights[p] ?? 1);
    const ctx = c.getContext('2d')!;
    ctx.font = fontSpec;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    pages.push(c);
    pageContexts.push(ctx);
  }

  const rectByText: LabelAtlasResult['rectByText'] = new Map();
  for (const p of placements) {
    const ctx = pageContexts[p.page];
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    ctx.lineWidth = typography.STROKE_WIDTH_PX;
    ctx.strokeStyle = typography.STROKE;
    ctx.strokeText(p.text, cx, cy);
    ctx.fillStyle = typography.FILL;
    ctx.fillText(p.text, cx, cy);
    const pageH = pages[p.page].height;
    rectByText.set(p.text, {
      page: p.page,
      u: p.x / ATLAS_WIDTH,
      // CanvasTexture defaults flipY=true, so the GPU sees the canvas
      // vertically inverted: a rect at canvas top (p.y=0) is at GL
      // texture v=1, not v=0. With a single-row atlas this didn't matter
      // (rect spanned v=0..1 either way); with multi-row atlases, rows
      // sample from the wrong band — every block read its neighbor's
      // text. Convert canvas-y → GL-v explicitly here.
      v: 1 - (p.y + p.h) / pageH,
      w: p.w / ATLAS_WIDTH,
      h: p.h / pageH,
      aspect: p.w / p.h,
    });
  }
  return { pages, rectByText };
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
