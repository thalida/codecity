// city/components/buildings/facadePanels.ts — Instanced facade panels: 4 quads
// per building (S/N/E/W) on a shared DataArrayTexture, each carrying its own
// loader (media image / binary fingerprint / font glyph / waveform) + aspect.
// Not pickable (no per-instance raycast userData). WebGL2 (DataArrayTexture + GLSL3).

import * as THREE from 'three';
import { BuildingOrient } from '@/types/index';
import { BLOOM } from '@/state/stores/settings/effects';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/stores/settings/buildings';
import { MEDIA_ERROR_COLOR } from '@/constants/buildings';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { mediaKindOf, MediaKind } from '@/utils/mediaKind';
import { isDataBuilding } from '@/utils/binaryKind';
import {
  FacadePanelTextureArray,
  MAX_PAGES as FACADE_PANEL_MAX_PAGES,
} from './facadePanelTextureArray';
import { fetchMediaBlob } from './mediaBatch';
import { hasNoContentAtScrub, scrubbedBlobShaFor } from '@/state/stores/presentPaths';
import { fileUrl } from '@/api/file';
import { fetchFingerprintB64 } from '@/api/fingerprint';
import { dataFacadeKind, renderFontGlyphFacade, renderWaveformFacade } from './dataFacade';
import type { Building } from '@/types/index';

import facadePanelVertSrc from './facadePanel.vert.glsl?raw';
import facadePanelFragSrc from './facadePanel.frag.glsl?raw';

// World-unit z-offset from the building's front face. depthWrite:false on
// the panel material means polygonOffset has no effect, so this is the only
// thing keeping the panel quad from co-planar z-fighting with the building
// face. Tuned to clear typical 8–96 unit-wide buildings at oblique angles.
const FACADE_FRONT_FACE_OFFSET = 1.5;

// LOD thresholds — the on-screen height (CSS px) a REFERENCE panel
// (the tallest in the repo) would project to at a given camera distance. Both
// the whole-mesh early-out (measured at the nearest panel) and the per-instance
// cull (measured at each panel) use this ONE reference height rather than each
// panel's own height, so panels at the same distance always decide together — a
// small file's short billboard next to a big one's tall billboard load/cull as a
// unit instead of the finicky mixed row you'd get from per-panel sizes.
//
// Facade panels are transparent + DoubleSide + never frustum-culled, so a panel this
// far away is a sub-pixel speck contributing only overdraw; hiding it (and not
// loading it) is free. Hysteresis (cull below HIDE, restore above SHOW) keeps a
// panel at the boundary from flickering as OrbitControls damps.
const FACADE_LOD_HIDE_PX = 6;
const FACADE_LOD_SHOW_PX = 12;

// Max image loads STARTED per frame. A media-heavy repo (PostHog: ~1.4k images)
// otherwise fires every fetch + base64 decode + canvas scale + GPU upload in one
// burst on load, and that main-thread work janks navigation while it drains.
// Starting a few per frame, only for on-screen panels (see updateLOD), spreads
// the cost so zooming/rotating stays smooth as billboards stream in.
const FACADE_LOAD_BUDGET_PER_FRAME = 4;

// Scratch objects for the per-frame LOD/load pass (no per-frame alloc).
const _scratchVec3 = new THREE.Vector3();
const _lodFrustum = new THREE.Frustum();
const _lodProjScreen = new THREE.Matrix4();
const _lodSphere = new THREE.Sphere();
// Shared zero-scale matrix used to collapse a culled panel to a point (the
// vertex shader then emits a degenerate quad — no fragments, no overdraw).
const _lodZeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------------------
// Face layout helpers. 4 faces per building; each face is one InstancedMesh
// slot.
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
// InstancedFacadePanels
// ---------------------------------------------------------------------------

export interface FacadePanelRegistration {
  /** DataArrayTexture layer index allocated for this building's image. */
  layer: number;
  /**
   * Four InstancedMesh slot indices (one per face, in PANEL_ORIENTS order:
   * South, North, East, West).
   */
  panelSlots: number[];
}

export class InstancedFacadePanels {
  /** The instanced mesh — add this to the scene. */
  readonly mesh: THREE.InstancedMesh;

  private readonly _texArray: FacadePanelTextureArray;
  private readonly _capacity: number;
  private _nextSlot = 0;
  // Tracks dispose() — async load tasks that started before dispose
  // but completed after (very likely during a skeleton→final or live-
  // update rebuild) check this before touching iTextureFade so they
  // don't clobber the new InstancedFacadePanels' slot state.
  private _disposed = false;

