// scene/instanced/adPanelsInstanced.ts — Instanced ad panels for media
// buildings. A single InstancedMesh backed by a DataArrayTexture (one
// layer per media file). Each media building gets 4 panel slots, one
// per face (S/N/E/W).
//
// Picking: ad panels are NOT pickable. Per-instance userData isn't
// supported by Three.js raycasting without a custom implementation;
// adding it would restore click-to-select on media buildings.
//
// LOD gating: panels are always visible. Tying visibility to LOD tier is
// possible now that the LOD evaluator exists; currently always-on.
//
// WebGL2 requirement: the underlying DataArrayTexture + GLSL3 shader
// require WebGL2.

import * as THREE from 'three';
import { BuildingOrient } from '@/types/index.js';
import { AD_PANEL, BLOOM, BUILDING_DIMENSIONS } from '@/config/index.js';
import { mediaKindOf } from '../adPanels.js';
import { AdPanelTextureArray } from './adPanelTextureArray.js';
import type { Building } from '@/types/index.js';

import adPanelVertSrc from '../shaders/adPanel.vert.glsl?raw';
import adPanelFragSrc from '../shaders/adPanel.frag.glsl?raw';

// ---------------------------------------------------------------------------
// Face layout helpers — ported from adPanels.ts (orientToYRotation).
// 4 faces per building; each face is one InstancedMesh slot.
// ---------------------------------------------------------------------------

/** Map BuildingOrient → Y-axis rotation so the panel faces away from the building. */
function orientToYRotation(orient: BuildingOrient): number {
  switch (orient) {
    case BuildingOrient.South: return 0;
    case BuildingOrient.North: return Math.PI;
    case BuildingOrient.East:  return Math.PI / 2;
    case BuildingOrient.West:  return -Math.PI / 2;
    default: return 0;
  }
}

const PANEL_ORIENTS: BuildingOrient[] = [
  BuildingOrient.South,
  BuildingOrient.North,
  BuildingOrient.East,
  BuildingOrient.West,
];

// ---------------------------------------------------------------------------
// InstancedAdPanels
// ---------------------------------------------------------------------------

export interface AdPanelRegistration {
  /** DataArrayTexture layer index allocated for this building's image. */
  layer: number;
  /**
   * Four InstancedMesh slot indices (one per face, in PANEL_ORIENTS order:
   * South, North, East, West).
   */
  panelSlots: number[];
}

export class InstancedAdPanels {
  /** The instanced mesh — add this to the scene. */
  readonly mesh: THREE.InstancedMesh;

  private readonly _texArray: AdPanelTextureArray;
  private readonly _capacity: number;
  private _nextSlot = 0;

  // Per-instance attribute arrays (raw typed arrays for direct write).
  private readonly _iLayerIndex: Float32Array;
  private readonly _iColor: Float32Array;
  private readonly _iTextureFade: Float32Array;

