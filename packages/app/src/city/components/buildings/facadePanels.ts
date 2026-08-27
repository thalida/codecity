// city/components/buildings/facadePanels.ts — Instanced facade panels: 4 quads
// per building (S/N/E/W) on a shared DataArrayTexture, each carrying its own
// loader (media image / binary fingerprint / font glyph / waveform) + aspect.
// Not pickable (no per-instance raycast userData). WebGL2 (DataArrayTexture + GLSL3).

import * as THREE from 'three';
import { untracked } from '@preact/signals';
import { BuildingOrient, type SourceRef } from '@codecity/city';
import { BLOOM } from '@/state/settings/fields/effects';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/settings/fields/buildings';
import { MEDIA_ERROR_COLOR } from '@/constants/buildings';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { mediaKindOf, MediaKind, isDataBuilding } from '@/utils/fileKind';
import {
  FacadePanelTextureArray,
  MAX_PAGES as FACADE_PANEL_MAX_PAGES,
} from './facadePanelTextureArray';
import {
  SETTLED_COMMIT,
  TIMELINE_MODE,
  hasNoContentAtScrub,
  scrubbedBlobShaFor,
} from '@/state/stores/timeline';
import { dataFacadeKind, renderFontGlyphFacade, renderWaveformFacade } from './dataFacade';
import type { Building } from '@codecity/city';

import facadePanelVertSrc from './facadePanel.vert.glsl?raw';
import facadePanelFragSrc from './facadePanel.frag.glsl?raw';
import { SHARED_MEDIA_LOAD_LIMITER } from '../../mediaLoadLimiter';
import type { RendererRegistry } from './facadePanelTextureArray';
import { ContentPendingError } from '@codecity/city';
import { API } from '@/apiClient';

// The only thing keeping the quad out of co-planar z-fighting with the wall:
// depthWrite:false makes polygonOffset a no-op (see FACADE_PANELS.md).
const FACADE_FRONT_FACE_OFFSET = 1.5;

// On-screen height (CSS px) of ONE reference panel, so panels at a distance
// decide together. Hysteresis stops boundary flicker (FACADE_PANELS.md).
const FACADE_LOD_HIDE_PX = 6;
const FACADE_LOD_SHOW_PX = 12;

// Loads started per frame. A media-heavy repo otherwise fires every fetch and
// decode in one burst, and that jank lands on navigation (FACADE_PANELS.md).
const FACADE_LOAD_BUDGET_PER_FRAME = 4;

// Scratch objects for the per-frame LOD/load pass (no per-frame alloc).
const _scratchVec3 = new THREE.Vector3();
const _lodFrustum = new THREE.Frustum();
const _lodProjScreen = new THREE.Matrix4();
const _lodSphere = new THREE.Sphere();
// Shared zero-scale matrix used to collapse a culled panel to a point (the
// vertex shader then emits a degenerate quad — no fragments, no overdraw).
const _lodZeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

// ── Face layout: 4 faces per building, one InstancedMesh slot each ──

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

// ── InstancedFacadePanels ──

export interface FacadePanelRegistration {
  /** DataArrayTexture layer index allocated for this building's image. */
  layer: number;
  /** Four slot indices, in PANEL_ORIENTS order: South, North, East, West. */
  panelSlots: number[];
}

// Outside Timeline there is no commit to key on, and no position is negative.
const LIVE_STAMP = -1;

/** What a load of this building would fetch right now. Untracked: a rebuild
 *  computes it, and must not come back to life on every scrub. */
function versionKeyFor(b: Building): string {
  return untracked(() => scrubbedBlobShaFor(b.file?.path) ?? b.file?.modified ?? '');
}

export class InstancedFacadePanels {
  /** The instanced mesh — add this to the scene. */
  readonly mesh: THREE.InstancedMesh;

  private readonly _texArray: FacadePanelTextureArray;
  private readonly _capacity: number;
  private _nextSlot = 0;
  // A load that outlives dispose() checks this before touching iTextureFade,
  // or it clobbers the next instance's slots.
  private _disposed = false;