  // Per-instance attribute arrays (raw typed arrays for direct write).
  private readonly _iLayerIndex: Float32Array;
  private readonly _iColor: Float32Array;
  private readonly _iTextureFade: Float32Array;
  // Per-instance opacity multiplier, driven by buildingFader so a facade panel
  // fades down in lockstep with its building body when the selection cascade
  // demotes that building to a Level 1-4 tier.
  private readonly _iBuildingFade: Float32Array;
  // 0 = media panel, 1 = data facade; the shader picks emission + tint from it.
  private readonly _iIsData: Float32Array;
  // Plain MEDIA_ERROR_COLOR (no emission bake) — emission is applied per-kind in
  // the shader. Cached so markBuildingErrored doesn't reparse the hex each call.
  private readonly _errorColor!: THREE.Color;
  // Shader material reference — held so refresh() can update uniforms live.
  private readonly _material!: THREE.ShaderMaterial;
  // file.path → 4 panel slot indices for that building. Populated by
  // registerMediaBuilding and consumed by applyBuildingFades so the
  // fader doesn't need to know the slot layout.
  private readonly _buildingSlotsByPath = new Map<string, number[]>();

  // World-space AABB of every panel center + the tallest panel height, both
  // accumulated during registration. updateLOD() uses them to estimate the
  // panels' on-screen size and toggle mesh visibility (distance LOD).
  private readonly _panelBounds = new THREE.Box3();
  private _maxPanelHeight = 0;

  // One record per registered media building, driven per frame by updateLOD:
  //   - render cull: collapse the 4 panels to zero-scale when they project too
  //     small to read (or leave the frustum), restore when big + on-screen.
  //   - streamed loading: start the image load only for panels we actually
  //     render, budgeted per frame, so a media-heavy repo never loads in a burst.
  // `real` holds each panel's real instance matrix so a culled panel can be
  // restored without recomputing it.
  private _panels: Array<{
    b: Building;
    layer: number;
    slots: number[];
    real: THREE.Matrix4[];
    center: THREE.Vector3;
    // Bounding radius around `center` covering the building's 4 panels — the
    // frustum test uses a sphere, not the center point, so a large building at
    // the screen edge (center off-frame, geometry on-frame) still counts as
    // on-screen and loads/renders.
    radius: number;
    shown: boolean;
    loaded: boolean;
    // Per-building loader (media image vs binary fingerprint), chosen at register.
    startLoad: (b: Building, layer: number, panelSlots: number[]) => void;
  }> = [];
  // Constructor override: when set, replaces every panel's loader so tests can
  // observe LOD scheduling without hitting the network. null in production.
  private readonly _overrideStartLoad:
    ((b: Building, layer: number, panelSlots: number[]) => void) | null;

