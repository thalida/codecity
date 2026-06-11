// city/components/buildings/adPanels.ts — Instanced ad panels for media
// buildings. A single InstancedMesh backed by a DataArrayTexture (one
// layer per media file). Each media building gets 4 panel slots, one
// per face (S/N/E/W).
//
// Picking: ad panels are NOT pickable. Per-instance userData isn't
// supported by Three.js raycasting without a custom implementation;
// adding it would restore click-to-select on media buildings.
//
// WebGL2 requirement: the underlying DataArrayTexture + GLSL3 shader
// require WebGL2.

import * as THREE from 'three';
import { BuildingOrient } from '@/types/index';
import { FACADE } from '@/state/stores/settings/facade';
import { BLOOM } from '@/state/stores/settings/effects';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { AD_ERROR_COLOR } from '@/constants/buildings';
import { RENDER_ORDERS } from '@/city/renderOrders';
import { mediaKindOf, MediaKind } from '@/city/utils/mediaKind';
import { AdPanelTextureArray, MAX_PAGES as AD_PANEL_MAX_PAGES } from './adPanelTextureArray';
import type { Building } from '@/types/index';

import adPanelVertSrc from './adPanel.vert.glsl?raw';
import adPanelFragSrc from './adPanel.frag.glsl?raw';

// World-unit z-offset from the building's front face. depthWrite:false on
// the panel material means polygonOffset has no effect, so this is the only
// thing keeping the panel quad from co-planar z-fighting with the building
// face. Tuned to clear typical 8–96 unit-wide buildings at oblique angles.
const AD_FRONT_FACE_OFFSET = 1.5;

// ---------------------------------------------------------------------------
// Face layout helpers — ported from the per-building ad-panel renderer
// (retired in the #21 cell-render rollout). 4 faces per building; each
// face is one InstancedMesh slot.
// ---------------------------------------------------------------------------