  // Per-instance attribute arrays (raw typed arrays for direct write).
  private readonly _iLayerIndex: Float32Array;
  private readonly _iColor: Float32Array;
  private readonly _iTextureFade: Float32Array;
  // Driven by buildingFader, so a panel fades in lockstep with the body the
  // selection cascade demoted.
  private readonly _iBuildingFade: Float32Array;
  // 0 = media panel, 1 = data facade; the shader picks emission + tint from it.
  private readonly _iIsData: Float32Array;
  // Plain MEDIA_ERROR_COLOR (no emission bake) — emission is applied per-kind in
  // the shader. Cached so markBuildingErrored doesn't reparse the hex each call.
  private readonly _errorColor!: THREE.Color;
  // Shader material reference — held so refresh() can update uniforms live.
  private readonly _material!: THREE.ShaderMaterial;
  // file.path → its 4 slots, so the fader never has to know the slot layout.
  private readonly _buildingSlotsByPath = new Map<string, number[]>();

  // Accumulated during registration: updateLOD estimates on-screen size from
  // the AABB and the tallest panel.
  private readonly _panelBounds = new THREE.Box3();
  private _maxPanelHeight = 0;

  // One per media building, swept each frame by updateLOD. `real` keeps each
  // matrix, so a culled panel comes back without recomputing it.
  private _panels: Array<{
    b: Building;
    layer: number;
    slots: number[];
    real: THREE.Matrix4[];
    center: THREE.Vector3;
    // A sphere, not the center point, so a large building at the screen edge
    // still counts as on-screen.
    radius: number;
    shown: boolean;
    // The version showing on it, and the one it should be showing: a blob sha
    // in Timeline, the working tree keyed by mtime otherwise. Differ, it loads.
    loadedKey: string | null;
    wantKey: string;
    // Per-building loader (media image vs binary fingerprint), chosen at register.
    startLoad: (b: Building, layer: number, panelSlots: number[]) => void;
  }> = [];
  // Which scrub position the panels' wantKey was computed at.
  private _versionStamp = LIVE_STAMP;
  // Constructor override: when set, replaces every panel's loader so tests can
  // observe LOD scheduling without hitting the network. null in production.
  private readonly _overrideStartLoad:
    ((b: Building, layer: number, panelSlots: number[]) => void) | null;