  constructor(
    mediaFileCapacity: number,
    opts?: { onStartLoad?: (b: Building, layer: number, panelSlots: number[]) => void }
  ) {
    this._overrideStartLoad = opts?.onStartLoad ?? null;
    this._capacity = mediaFileCapacity;
    // 4 faces per media building → total slot count.
    const slotCount = mediaFileCapacity * 4;

    this._texArray = new FacadePanelTextureArray(Math.max(1, mediaFileCapacity));

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
      // FACADE_PANEL_MAX_PAGES injected as a shader #define — sizes the
      // uPanelArrays sampler array AND gates the sampleLayer dispatch
      // branches (each `#if FACADE_PANEL_MAX_PAGES > N`), so the page count
      // lives only in MAX_PAGES.
      defines: {
        FACADE_PANEL_MAX_PAGES,
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
        // Per-kind emission (media billboard vs data facade), both gated on
        // BLOOM.ENABLED; the shader picks via iIsData. uDataTint colors the
        // white data facades (fingerprint / glyph / waveform). Live via refresh().
        uMediaEmission: { value: bloomCfg.ENABLED ? adCfg.MEDIA_EMISSION : 1.0 },
        uDataEmission: { value: bloomCfg.ENABLED ? adCfg.DATA_EMISSION : 1.0 },
        uDataTint: { value: new THREE.Color(adCfg.DATA_COLOR) },
      },
      vertexShader: facadePanelVertSrc,
      fragmentShader: facadePanelFragSrc,
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
    this.mesh.userData.meshKind = 'facadePanel';
    // Facade panels are NOT pickable in cell mode — see file header.
    this.mesh.raycast = () => {};
    // Disable Three.js frustum culling for this InstancedMesh: the
    // built-in cull uses the *geometry's* bounding sphere (a tiny
    // unit-plane sphere at origin) and ignores per-instance transforms.
    // When the camera rotates so origin is outside the view, Three.js
    // culls the whole mesh — making facade panels disappear even when
    // their world-space positions are still on-screen. Per-instance
    // frustum testing would be the principled fix, but slotCount is
    // bounded (≤1024 in typical usage) so always-draw is cheap and
    // correct.
    this.mesh.frustumCulled = false;
    // Force facade panels to render AFTER buildings AND street labels in the
    // transparent pass. Buildings, street labels and facade panels are all
    // transparent: true, so they sort by renderOrder first and distance
    // to camera second. The facade-panel mesh's bounding sphere lives at
    // world origin (we never set mesh.position — instance transforms
    // live in instanceMatrix), so it sorts as if it's at (0,0,0). For
    // any building far from origin (i.e., everywhere in practice), the
    // panel mesh appears FARTHER from the camera than the cell building
    // mesh, so back-to-front sort would render facade panels FIRST. Then
    // the building (with depthWrite:true) would overwrite those panel
    // pixels — making panels invisible on the camera-facing walls.
    // renderOrder bumps the panel mesh into a later sort bucket so it
    // always draws on top; polygonOffset on the material then keeps
    // the panel correctly anchored to its wall. FACADE_PANEL must also
    // out-rank STREET_LABEL — both have depthWrite:false, and the
    // panel hangs out past its wall by FACADE_FRONT_FACE_OFFSET, so without the bump
    // the road-name plane wins the painter sort and bleeds through the
    // panel's overhang.
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

  /**
   * Media building: a poster panel on each face showing the file's image, sized
   * to its aspect and floated on the facade like a billboard. Null for a
   * non-media building or on capacity exhaustion.
   */
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

  /**
   * Binary "data" building: a byte-pattern fingerprint on each face. Unlike a
   * media billboard the fingerprint IS the facade — it fills the whole face
   * (contained to the building, not floating), and its transparent background
   * lets the sealed wall show through. The placeholder is the building's own
   * color so it blends in before the fingerprint streams in. Null for a non-data
   * building or on capacity exhaustion.
   */
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

  /**
   * Allocate a texture layer + 4 panel slots, place a (panelWidth × panelHeight)
   * quad at `centerY` on each face, wire the per-building `startLoad`, optionally
   * tint the placeholder. Null on capacity exhaustion.
   */
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

    // Remember which 4 slots back this building, keyed on file.path so
    // buildingFader can look the slots up by FileNode.path during its
    // selection-cascade sweep without having to thread the mapping
    // through cellAssembly.
    const key = b.file?.path;
    if (key != null) this._buildingSlotsByPath.set(key, panelSlots.slice());

    // Register for the per-frame LOD/load pass. Panels start SHOWN (their real
    // matrices are already written above) and unloaded; updateLOD culls +
    // streams them. center = building footprint center at panel height (a good
    // proxy for the 4 faces, which sit a hair outside it).
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
      loaded: false,
      startLoad,
    });

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
   * Push a per-building opacity multiplier onto every facade panel for which
   * `getFade` returns a value. Used by buildingFader so an facade panel fades
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
   * Recolor a building's 4 panel slots to the MEDIA_ERROR_COLOR tint. Called
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
   * Distance LOD: toggle whole-mesh visibility from the panels' estimated
   * on-screen size at the current camera. Called once per frame from the
   * buildings tick. Facade panels are transparent + DoubleSide + never
   * frustum-culled, so when the camera zooms far out they all render into a
   * tiny screen region and the overdraw stalls the GPU; hiding the mesh once
   * the panels are sub-pixel keeps a media-heavy repo smooth on zoom-out +
   * rotate. `viewportHeightPx` is the canvas CSS height (0 while unmeasured →
   * no-op so we never hide on a bogus size).
   */
  updateLOD(camera: THREE.PerspectiveCamera, viewportHeightPx: number): void {
    if (viewportHeightPx <= 0 || this._nextSlot === 0 || this._panelBounds.isEmpty()) return;
    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    // Screen-height (px) a world height H projects to at distance D.
    const projPxAt = (h: number, d: number) =>
      (h * viewportHeightPx) / (2 * Math.max(d, 1e-3) * halfFovTan);

    // Whole-mesh early-out: distance to the nearest point of the panel cloud (0
    // when the camera sits among the buildings). If even the nearest panel is a
    // speck, hide the whole mesh and skip the per-instance pass.
    const nearDist = this._panelBounds.distanceToPoint(camera.position);
    const nearPx = projPxAt(this._maxPanelHeight, nearDist);
    if (this.mesh.visible) {
      if (nearPx < FACADE_LOD_HIDE_PX) this.mesh.visible = false;
    } else if (nearPx > FACADE_LOD_SHOW_PX) {
      this.mesh.visible = true;
    }
    if (!this.mesh.visible) return;

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
      if (wantShown && !rec.loaded && started < FACADE_LOAD_BUDGET_PER_FRAME) {
        (this._overrideStartLoad ?? rec.startLoad)(rec.b, rec.layer, rec.slots);
        rec.loaded = true;
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
 * Trigger async load of a media building's image/video and upload to the given
 * InstancedFacadePanels instance once ready.
 *
 * Images: bytes come from the batched POST /api/images endpoint (see
 * mediaBatch.ts) — the network fetch is coalesced across all media buildings,
 * not slot-gated, so a media-heavy repo doesn't fire thousands of singleton
 * GETs. Only the decode + GPU upload is funneled through the concurrency
 * semaphore (paces texSubImage3D uploads + keeps the main thread responsive).
 * A path the batch omits (too large / non-image) falls back to the streaming
 * GET /api/file?path=… .
 *
 * Videos: never batched (we only need the first frame, and <video> streams just
 * enough to grab it) — loaded individually through the same semaphore.
 */
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

  const filePath = b.file.fullPath || b.file.path || '';
  // Scrubbed commits pin a version; Live reads the working tree.
  const url = fileUrl(filePath, undefined, scrubbedBlobShaFor(b.file.path));

  if (kind === MediaKind.Image) {
    void _loadImageBuilding(ads, filePath, url, layer, panelSlots, b.file.path);
  } else {
    void _loadVideoBuilding(ads, url, layer, panelSlots);
  }
}

/**
 * Load a data building's facade, dispatched by kind: a font gets its own 'a'
 * glyph, audio gets a waveform (both rendered client-side to a canvas), and any
 * other binary gets the server byte-pattern fingerprint. A missing/failed facade
 * just leaves the sealed placeholder — a valid look, so no error tint.
 */
function asyncLoadDataFacadeForBuilding(
  ads: InstancedFacadePanels,
  b: Building,
  layer: number,
  panelSlots: number[]
): void {
  if (hasNoContentAtScrub(b.file.path)) return;
  const filePath = b.file.fullPath || b.file.path || '';
  const version = b.file.modified || '';
  switch (dataFacadeKind(b.file.extension || '')) {
    case 'font':
      void _loadCanvasFacade(
        ads,
        () => renderFontGlyphFacade(filePath, version, b.file.path),
        layer,
        panelSlots
      );
      break;
    case 'audio':
      void _loadCanvasFacade(
        ads,
        () => renderWaveformFacade(filePath, version, b.file.path),
        layer,
        panelSlots
      );
      break;
    default:
      void _loadFingerprintBuilding(ads, filePath, layer, panelSlots);
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
  filePath: string,
  layer: number,
  panelSlots: number[]
): Promise<void> {
  // Fetch (batched) outside the semaphore so the coalescing window sees every
  // data building at once; only decode + upload is slot-gated.
  const b64 = await fetchFingerprintB64(filePath);
  if (b64 === null) return;
  await _acquireSlot();
  try {
    const img = await _loadImage(`data:image/png;base64,${b64}`);
    if (img !== null) await ads.loadTextureForBuilding(layer, panelSlots, img);
  } catch {
    // Decode/upload failure — leave the sealed placeholder facade.
  } finally {
    _releaseSlot();
  }
}

async function _loadImageBuilding(
  ads: InstancedFacadePanels,
  filePath: string,
  fallbackUrl: string,
  layer: number,
  panelSlots: number[],
  relPath?: string
): Promise<void> {
  // Fetch (batched) happens outside the GPU semaphore so the coalescing window
  // sees every media building at once; only decode + upload is slot-gated.
  const blob = await fetchMediaBlob(filePath, scrubbedBlobShaFor(relPath));
  const objUrl = blob ? URL.createObjectURL(blob) : null;
  await _acquireSlot();
  let errored = false;
  try {
    const img = await _loadImage(objUrl ?? fallbackUrl);
    if (img === null) errored = true;
    else await ads.loadTextureForBuilding(layer, panelSlots, img);
  } catch {
    // Decode / upload failure (post-fetch) — flag for the error tint instead of
    // leaving the loading placeholder visible forever.
    errored = true;
  } finally {
    if (objUrl) URL.revokeObjectURL(objUrl);
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
    if (errored) ads.markBuildingErrored(panelSlots);
    _releaseSlot();
  }
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
// Video first-frame extraction — returns a canvas instead of a THREE.Texture
// (uploadCanvas handles the rest).
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