/** Map BuildingOrient → Y-axis rotation so the panel faces away from the building. */
function orientToYRotation(orient: BuildingOrient): number {
  switch (orient) {
    case BuildingOrient.South:
      return 0;
    case BuildingOrient.North:
      return Math.PI;
    case BuildingOrient.East:
      return Math.PI / 2;
    case BuildingOrient.West:
      return -Math.PI / 2;
    default:
      return 0;
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
  // Tracks dispose() — async load tasks that started before dispose
  // but completed after (very likely during a skeleton→final or live-
  // update rebuild) check this before touching iTextureFade so they
  // don't clobber the new InstancedAdPanels' slot state.
  private _disposed = false;

  // Per-instance attribute arrays (raw typed arrays for direct write).
  private readonly _iLayerIndex: Float32Array;
  private readonly _iColor: Float32Array;
  private readonly _iTextureFade: Float32Array;
  // Per-instance opacity multiplier, driven by buildingFader so an ad
  // panel fades down in lockstep with its underlying building body when
  // the selection cascade demotes that building to Level 1-4 tiers.
  private readonly _iBuildingFade: Float32Array;
  // Plain AD_ERROR_COLOR (no emission bake) — emission is applied uniformly
  // via uEmissionBoost in the shader. Cached so markBuildingErrored doesn't
  // have to reparse the hex string on every error call.
  private readonly _errorColor!: THREE.Color;
  // Shader material reference — held so refresh() can update uniforms live.
  private readonly _material!: THREE.ShaderMaterial;
  // file.path → 4 panel slot indices for that building. Populated by
  // registerMediaBuilding and consumed by applyBuildingFades so the
  // fader doesn't need to know the slot layout.
  private readonly _buildingSlotsByPath = new Map<string, number[]>();

  constructor(mediaFileCapacity: number) {
    this._capacity = mediaFileCapacity;
    // 4 faces per media building → total slot count.
    const slotCount = mediaFileCapacity * 4;

    this._texArray = new AdPanelTextureArray(Math.max(1, mediaFileCapacity));

    // Shared quad geometry — unit plane in XY (same as PlaneGeometry(1,1)).
    // Each instance is positioned/rotated/scaled via instanceMatrix.
    const geo = new THREE.PlaneGeometry(1, 1);

    // Material — GLSL3 required for sampler2DArray.
    const adCfg = FACADE.value;
    const placeholderColor = new THREE.Color(adCfg.AD_PLACEHOLDER_COLOR);
    // Cached for markBuildingErrored — recolors a panel slot's iColor
    // when its image load/decode/upload fails permanently. Stored without
    // emission multiply; uEmissionBoost in the shader applies uniformly to
    // both placeholder and error colors so brightness stays consistent.
    this._errorColor = new THREE.Color(AD_ERROR_COLOR);

    const bloomCfg = BLOOM.value;
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      // AD_PANEL_MAX_PAGES injected as a shader #define so the
      // sampler-array size + branch chain in the fragment shader stay
      // in lockstep with the JS-side MAX_PAGES constant.
      defines: {
        AD_PANEL_MAX_PAGES,
      },
      uniforms: {
        // Sampler array — one DataArrayTexture per page. Padded to
        // MAX_PAGES so the declared shader uniform always has every
        // slot bound; unused slots reuse page 0 (never sampled because
        // iLayerIndex stays within capacity).
        uPanelArrays: { value: this._texArray.shaderTextures },
        // Layers per page (hardware MAX_ARRAY_TEXTURE_LAYERS). The
        // shader uses it to split iLayerIndex into (page, localLayer).
        uPageSize: { value: this._texArray.pageSize },
        // Emission boost — multiplied onto the final fragment color so
        // both placeholder/error colors and loaded textures share the
        // same emission scaling. Initialised from BLOOM config; updated
        // live via refresh() when the user moves the AD_EMISSION slider.
        uEmissionBoost: { value: bloomCfg.ENABLED ? bloomCfg.AD_EMISSION : 1.0 },
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

    this._material = mat;
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
    // Force ad panels to render AFTER buildings AND street labels in the
    // transparent pass. Buildings, street labels and ad panels are all
    // transparent: true, so they sort by renderOrder first and distance
    // to camera second. The ad-panel mesh's bounding sphere lives at
    // world origin (we never set mesh.position — instance transforms
    // live in instanceMatrix), so it sorts as if it's at (0,0,0). For
    // any building far from origin (i.e., everywhere in practice), the
    // panel mesh appears FARTHER from the camera than the cell building
    // mesh, so back-to-front sort would render ad panels FIRST. Then
    // the building (with depthWrite:true) would overwrite those panel
    // pixels — making panels invisible on the camera-facing walls.
    // renderOrder bumps the panel mesh into a later sort bucket so it
    // always draws on top; polygonOffset on the material then keeps
    // the panel correctly anchored to its wall. AD_PANEL must also
    // out-rank STREET_LABEL — both have depthWrite:false, and the
    // panel hangs out past its wall by AD_FRONT_FACE_OFFSET, so without the bump
    // the road-name plane wins the painter sort and bleeds through the
    // panel's overhang.
    this.mesh.renderOrder = RENDER_ORDERS.AD_PANEL;

    // Pre-allocate per-instance attribute arrays.
    this._iLayerIndex = new Float32Array(slotCount); // 1 float per slot
    this._iColor = new Float32Array(slotCount * 3); // vec3 per slot
    this._iTextureFade = new Float32Array(slotCount); // 1 float per slot
    this._iBuildingFade = new Float32Array(slotCount); // 1 float per slot

    // Initialize iColor to placeholder, iTextureFade to 0 (no texture yet),
    // and iBuildingFade to 1.0 (no fade until buildingFader writes a tier).
    for (let i = 0; i < slotCount; i++) {
      this._iColor[i * 3 + 0] = placeholderColor.r;
      this._iColor[i * 3 + 1] = placeholderColor.g;
      this._iColor[i * 3 + 2] = placeholderColor.b;
      this._iTextureFade[i] = 0.0;
      this._iBuildingFade[i] = 1.0;
    }

    // Attach as InstancedBufferAttributes so they feed the vertex shader.
    geo.setAttribute('iLayerIndex', new THREE.InstancedBufferAttribute(this._iLayerIndex, 1));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this._iColor, 3));
    geo.setAttribute('iTextureFade', new THREE.InstancedBufferAttribute(this._iTextureFade, 1));
    geo.setAttribute('iBuildingFade', new THREE.InstancedBufferAttribute(this._iBuildingFade, 1));

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
      console.warn('[adPanels] slot capacity exhausted for', b.file?.path);
      return null;
    }

    const layer = this._texArray.allocate();
    if (layer < 0) {
      console.warn('[adPanels] texture layer capacity exhausted for', b.file?.path);
      return null;
    }

    const cfg = FACADE.value;
    const dims = BUILDING_DIMENSIONS.value;

    // Aspect ratio: clamp degenerate or missing metadata to a square.
    const mw = b.file.media_width;
    const mh = b.file.media_height;
    const rawAspect = mw && mh && mw > 0 ? mh / mw : 1.0;
    const aspect = Math.min(2.5, Math.max(0.4, rawAspect));

    const adWidth = Math.max(0.1, b.w * (1 - 2 * cfg.AD_SIDE_MARGIN_FRAC));
    const adHeight = adWidth * aspect;
    const bottomY = cfg.AD_BOTTOM_OFFSET_FLOORS * dims.FLOOR_HEIGHT;
    const centerY = bottomY + adHeight / 2;

    const dHalf = b.d / 2;
    const wHalf = b.w / 2;

    const panelSlots: number[] = [];

    for (const orient of PANEL_ORIENTS) {
      const slot = this._nextSlot++;
      panelSlots.push(slot);

      const angle = orientToYRotation(orient);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const halfExtent =
        orient === BuildingOrient.South || orient === BuildingOrient.North ? dHalf : wHalf;
      // Z-offset from the building face. depthWrite:false means the panel
      // would z-fight with the wall at coplanar; this lifts it off. Promoted
      // from a config key (was AD_PANEL.AD_OFFSET).
      const zOffset = halfExtent + AD_FRONT_FACE_OFFSET;
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

    // Remember which 4 slots back this building, keyed on file.path so
    // buildingFader can look the slots up by FileNode.path during its
    // selection-cascade sweep without having to thread the mapping
    // through cellAssembly.
    const key = b.file?.path;
    if (key != null) this._buildingSlotsByPath.set(key, panelSlots.slice());

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
    img: HTMLImageElement
  ): Promise<void> {
    const ok = await this._texArray.uploadImage(layer, img);
    // _disposed: whole mesh is being torn down (skeleton→final or live
    // update rebuild) — bail without touching any per-instance state.
    if (this._disposed) return;
    // !ok: upload genuinely failed (renderer never registered within
    // the wait timeout, etc.). Tint the slots with the sticky error
    // color rather than ramping the fade — sampling an unwritten
    // texture layer with iTextureFade=1 would produce fully
    // transparent fragments ("ad missing").
    if (!ok) {
      this.markBuildingErrored(panelSlots);
      return;
    }
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
    canvas: HTMLCanvasElement
  ): Promise<void> {
    const ok = await this._texArray.uploadCanvas(layer, canvas);
    if (this._disposed) return;
    if (!ok) {
      this.markBuildingErrored(panelSlots);
      return;
    }
    for (const slot of panelSlots) {
      this._iTextureFade[slot] = 1.0;
    }
    const geo = this.mesh.geometry as THREE.BufferGeometry;
    (geo.getAttribute('iTextureFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /**
   * Push a per-building opacity multiplier onto every ad panel for which
   * `getFade` returns a value. Used by buildingFader so an ad panel fades
   * to the same opacity as its underlying building body during a selection
   * cascade — a Level-1 building's panel drops to LEVEL1_BODY_OPACITY in
   * lockstep, not full brightness.
   *
   * `getFade(path)` returning `null` (or undefined) leaves that building's
   * slots untouched, so the fader can skip non-tier'd files without
   * clobbering the constructor's 1.0 default.
   */
  applyBuildingFades(getFade: (filePath: string) => number | null | undefined): void {
    let dirty = false;
    for (const [path, slots] of this._buildingSlotsByPath) {
      const fade = getFade(path);
      if (fade == null) continue;
      for (const slot of slots) {
        if (this._iBuildingFade[slot] !== fade) {
          this._iBuildingFade[slot] = fade;
          dirty = true;
        }
      }
    }
    if (dirty) {
      const geo = this.mesh.geometry as THREE.BufferGeometry;
      (geo.getAttribute('iBuildingFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  /**
   * Recolor a building's 4 panel slots to the AD_ERROR_COLOR tint. Called
   * by asyncLoadMediaForBuilding when the fetch / decode / upload chain
   * fails permanently. iTextureFade stays at 0 so the shader keeps
   * showing the per-instance color (now error red) instead of sampling
   * the unwritten texture layer; the visual distinction from the
   * loading-state placeholder color is what tells the user "this one
   * isn't coming back" vs "still waiting".
   */
  markBuildingErrored(panelSlots: number[]): void {
    for (const slot of panelSlots) {
      this._iColor[slot * 3 + 0] = this._errorColor.r;
      this._iColor[slot * 3 + 1] = this._errorColor.g;
      this._iColor[slot * 3 + 2] = this._errorColor.b;
    }
    const geo = this.mesh.geometry as THREE.BufferGeometry;
    (geo.getAttribute('iColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /**
   * Hot-reload emission from the current BLOOM config. Called by
   * applyTheme() whenever the user changes the AD_EMISSION slider so
   * the uniform updates without a full scene rebuild.
   */
  refresh(): void {
    const bloomCfg = BLOOM.value;
    this._material.uniforms.uEmissionBoost.value = bloomCfg.ENABLED ? bloomCfg.AD_EMISSION : 1.0;
  }

  dispose(): void {
    this._disposed = true;
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
//
// Concurrency: requests funnel through a fixed-size semaphore (see
// MAX_CONCURRENT_LOADS). Without this, a media-heavy repo (Infisical:
// 2.6k images) would fire 2.6k <img>.src=... at once and:
//   - exhaust the browser's per-origin HTTP/1.1 connection pool (default
//     6), queueing the rest behind it. Queued requests often time out
//     before they ever get a chance to start, so a large fraction of
//     buildings end up stuck on the placeholder color.
//   - starve any other codecity tab in the same browser process for GPU
//     time during the burst of texSubImage3D uploads that follows decode.
// 4 concurrent slots is comfortably under the HTTP/1.1 pool size, paces
// GPU uploads, and keeps the main thread responsive for other tabs.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_LOADS = 4;
let _inFlight = 0;
const _pendingTasks: Array<() => void> = [];

function _acquireSlot(): Promise<void> {
  if (_inFlight < MAX_CONCURRENT_LOADS) {
    _inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    _pendingTasks.push(() => {
      _inFlight++;
      resolve();
    });
  });
}

function _releaseSlot(): void {
  _inFlight--;
  const next = _pendingTasks.shift();
  if (next) next();
}

/**
 * Trigger async load of a media building's image/video and upload to the
 * given InstancedAdPanels instance once ready. URL scheme:
 * `/api/file?path=<urlEncoded fullPath>`. Funneled through a concurrency
 * semaphore so a media-heavy repo doesn't overwhelm the browser's
 * connection pool or GPU upload queue (see file header comment).
 */
export function asyncLoadMediaForBuilding(
  ads: InstancedAdPanels,
  b: Building,
  layer: number,
  panelSlots: number[]
): void {
  const kind = mediaKindOf(b.file);
  if (!kind) return;

  const filePath = b.file.fullPath || b.file.path || '';
  const url = `/api/file?path=${encodeURIComponent(filePath)}`;

  void (async () => {
    await _acquireSlot();
    let errored = false;
    try {
      if (kind === MediaKind.Image) {
        const img = await _loadImage(url);
        if (img === null) {
          errored = true;
        } else {
          await ads.loadTextureForBuilding(layer, panelSlots, img);
        }
      } else {
        const canvas = await _loadVideoPoster(url);
        if (canvas === null) {
          errored = true;
        } else {
          await ads.loadCanvasForBuilding(layer, panelSlots, canvas);
        }
      }
    } catch {
      // Decode-time / upload-time failure (post-fetch) — still an
      // error from the user's perspective, so flag it for the
      // distinct error tint instead of leaving the loading-state
      // placeholder visible forever.
      errored = true;
    } finally {
      if (errored) ads.markBuildingErrored(panelSlots);
      _releaseSlot();
    }
  })();
}

/** Promise-wrapped HTMLImageElement load. Resolves with the loaded image
 *  on success, or null on load failure (so the caller can `if (img !== null)`
 *  without a try/catch wrap). */
function _loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Video first-frame extraction — ported from the per-building ad-panel
// renderer (retired in #21), but returns a canvas instead of a
// THREE.Texture (uploadCanvas handles the rest).
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
        if (!ctx) {
          settle(null);
          return;
        }
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

// "▶" play-button overlay drawn on top of the first-frame poster of a
// video so the user reads it as "this is a video, click to interact"
// at thumbnail scale. Numbers below are visual-feel constants picked
// by eye — comments call out what each fraction controls.
//
// CIRCLE_RADIUS_FRAC:    bg circle radius as a fraction of the shorter
//                         canvas dim. 18% reads at thumbnail scale
//                         without crowding the corners.
// CIRCLE_FILL:           translucent black so the play icon stays
//                         readable over any underlying frame.
// TRI_RADIUS_FRAC:       triangle "radius" (apex-to-base distance) as a
//                         fraction of the bg circle radius. 55% leaves
//                         a thin halo of black around the white tri.
// TRI_BASE_HALF_FRAC:    half-width of the triangle's base as a
//                         fraction of TRI_RADIUS, also 55% — produces a
//                         roughly equilateral wedge that reads as a
//                         play icon at any DPI.
// TRI_HEIGHT_FRAC:       half-height of the triangle's base. 85% keeps
//                         the base proportions matching a standard
//                         play-button glyph.
const CIRCLE_RADIUS_FRAC = 0.18;
const CIRCLE_FILL = 'rgba(0, 0, 0, 0.55)';
const TRI_RADIUS_FRAC = 0.55;
const TRI_BASE_HALF_FRAC = 0.55;
const TRI_HEIGHT_FRAC = 0.85;

function _drawPlayOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * CIRCLE_RADIUS_FRAC;

  ctx.fillStyle = CIRCLE_FILL;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  const triR = radius * TRI_RADIUS_FRAC;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx + triR, cy);
  ctx.lineTo(cx - triR * TRI_BASE_HALF_FRAC, cy - triR * TRI_HEIGHT_FRAC);
  ctx.lineTo(cx - triR * TRI_BASE_HALF_FRAC, cy + triR * TRI_HEIGHT_FRAC);
  ctx.closePath();
  ctx.fill();
}