  constructor(mediaFileCapacity: number) {
    this._capacity = mediaFileCapacity;
    // 4 faces per media building → total slot count.
    const slotCount = mediaFileCapacity * 4;

    this._texArray = new AdPanelTextureArray(Math.max(1, mediaFileCapacity));

    // Shared quad geometry — unit plane in XY (same as PlaneGeometry(1,1)).
    // Each instance is positioned/rotated/scaled via instanceMatrix.
    const geo = new THREE.PlaneGeometry(1, 1);

    // Material — GLSL3 required for sampler2DArray.
    const bloomCfg = BLOOM.get();
    const adEmission = bloomCfg.ENABLED ? bloomCfg.AD_EMISSION : 1.0;
    const placeholderHex = AD_PANEL.get().AD_PLACEHOLDER_COLOR;
    const placeholderColor = new THREE.Color(placeholderHex).multiplyScalar(adEmission);

    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uPanelArray: { value: this._texArray.texture },
      },
      vertexShader: adPanelVertSrc,
      fragmentShader: adPanelFragSrc,
      transparent: true,
      depthWrite: false,
      // DoubleSide so panels stay visible through the edge-on transition
      // when the camera rotates: with FrontSide, floating-point precision
      // in the winding-order check can flip a panel from front-facing to
      // back-facing slightly before it's actually edge-on in screen space,
      // making it pop out of view at angles where it should still be a
      // (very thin) visible sliver. At true edge-on the panel has zero
      // pixel area regardless of side, so DoubleSide costs essentially
      // nothing while eliminating the pop.
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, slotCount);
    this.mesh.count = 0; // grow as panels are registered
    this.mesh.userData.meshKind = 'adPanel';
    // Ad panels are NOT pickable in cell mode — see file header.
    this.mesh.raycast = () => {};
    // Disable Three.js frustum culling for this InstancedMesh: the
    // built-in cull uses the *geometry's* bounding sphere (a tiny
    // unit-plane sphere at origin) and ignores per-instance transforms.
    // When the camera rotates so origin is outside the view, Three.js
    // culls the whole mesh — making ad panels disappear even when
    // their world-space positions are still on-screen. Per-instance
    // frustum testing would be the principled fix, but slotCount is
    // bounded (≤1024 in typical usage) so always-draw is cheap and
    // correct.
    this.mesh.frustumCulled = false;
    // Force ad panels to render AFTER buildings in the transparent pass.
    // Both buildings and ad-panels are transparent: true, so they sort by
    // distance to camera. The ad-panel mesh's bounding sphere lives at
    // world origin (we never set mesh.position — instance transforms
    // live in instanceMatrix), so it sorts as if it's at (0,0,0). For
    // any building far from origin (i.e., everywhere in practice), the
    // panel mesh appears FARTHER from the camera than the cell building
    // mesh, so back-to-front sort renders ad panels FIRST. Then the
    // building (with depthWrite:true) overwrites those panel pixels —
    // making panels invisible on the camera-facing walls. renderOrder
    // bumps the panel mesh into a later sort bucket so it always draws
    // on top; polygonOffset on the material then keeps the panel
    // correctly anchored to its wall.
    this.mesh.renderOrder = 1;

    // Pre-allocate per-instance attribute arrays.
    this._iLayerIndex = new Float32Array(slotCount);       // 1 float per slot
    this._iColor      = new Float32Array(slotCount * 3);   // vec3 per slot
    this._iTextureFade = new Float32Array(slotCount);      // 1 float per slot

    // Initialize iColor to placeholder and iTextureFade to 0 (no texture yet).
    for (let i = 0; i < slotCount; i++) {
      this._iColor[i * 3 + 0] = placeholderColor.r;
      this._iColor[i * 3 + 1] = placeholderColor.g;
      this._iColor[i * 3 + 2] = placeholderColor.b;
      this._iTextureFade[i] = 0.0;
    }

    // Attach as InstancedBufferAttributes so they feed the vertex shader.
    geo.setAttribute(
      'iLayerIndex',
      new THREE.InstancedBufferAttribute(this._iLayerIndex, 1),
    );
    geo.setAttribute(
      'iColor',
      new THREE.InstancedBufferAttribute(this._iColor, 3),
    );
    geo.setAttribute(
      'iTextureFade',
      new THREE.InstancedBufferAttribute(this._iTextureFade, 1),
    );

    // Hide all instances initially via scale-zero matrices.
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < slotCount; i++) {
      this.mesh.setMatrixAt(i, zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Register a media building: allocate a texture layer and 4 panel slots,
   * compute the face matrices from building dimensions, and write them.
   *
   * Returns null when capacity is exhausted (silently skipped — building
   * shows no instanced ad panel rather than crashing).
   */
  registerMediaBuilding(b: Building): AdPanelRegistration | null {
    const kind = mediaKindOf(b.file);
    if (!kind) return null;

    // Overflow check — 4 slots per building.
    if (this._nextSlot + 4 > this._capacity * 4) {
      console.warn('[adPanelsInstanced] slot capacity exhausted for', b.file?.path);
      return null;
    }

    const layer = this._texArray.allocate();
    if (layer < 0) {
      console.warn('[adPanelsInstanced] texture layer capacity exhausted for', b.file?.path);
      return null;
    }

    const cfg = AD_PANEL.get();
    const dims = BUILDING_DIMENSIONS.get();

    // Aspect ratio: clamp degenerate or missing metadata to a square.
    const mw = b.file.media_width;
    const mh = b.file.media_height;
    const rawAspect = mw && mh && mw > 0 ? mh / mw : 1.0;
    const aspect = Math.min(2.5, Math.max(0.4, rawAspect));

    const adWidth  = Math.max(0.1, b.w * (1 - 2 * cfg.AD_SIDE_MARGIN_FRAC));
    const adHeight = adWidth * aspect;
    const bottomY  = cfg.AD_BOTTOM_OFFSET_FLOORS * dims.FLOOR_HEIGHT;
    const centerY  = bottomY + adHeight / 2;

    const dHalf = b.d / 2;
    const wHalf = b.w / 2;

    const panelSlots: number[] = [];

    for (const orient of PANEL_ORIENTS) {
      const slot = this._nextSlot++;
      panelSlots.push(slot);

      const angle = orientToYRotation(orient);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const halfExtent = (orient === BuildingOrient.South || orient === BuildingOrient.North)
        ? dHalf
        : wHalf;
      const zOffset = halfExtent + cfg.AD_OFFSET;
      const worldX = b.x + sin * zOffset;
      const worldZ = b.y + cos * zOffset;

      // Build instance matrix: translate to face center, rotate about Y, scale to ad dimensions.
      const m = new THREE.Matrix4();
      m.makeRotationY(angle);
      // Apply scale first via a separate matrix, then multiply.
      const scale = new THREE.Matrix4().makeScale(adWidth, adHeight, 1);
      m.multiply(scale);
      m.setPosition(worldX, centerY, worldZ);
      this.mesh.setMatrixAt(slot, m);

      // Layer index — same for all 4 faces of this building.
      this._iLayerIndex[slot] = layer;

      // iColor is already set to placeholder in constructor; no-op here.
    }

    // Extend the visible count to include the newly written slots.
    this.mesh.count = Math.max(this.mesh.count, this._nextSlot);
    this.mesh.instanceMatrix.needsUpdate = true;

    // Mark attribute buffers dirty so the GPU sees the new layer indices.
    const geo = this.mesh.geometry as THREE.BufferGeometry;
    (geo.getAttribute('iLayerIndex') as THREE.InstancedBufferAttribute).needsUpdate = true;

    return { layer, panelSlots };
  }

  /**
   * Upload a media image to the given texture layer and animate iTextureFade
   * from 0 to 1 for the given panel slots.
   *
   * The upload is async (canvas readback), but the fade step is synchronous
   * after upload completes. No animation framework is used — a single frame
   * jump from 0→1 is acceptable; a full tween can be added in a future pass.
   */
  async loadTextureForBuilding(
    layer: number,
    panelSlots: number[],
    img: HTMLImageElement,
  ): Promise<void> {
    await this._texArray.uploadImage(layer, img);
    // Snap fade to 1.0 on all 4 faces.
    for (const slot of panelSlots) {
      this._iTextureFade[slot] = 1.0;
    }
    const geo = this.mesh.geometry as THREE.BufferGeometry;
    (geo.getAttribute('iTextureFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /**
   * Upload a video poster canvas to the given texture layer, then fade in.
   * Same semantics as loadTextureForBuilding but accepts a canvas (for
   * the video first-frame path that uses HTMLCanvasElement as the source).
   */
  async loadCanvasForBuilding(
    layer: number,
    panelSlots: number[],
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    await this._texArray.uploadCanvas(layer, canvas);
    for (const slot of panelSlots) {
      this._iTextureFade[slot] = 1.0;
    }
    const geo = this.mesh.geometry as THREE.BufferGeometry;
    (geo.getAttribute('iTextureFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this._texArray.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

// ---------------------------------------------------------------------------
// Async media loading. Accepts a Building, fires
// loadTextureForBuilding / loadCanvasForBuilding once the image or video
// first-frame is ready.
// ---------------------------------------------------------------------------

/**
 * Trigger async load of a media building's image/video and upload to the
 * given InstancedAdPanels instance once ready. URL scheme:
 * `/api/file?path=<urlEncoded fullPath>`.
 */
export function asyncLoadMediaForBuilding(
  ads: InstancedAdPanels,
  b: Building,
  layer: number,
  panelSlots: number[],
): void {
  const kind = mediaKindOf(b.file);
  if (!kind) return;

  const filePath = b.file.fullPath || b.file.path || '';
  const url = `/api/file?path=${encodeURIComponent(filePath)}`;

  if (kind === 'image') {
    const img = new Image();
    img.onload = () => {
      ads.loadTextureForBuilding(layer, panelSlots, img).catch(() => {
        /* keep placeholder — no crash */
      });
    };
    img.onerror = () => { /* keep placeholder */ };
    img.src = url;
  } else {
    // Video: render first frame to a canvas, then upload the canvas.
    _loadVideoPoster(url).then((canvas) => {
      if (!canvas) return;
      ads.loadCanvasForBuilding(layer, panelSlots, canvas).catch(() => {
        /* keep placeholder */
      });
    }).catch(() => { /* keep placeholder */ });
  }
}

// ---------------------------------------------------------------------------
// Video first-frame extraction — same logic as adPanels.ts:_loadVideoPosterTexture
// but returns a canvas instead of a THREE.Texture (uploadCanvas handles the rest).
// ---------------------------------------------------------------------------

function _loadVideoPoster(url: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    let resolved = false;
    const settle = (result: HTMLCanvasElement | null) => {
      if (resolved) return;
      resolved = true;
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    const onReady = () => {
      try {
        const canvas = document.createElement('canvas');
        const w = video.videoWidth || 512;
        const h = video.videoHeight || 512;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { settle(null); return; }
        ctx.drawImage(video, 0, 0, w, h);
        _drawPlayOverlay(ctx, w, h);
        settle(canvas);
      } catch {
        settle(null);
      }
    };

    video.addEventListener('loadeddata', () => {
      video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
    });
    video.addEventListener('seeked', onReady);
    video.addEventListener('error', () => settle(null));
    setTimeout(() => settle(null), 8000);
  });
}

function _drawPlayOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.18;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  const triR = radius * 0.55;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx + triR, cy);
  ctx.lineTo(cx - triR * 0.55, cy - triR * 0.85);
  ctx.lineTo(cx - triR * 0.55, cy + triR * 0.85);
  ctx.closePath();
  ctx.fill();
}