  constructor(
    mediaFileCapacity: number,
    // The city's own source: paths are repo-relative, so a facade read is
    // meaningless without the repo they are relative to.
    readonly source: SourceRef | null,
    opts?: {
      onStartLoad?: (b: Building, layer: number, panelSlots: number[]) => void;
      /** This city's renderer slot. Defaults to a private one, which is what
       *  tests without a renderer want: uploads time out and resolve false. */
      rendererRegistry?: RendererRegistry;
    }
  ) {
    this._overrideStartLoad = opts?.onStartLoad ?? null;
    this._versionStamp = TIMELINE_MODE.peek() ? SETTLED_COMMIT.peek() : LIVE_STAMP;
    this._capacity = mediaFileCapacity;
    // 4 faces per media building → total slot count.
    const slotCount = mediaFileCapacity * 4;

    this._texArray = new FacadePanelTextureArray(
      Math.max(1, mediaFileCapacity),
      opts?.rendererRegistry
    );

    // Shared quad geometry — unit plane in XY (same as PlaneGeometry(1,1)).
    // Each instance is positioned/rotated/scaled via instanceMatrix.
    const geo = new THREE.PlaneGeometry(1, 1);

    // Material — GLSL3 required for sampler2DArray.
    const adCfg = BUILDINGS.value;
    const placeholderColor = new THREE.Color(adCfg.MEDIA_PLACEHOLDER_COLOR);
    // Cached for markBuildingErrored — recolors a slot's iColor on a permanent
    // media load failure. No emission bake; the shader applies it per kind.
    this._errorColor = new THREE.Color(MEDIA_ERROR_COLOR);

    const bloomCfg = BLOOM.value;
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      // Injected as a #define: it sizes the sampler array and gates the
      // dispatch branches, so the page count lives in one constant.
      defines: {
        FACADE_PANEL_MAX_PAGES,
      },
      uniforms: {
        // Padded to MAX_PAGES so every declared slot is bound; the spares
        // reuse page 0 and are never sampled.
        uPanelArrays: { value: this._texArray.shaderTextures },
        // Layers per page (hardware MAX_ARRAY_TEXTURE_LAYERS). The
        // shader uses it to split iLayerIndex into (page, localLayer).
        uPageSize: { value: this._texArray.pageSize },
        // Per-kind emission, both gated on BLOOM.ENABLED; the shader picks via
        // iIsData, and uDataTint colors the white data facades.
        uMediaEmission: { value: bloomCfg.ENABLED ? adCfg.MEDIA_EMISSION : 1.0 },
        uDataEmission: { value: bloomCfg.ENABLED ? adCfg.DATA_EMISSION : 1.0 },
        uDataTint: { value: new THREE.Color(adCfg.DATA_COLOR) },
      },
      vertexShader: facadePanelVertSrc,
      fragmentShader: facadePanelFragSrc,
      transparent: true,
      depthWrite: false,
      // DoubleSide: FrontSide pops a panel out just before it is edge-on, and
      // at edge-on there is no pixel area to pay for (FACADE_PANELS.md).
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this._material = mat;
    this.mesh = new THREE.InstancedMesh(geo, mat, slotCount);
    this.mesh.count = 0; // grow as panels are registered
    this.mesh.userData.meshKind = 'facadePanel';
    // Facade panels are NOT pickable in cell mode — see file header.
    this.mesh.raycast = () => {};
    // Three's cull reads the geometry's origin-centered sphere and ignores
    // instance transforms, so it hides live panels (FACADE_PANELS.md).
    this.mesh.frustumCulled = false;
    // After buildings AND street labels: this mesh sorts as if at the origin,
    // so without the bump panels vanish into their walls (FACADE_PANELS.md).
    this.mesh.renderOrder = RENDER_ORDERS.FACADE_PANEL;

    // Pre-allocate per-instance attribute arrays.
    this._iLayerIndex = new Float32Array(slotCount); // 1 float per slot
    this._iColor = new Float32Array(slotCount * 3); // vec3 per slot
    this._iTextureFade = new Float32Array(slotCount); // 1 float per slot
    this._iBuildingFade = new Float32Array(slotCount); // 1 float per slot
    this._iIsData = new Float32Array(slotCount); // 1 float per slot (0=media, 1=data)

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
    geo.setAttribute('iIsData', new THREE.InstancedBufferAttribute(this._iIsData, 1));

    // Hide all instances initially via scale-zero matrices.
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < slotCount; i++) {
      this.mesh.setMatrixAt(i, zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** A poster panel per face, sized to the image's aspect and floated like a
   *  billboard. Null for a non-media building, or at capacity. */
  registerMediaBuilding(b: Building): FacadePanelRegistration | null {
    if (!mediaKindOf(b.file)) return null;
    // Aspect: clamp degenerate / missing metadata to a square.
    const mw = b.file.media_width;
    const mh = b.file.media_height;
    const rawAspect = mw && mh && mw > 0 ? mh / mw : 1.0;
    const aspect = Math.min(2.5, Math.max(0.4, rawAspect));
    const cfg = BUILDINGS.value;
    const dims = BUILDING_DIMENSIONS.value;
    const panelWidth = Math.max(0.1, b.w * (1 - 2 * cfg.MEDIA_SIDE_MARGIN_FRAC));
    const panelHeight = panelWidth * aspect;
    const centerY = cfg.MEDIA_BOTTOM_OFFSET_FLOORS * dims.FLOOR_HEIGHT + panelHeight / 2;
    return this._registerPanel(b, panelWidth, panelHeight, centerY, (bb, layer, slots) =>
      asyncLoadMediaForBuilding(this, bb, layer, slots)
    );
  }

  /** A byte-pattern fingerprint per face: unlike a billboard it IS the facade.
   *  Null for a non-data building, or at capacity. */
  registerBinaryBuilding(b: Building): FacadePanelRegistration | null {
    if (!isDataBuilding(b.file)) return null;
    return this._registerPanel(
      b,
      Math.max(0.1, b.w),
      Math.max(0.1, b.h),
      b.h / 2,
      (bb, layer, slots) => asyncLoadDataFacadeForBuilding(this, bb, layer, slots),
      new THREE.Color(b.color)
    );
  }

  /** Allocate a layer + 4 slots, place a quad at `centerY` on each face, and
   *  wire the building's `startLoad`. Null at capacity. */
  private _registerPanel(
    b: Building,
    panelWidth: number,
    panelHeight: number,
    centerY: number,
    startLoad: (b: Building, layer: number, panelSlots: number[]) => void,
    color?: THREE.Color
  ): FacadePanelRegistration | null {
    // Overflow check — 4 slots per building.
    if (this._nextSlot + 4 > this._capacity * 4) {
      console.warn('[facadePanels] slot capacity exhausted for', b.file?.path);
      return null;
    }

    const layer = this._texArray.allocate();
    if (layer < 0) {
      console.warn('[facadePanels] texture layer capacity exhausted for', b.file?.path);
      return null;
    }

    const dHalf = b.d / 2;
    const wHalf = b.w / 2;
    const isData = isDataBuilding(b.file);

    // Track the tallest panel + grow the panel AABB (see updateLOD).
    if (panelHeight > this._maxPanelHeight) this._maxPanelHeight = panelHeight;

    const panelSlots: number[] = [];
    const realMatrices: THREE.Matrix4[] = [];

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
      const zOffset = halfExtent + FACADE_FRONT_FACE_OFFSET;
      const worldX = b.x + sin * zOffset;
      const worldZ = b.y + cos * zOffset;
      this._panelBounds.expandByPoint(_scratchVec3.set(worldX, centerY, worldZ));

      // Build instance matrix: translate to face center, rotate about Y, scale to panel dimensions.
      const m = new THREE.Matrix4();
      m.makeRotationY(angle);
      // Apply scale first via a separate matrix, then multiply.
      const scale = new THREE.Matrix4().makeScale(panelWidth, panelHeight, 1);
      m.multiply(scale);
      m.setPosition(worldX, centerY, worldZ);
      this.mesh.setMatrixAt(slot, m);
      realMatrices.push(m.clone());

      // Layer index — same for all 4 faces of this building.
      this._iLayerIndex[slot] = layer;
      this._iIsData[slot] = isData ? 1 : 0;

      // Optional per-building placeholder tint (binary → the wall color).
      if (color) {
        this._iColor[slot * 3 + 0] = color.r;
        this._iColor[slot * 3 + 1] = color.g;
        this._iColor[slot * 3 + 2] = color.b;
      }
    }

    // Extend the visible count to include the newly written slots.
    this.mesh.count = Math.max(this.mesh.count, this._nextSlot);
    this.mesh.instanceMatrix.needsUpdate = true;

    // Mark attribute buffers dirty so the GPU sees the new layer indices (and
    // the tinted placeholder color, when a per-building color was applied).
    const geo = this.mesh.geometry as THREE.BufferGeometry;
    (geo.getAttribute('iLayerIndex') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geo.getAttribute('iIsData') as THREE.InstancedBufferAttribute).needsUpdate = true;
    if (color) {
      (geo.getAttribute('iColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }

    // Keyed on file.path, so the fader finds the slots without the mapping
    // being threaded through cellAssembly.
    const key = b.file?.path;
    if (key != null) this._buildingSlotsByPath.set(key, panelSlots.slice());

    // Panels start shown and unloaded; updateLOD culls and streams them. The
    // footprint center stands in for the 4 faces just outside it.
    this._panels.push({
      b,
      layer,
      slots: panelSlots,
      real: realMatrices,
      center: new THREE.Vector3(b.x, centerY, b.y),
      // Cover the panels: they sit ~half the footprint out from center on each
      // face, and stand panelHeight tall. Generous so an edge building isn't missed.
      radius: Math.max(b.w, b.d, panelHeight),
      shown: true,
      loadedKey: null,
      wantKey: versionKeyFor(b),
      startLoad,
    });

    return { layer, panelSlots };
  }

  /** Upload an image to a layer, then fade its slots in. The upload is async
   *  (canvas readback); the fade is a synchronous 0→1 step after it. */
  async loadTextureForBuilding(
    layer: number,
    panelSlots: number[],
    img: HTMLImageElement
  ): Promise<void> {
    const ok = await this._texArray.uploadImage(layer, img);
    // _disposed: whole mesh is being torn down (skeleton→final or live
    // update rebuild) — bail without touching any per-instance state.
    if (this._disposed) return;
    // Tint rather than ramp the fade: sampling an unwritten layer at fade=1
    // gives transparent fragments, so the panel just goes missing.
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

  /** As loadTextureForBuilding, but from a canvas: the video first-frame path
   *  has an HTMLCanvasElement rather than an image. */
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

  /** Fade each panel with the body it sits on. A null from `getFade` leaves
   *  those slots alone, so a skipped file keeps its 1.0 default. */
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

  /** The sticky tint for a load that failed for good: fade stays 0, so the
   *  shader shows this rather than sampling an unwritten layer. */
  markBuildingErrored(panelSlots: number[]): void {
    for (const slot of panelSlots) {
      this._iColor[slot * 3 + 0] = this._errorColor.r;
      this._iColor[slot * 3 + 1] = this._errorColor.g;
      this._iColor[slot * 3 + 2] = this._errorColor.b;
    }
    const geo = this.mesh.geometry as THREE.BufferGeometry;
    (geo.getAttribute('iColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /** Distance LOD, once per frame: far out, the overdraw stalls the GPU. A 0
   *  viewport height means unmeasured, so it no-ops (FACADE_PANELS.md). */
  updateLOD(camera: THREE.PerspectiveCamera, viewportHeightPx: number): void {
    if (viewportHeightPx <= 0 || this._nextSlot === 0 || this._panelBounds.isEmpty()) return;
    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    // Screen-height (px) a world height H projects to at distance D.
    const projPxAt = (h: number, d: number) =>
      (h * viewportHeightPx) / (2 * Math.max(d, 1e-3) * halfFovTan);

    // If even the nearest panel is a speck, hide the mesh and skip the
    // per-instance pass entirely.
    const nearDist = this._panelBounds.distanceToPoint(camera.position);
    const nearPx = projPxAt(this._maxPanelHeight, nearDist);
    if (this.mesh.visible) {
      if (nearPx < FACADE_LOD_HIDE_PX) this.mesh.visible = false;
    } else if (nearPx > FACADE_LOD_SHOW_PX) {
      this.mesh.visible = true;
    }
    if (!this.mesh.visible) return;

    this._refreshWantedVersions();

    // Per-instance pass: cull panels that project too small or leave the
    // frustum, and stream loads for the ones we actually render (budgeted).
    _lodProjScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _lodFrustum.setFromProjectionMatrix(_lodProjScreen);
    let started = 0;
    let matricesDirty = false;
    for (const rec of this._panels) {
      // Reference height (not rec's own) so same-distance panels decide together.
      const px = projPxAt(this._maxPanelHeight, camera.position.distanceTo(rec.center));
      // Hysteresis: a shown panel survives down to HIDE, a hidden one restores
      // only above SHOW. Off-screen panels are always culled.
      const bigEnough = rec.shown ? px >= FACADE_LOD_HIDE_PX : px >= FACADE_LOD_SHOW_PX;
      // Sphere, not center point: a big building at the screen edge (center
      // off-frame) still counts as visible.
      _lodSphere.center.copy(rec.center);
      _lodSphere.radius = rec.radius;
      const wantShown = bigEnough && _lodFrustum.intersectsSphere(_lodSphere);

      if (wantShown !== rec.shown) {
        for (let i = 0; i < rec.slots.length; i++) {
          this.mesh.setMatrixAt(rec.slots[i], wantShown ? rec.real[i] : _lodZeroMatrix);
        }
        rec.shown = wantShown;
        matricesDirty = true;
      }

      // Load only what we render, at most FACADE_LOAD_BUDGET_PER_FRAME new per frame.
      if (wantShown && rec.loadedKey !== rec.wantKey && started < FACADE_LOAD_BUDGET_PER_FRAME) {
        // Stamped on the attempt, not on the result: a bail-out (no content at
        // this commit) must not re-queue itself every frame.
        rec.loadedKey = rec.wantKey;
        (this._overrideStartLoad ?? rec.startLoad)(rec.b, rec.layer, rec.slots);
        started++;
      }
    }
    if (matricesDirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Hot-reload emission + data tint from config (no rebuild). */
  refresh(): void {
    const enabled = BLOOM.value.ENABLED;
    const cfg = BUILDINGS.value;
    const u = this._material.uniforms;
    u.uMediaEmission.value = enabled ? cfg.MEDIA_EMISSION : 1.0;
    u.uDataEmission.value = enabled ? cfg.DATA_EMISSION : 1.0;
    (u.uDataTint.value as THREE.Color).set(cfg.DATA_COLOR);
  }

  /** Re-ask every panel which version it wants, only when the scrub moved:
   *  versionKeyFor walks a path's history, so it stays off the per-frame path. */
  private _refreshWantedVersions(): void {
    const stamp = TIMELINE_MODE.peek() ? SETTLED_COMMIT.peek() : LIVE_STAMP;
    if (stamp === this._versionStamp) return;
    this._versionStamp = stamp;
    for (const rec of this._panels) rec.wantKey = versionKeyFor(rec.b);
  }

  dispose(): void {
    this._disposed = true;
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this._texArray.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

// ── Async media loading ──
// Semaphore-gated, or a media-heavy repo drowns the pool (FACADE_PANELS.md).
// Deliberately shared across cities — see mediaLoadLimiter.ts for why this is
// the one piece of state that should be.

function _acquireSlot(): Promise<void> {
  return SHARED_MEDIA_LOAD_LIMITER.acquire();
}

function _releaseSlot(): void {
  SHARED_MEDIA_LOAD_LIMITER.release();
}

/** Load and upload a building's image or video: image bytes are fetched as a
 *  Blob so the status is readable, videos stream a frame (FACADE_PANELS.md). */
function asyncLoadMediaForBuilding(
  ads: InstancedFacadePanels,
  b: Building,
  layer: number,
  panelSlots: number[]
): void {
  const kind = mediaKindOf(b.file);
  if (!kind) return;
  // Absent at this commit: there is no blob, and asking by path would hit HEAD
  // and 404. The building just shows no image.
  if (hasNoContentAtScrub(b.file.path)) return;

  const source = ads.source;
  if (!source) return;
  const filePath = b.file.path || '';
  // Scrubbed commits pin a version; Live keys on mtime. Either way the URL names
  // one immutable body, so a rebuild re-reads it from the browser cache.
  const sha = scrubbedBlobShaFor(b.file.path);
  const version = b.file.modified || '';

  if (kind === MediaKind.Image) {
    void _loadImageBuilding(ads, source, filePath, version, sha, layer, panelSlots);
  } else {
    void _loadVideoBuilding(ads, API.fileUrl(source, filePath, version, sha), layer, panelSlots);
  }
}

/** A data facade by kind: a glyph for a font, a waveform for audio, the
 *  server's fingerprint otherwise. A failure leaves the sealed placeholder. */
function asyncLoadDataFacadeForBuilding(
  ads: InstancedFacadePanels,
  b: Building,
  layer: number,
  panelSlots: number[]
): void {
  if (hasNoContentAtScrub(b.file.path)) return;
  const source = ads.source;
  if (!source) return;
  const filePath = b.file.path || '';
  const version = b.file.modified || '';
  switch (dataFacadeKind(b.file.extension || '')) {
    case 'font':
      void _loadCanvasFacade(
        ads,
        () => renderFontGlyphFacade(source, filePath, version),
        layer,
        panelSlots
      );
      break;
    case 'audio':
      void _loadCanvasFacade(
        ads,
        () => renderWaveformFacade(source, filePath, version),
        layer,
        panelSlots
      );
      break;
    default:
      void _loadFingerprintBuilding(
        ads,
        API.fingerprintUrl(source, filePath, version),
        layer,
        panelSlots
      );
  }
}

async function _loadCanvasFacade(
  ads: InstancedFacadePanels,
  render: () => Promise<HTMLCanvasElement | null>,
  layer: number,
  panelSlots: number[]
): Promise<void> {
  await _acquireSlot();
  try {
    const canvas = await render();
    if (canvas) await ads.loadCanvasForBuilding(layer, panelSlots, canvas);
  } catch {
    // Render/decode failure — leave the sealed placeholder facade.
  } finally {
    _releaseSlot();
  }
}

async function _loadFingerprintBuilding(
  ads: InstancedFacadePanels,
  url: string,
  layer: number,
  panelSlots: number[]
): Promise<void> {
  await _acquireSlot();
  try {
    // The PNG arrives as a PNG: nothing to decode, cached per file. No
    // fingerprint (missing, or not downloaded) keeps the sealed placeholder.
    const img = await _loadImage(url);
    if (img !== null) await ads.loadTextureForBuilding(layer, panelSlots, img);
  } catch {
    // Decode/upload failure — leave the sealed placeholder facade.
  } finally {
    _releaseSlot();
  }
}

async function _loadImageBuilding(
  ads: InstancedFacadePanels,
  source: SourceRef,
  filePath: string,
  version: string,
  sha: string | null,
  layer: number,
  panelSlots: number[]
): Promise<void> {
  // A Blob rather than an <img> src, so the status is readable: waiting must
  // keep the placeholder, not tint the building broken.
  let blob: Blob;
  try {
    blob = await API.fetchFileBlob(source, filePath, version, sha);
  } catch (err) {
    // Waiting resolves itself: the next rebuild picks the image up once the
    // fetch behind it lands. Anything else is a real failure.
    if (!(err instanceof ContentPendingError)) ads.markBuildingErrored(panelSlots);
    return;
  }
  const objUrl = URL.createObjectURL(blob);
  await _acquireSlot();
  let errored = false;
  try {
    const img = await _loadImage(objUrl);
    if (img === null) errored = true;
    else await ads.loadTextureForBuilding(layer, panelSlots, img);
  } catch {
    // Decode / upload failure (post-fetch) — flag for the error tint instead of
    // leaving the loading placeholder visible forever.
    errored = true;
  } finally {
    URL.revokeObjectURL(objUrl);
    if (errored) ads.markBuildingErrored(panelSlots);
    _releaseSlot();
  }
}

async function _loadVideoBuilding(
  ads: InstancedFacadePanels,
  url: string,
  layer: number,
  panelSlots: number[]
): Promise<void> {
  await _acquireSlot();
  let errored = false;
  try {
    const canvas = await _loadVideoPoster(url);
    if (canvas === null) errored = true;
    else await ads.loadCanvasForBuilding(layer, panelSlots, canvas);
  } catch {
    errored = true;
  } finally {
    _releaseSlot();
  }
  // A <video> reports only that it didn't load, never a status. Ask, outside the
  // slot, before wearing the error tint for a file that is merely queued.
  if (errored && !(await API.isContentPending(url))) ads.markBuildingErrored(panelSlots);
}

/** Promise-wrapped image load, resolving null on failure so callers can test
 *  the result rather than wrap a try/catch. */
function _loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ── Video first-frame extraction: a canvas, which uploadCanvas takes from here ──

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

// The "▶" overlay that makes a poster read as a video at thumbnail scale.
// Visual-feel fractions, picked by eye (FACADE_PANELS.md).
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
