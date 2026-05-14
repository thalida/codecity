// scene/instanced/buildings.ts — per-block building instance buffer builder.
//
// Pure function; no Three.js scene mutation, no DOM, no async.
// Mesh creation (attaching these buffers to a THREE.InstancedMesh) lands in Task 8.

import * as THREE from 'three';
import { BUILDING_DIMENSIONS, BUILDING_OUTLINE } from '@/config/index.js';
import { BuildingOrient } from '@/types/index.js';
import { getFileIconName } from '@/views/shell/fileIcon.js';
import { isMediaFile } from '../billboards.js';
import type { IconAtlas } from '../iconAtlas.js';
import type { SceneBlock } from '../blocks.js';

export interface BuildingInstanceBuffer {
  matrix: Float32Array; // N × 16 (Matrix4 per instance)
  color: Float32Array; // N × 3 (RGB per instance)
  cols: Float32Array; // N × 2 (cols_ew, cols_ns)
  floors: Float32Array; // N
  orient: Float32Array; // N (0=S, 1=N, 2=E, 3=W — matches shader's iOrient contract)
  doorWidth: Float32Array; // N
  opacity: Float32Array; // N (defaults to 1.0)
  silhouette: Float32Array; // N (0 = full facade, 1 = solid silhouette — set by fader)
  outlineOpacity: Float32Array; // N (0 = no per-building wireframe; >0 = composited at alpha)
  /**
   * N × 3 — packed attribute to stay under the GL_MAX_VERTEX_ATTRIBS=16 cap:
   *   .xy = top-left UV of the file-icon slot in the atlas, or (-1, -1) for "no icon"
   *   .z  = per-file random in [0, 1], drives the shader's window gap / lit
   *         pattern so same-color buildings (e.g. all .css files of similar
   *         age) don't share a facade. Stable across rebuilds via an
   *         FNV-1a hash of file.path.
   */
  iconUV: Float32Array;
}

// ---------------------------------------------------------------------------
// Renderer-internal constants — must match the values in engine.ts exactly.
// See FACADE object in engine.ts:
//   WINDOW_COLS_SIZE_DIVISOR: 8
//   WINDOW_COLS_MAX: 5
// See module-level constant in engine.ts:
//   DOOR_WIDTH_OF_PATH: 0.8
// ---------------------------------------------------------------------------

/** Matches FACADE.WINDOW_COLS_SIZE_DIVISOR in engine.ts */
const WINDOW_COLS_SIZE_DIVISOR = 8;

/** Matches FACADE.WINDOW_COLS_MAX in engine.ts */
const WINDOW_COLS_MAX = 5;

/**
 * Door world width = (building.w × PATH_WIDTH_FRAC) × DOOR_WIDTH_OF_PATH.
 * Matches the module-level constant in engine.ts.
 */
const DOOR_WIDTH_OF_PATH = 0.8;

/**
 * Build per-instance attribute buffers for a block's buildings.
 * Pure function; no Three.js scene mutation.
 *
 * The resulting arrays are ready for THREE.InstancedBufferAttribute:
 *   matrix    → set as instanceMatrix (InstancedMesh built-in)
 *   color     → set as instanceColor (InstancedMesh built-in)
 *   cols      → iCols attribute
 *   floors    → iFloors attribute
 *   orient    → iOrient attribute (0=S, 1=N, 2=E, 3=W)
 *   doorWidth → iDoorWidth attribute
 *   opacity   → iOpacity attribute
 */
export function buildBuildingInstanceBuffer(block: SceneBlock): BuildingInstanceBuffer {
  const n = block.buildings.length;
  const buf: BuildingInstanceBuffer = {
    matrix: new Float32Array(n * 16),
    color: new Float32Array(n * 3),
    cols: new Float32Array(n * 2),
    floors: new Float32Array(n),
    orient: new Float32Array(n),
    doorWidth: new Float32Array(n),
    opacity: new Float32Array(n),
    silhouette: new Float32Array(n),
    outlineOpacity: new Float32Array(n),
    iconUV: new Float32Array(n * 3),
  };

  const m = new THREE.Matrix4();
  const colorTmp = new THREE.Color();
  // PATH_WIDTH_FRAC is user-tunable via the BUILDING_DIMENSIONS nanostore.
  // Read once per buffer build so all buildings in the block use the same
  // config snapshot (consistent with how engine.ts reads it per-building).
  const pathWidthFrac = BUILDING_DIMENSIONS.get().PATH_WIDTH_FRAC;

  for (let i = 0; i < n; i++) {
    const b = block.buildings[i];

    // Media files (images / videos) are rendered as separate billboard
    // meshes; we keep their slot in the InstancedMesh so per-instance
    // indices stay aligned with block.buildings, but collapse the
    // matrix to a zero-scale so the cube vanishes from the GPU pipeline
    // (no fragments, no raycast hits).
    // The path-derived seed is set on EVERY building (including media)
    // so we don't leave an uninitialized z component dangling — even
    // the zero-scaled slot needs a valid stride.
    const seed = _seedFromPath(b.file?.path ?? '');

    if (b.file && isMediaFile(b.file)) {
      m.makeScale(0, 0, 0);
      m.setPosition(b.x, 0, b.y);
      buf.matrix.set(m.toArray(), i * 16);
      buf.iconUV[i * 3 + 0] = -1.0;
      buf.iconUV[i * 3 + 1] = -1.0;
      buf.iconUV[i * 3 + 2] = seed;
      continue;
    }

    // --- Transform matrix ---
    // Layout (x, y) → scene (x, z); building.h is scene-Y.
    // Position y = h/2 so the base sits on z=0, matching createBuildingMesh:
    //   mesh.position.set(building.x, renderH / 2, building.y)
    m.makeScale(b.w, b.h, b.d);
    m.setPosition(b.x, b.h / 2, b.y);
    buf.matrix.set(m.toArray(), i * 16);

    // --- Color (linear RGB) ---
    colorTmp.set(b.color);
    buf.color[i * 3 + 0] = colorTmp.r;
    buf.color[i * 3 + 1] = colorTmp.g;
    buf.color[i * 3 + 2] = colorTmp.b;

    // --- Window column counts ---
    // Mirror createBuildingMesh in engine.ts:
    //   ±X faces (east/west walls) span depth d → cols_ew from d
    //   ±Z faces (north/south walls) span width w → cols_ns from w
    const colsEW = Math.max(
      1,
      Math.min(WINDOW_COLS_MAX, Math.floor(b.d / WINDOW_COLS_SIZE_DIVISOR)),
    );
    const colsNS = Math.max(
      1,
      Math.min(WINDOW_COLS_MAX, Math.floor(b.w / WINDOW_COLS_SIZE_DIVISOR)),
    );
    buf.cols[i * 2 + 0] = colsEW;
    buf.cols[i * 2 + 1] = colsNS;

    // --- Floor count ---
    buf.floors[i] = Math.max(1, b.floors ?? 1);

    // --- Orient encoding (shader: 0=S, 1=N, 2=E, 3=W) ---
    buf.orient[i] = orientToIndex(b.orient);

    // --- Door width ---
    // doorWorldWidth = building.w × PATH_WIDTH_FRAC × DOOR_WIDTH_OF_PATH
    // Mirrors createBuildingMesh:
    //   const doorWorldWidth = w * BUILDING_DIMENSIONS.get().PATH_WIDTH_FRAC * DOOR_WIDTH_OF_PATH;
    buf.doorWidth[i] = b.w * pathWidthFrac * DOOR_WIDTH_OF_PATH;

    // --- Opacity (default 1.0; fader updates in-place at runtime) ---
    buf.opacity[i] = 1.0;

    // --- Icon UV (top-left of slot in atlas) + per-instance seed ---
    // (-1, -1) on .xy means "no icon" — the shader checks .x < 0 and
    // skips the atlas sample. The seed lands on .z; packed here to
    // stay under the GL_MAX_VERTEX_ATTRIBS=16 cap (16 attribute slots
    // total, plus the 8 Three.js auto-injects = leaves us 8 to spend).
    buf.iconUV[i * 3 + 0] = -1.0;
    buf.iconUV[i * 3 + 1] = -1.0;
    buf.iconUV[i * 3 + 2] = seed;
    if (_atlas) {
      const file = b.file;
      if (file) {
        const iconName = getFileIconName(file);
        const uv = _atlas.uvFor(iconName);
        if (uv) {
          buf.iconUV[i * 3 + 0] = uv[0];
          buf.iconUV[i * 3 + 1] = uv[1];
        }
      }
    }
  }

  return buf;
}

/**
 * Stable 32-bit FNV-1a hash of a string, normalized to [0, 1). Used to
 * derive a per-instance random `seed` that the shader keys facade
 * variations off of — deterministic across rebuilds so a building's
 * window pattern doesn't shuffle on every live-update poll.
 */
function _seedFromPath(path: string): number {
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime, 32-bit safe via imul
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Map BuildingOrient string enum → 0/1/2/3 per the shader's iOrient contract.
 * Shader contract (building.frag.glsl isDoorFace()):
 *   0 = South (+Z = face 4)
 *   1 = North (-Z = face 5)
 *   2 = East  (+X = face 0)
 *   3 = West  (-X = face 1)
 */
function orientToIndex(orient: BuildingOrient): number {
  switch (orient) {
    case BuildingOrient.South:
      return 0;
    case BuildingOrient.North:
      return 1;
    case BuildingOrient.East:
      return 2;
    case BuildingOrient.West:
      return 3;
    default:
      return 0; // fallback: South
  }
}

// ---------------------------------------------------------------------------
// Task 8: InstancedMesh creation
// ---------------------------------------------------------------------------

import buildingVertSrc from '../shaders/building.vert.glsl?raw';
import buildingFragSrc from '../shaders/building.frag.glsl?raw';
import hslGlslSrc from '../shaders/hsl.glsl?raw';

// Shared unit box geometry — all blocks reference the same geometry for
// the box vertices. Per-block attributes are attached to a CLONE of this
// geometry (see mesh.geometry = mesh.geometry.clone() below) so they
// don't bleed across blocks.
const _SHARED_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);

// Lazy singleton material — created once and reused across all blocks.
// applyManifest can be called multiple times (hot-reload); the singleton
// pattern ensures we don't accumulate materials on each rebuild.
let _sharedMaterial: THREE.ShaderMaterial | null = null;

// The icon atlas the buildings sample for roof glyphs. main.ts builds
// it after the initial manifest fetch and pushes it in via
// setIconAtlas before the first applyManifest, so the very first
// frame already has roof icons. Stays null while it's still loading
// or if the atlas build failed — the shader treats iconUV.x < 0 as
// "no icon" and just paints the base roof color.
let _atlas: IconAtlas | null = null;

export function setIconAtlas(atlas: IconAtlas | null): void {
  _atlas = atlas;
  if (_sharedMaterial) {
    _sharedMaterial.uniforms.uIconAtlas.value = atlas ? atlas.texture : null;
    _sharedMaterial.uniforms.uIconSlotSize.value = atlas ? atlas.slotSize : 0;
  }
}

function getBuildingMaterial(): THREE.ShaderMaterial {
  if (_sharedMaterial) return _sharedMaterial;
  // Inline the hsl helpers into the fragment source at the placeholder
  // comment the shader author left for exactly this purpose.
  const fragSrc = buildingFragSrc.replace('#include <hsl_glsl_inline>', hslGlslSrc);
  _sharedMaterial = new THREE.ShaderMaterial({
    vertexShader: buildingVertSrc,
    fragmentShader: fragSrc,
    // transparent: true so iOpacity can fade buildings (Task 11).
    transparent: true,
    uniforms: {
      // Hidden-tier wireframe thickness in screen-pixels. Updated by
      // refreshBuildingMaterial() on hot-reload.
      uOutlineWidth: { value: BUILDING_OUTLINE.get().WIDTH },
      // Atlas of file-type icons; sampled per-instance via iIconUV for
      // the roof face. Null until the atlas builds — the shader gates
      // sampling behind iIconUV.x >= 0.
      uIconAtlas: { value: _atlas ? _atlas.texture : null },
      uIconSlotSize: { value: _atlas ? _atlas.slotSize : 0 },
    },
  });
  return _sharedMaterial;
}

/**
 * applyTheme() coordinator hook: push fresh BUILDING_OUTLINE.WIDTH into
 * the shared building material's uOutlineWidth uniform so the Hidden-tier
 * wireframe thickness honors live config edits.
 */
export function refreshBuildingMaterial(): void {
  if (!_sharedMaterial) return;
  _sharedMaterial.uniforms.uOutlineWidth.value = BUILDING_OUTLINE.get().WIDTH;
}

/**
 * Create a THREE.InstancedMesh for all buildings in a block.
 *
 * One mesh per directory block; shared geometry + shader material.
 * Per-instance transforms (matrix), colors, and custom attributes
 * (iCols, iFloors, iOrient, iDoorWidth, iOpacity) are sourced from
 * buildBuildingInstanceBuffer.
 *
 * mesh.userData.kind = 'buildings' — used by the picker (Task 10).
 * mesh.userData.block = block       — back-pointer for the picker.
 */
export function createBuildingsInstancedMesh(block: SceneBlock): THREE.InstancedMesh {
  const n = block.buildings.length;
  const buf = buildBuildingInstanceBuffer(block);
  const mesh = new THREE.InstancedMesh(_SHARED_GEOMETRY, getBuildingMaterial(), n);

  // Apply the matrix buffer.
  const tmpM = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    tmpM.fromArray(buf.matrix, i * 16);
    mesh.setMatrixAt(i, tmpM);
  }
  mesh.instanceMatrix.needsUpdate = true;

  // Per-instance color via Three's built-in path (sets USE_INSTANCING_COLOR
  // on the shader automatically).
  mesh.instanceColor = new THREE.InstancedBufferAttribute(buf.color, 3);
  mesh.instanceColor.needsUpdate = true;

  // Clone geometry so per-block custom attributes don't bleed across blocks.
  // The shared _SHARED_GEOMETRY box vertices are still shared; only attribute
  // slots are per-block after the clone.
  mesh.geometry = mesh.geometry.clone();
  mesh.geometry.setAttribute('iCols', new THREE.InstancedBufferAttribute(buf.cols, 2));
  mesh.geometry.setAttribute('iFloors', new THREE.InstancedBufferAttribute(buf.floors, 1));
  mesh.geometry.setAttribute('iOrient', new THREE.InstancedBufferAttribute(buf.orient, 1));
  mesh.geometry.setAttribute('iDoorWidth', new THREE.InstancedBufferAttribute(buf.doorWidth, 1));
  mesh.geometry.setAttribute('iOpacity', new THREE.InstancedBufferAttribute(buf.opacity, 1));
  mesh.geometry.setAttribute(
    'iSilhouette',
    new THREE.InstancedBufferAttribute(buf.silhouette, 1),
  );
  mesh.geometry.setAttribute(
    'iOutlineOpacity',
    new THREE.InstancedBufferAttribute(buf.outlineOpacity, 1),
  );
  mesh.geometry.setAttribute('iIconUV', new THREE.InstancedBufferAttribute(buf.iconUV, 3));

  // Compute bounding sphere from instance positions for Three's frustum
  // culling (fires per-block since each InstancedMesh has its own sphere).
  mesh.computeBoundingSphere();

  // Tag for picker (Task 10) and block back-reference.
  mesh.userData.kind = 'buildings';
  mesh.userData.block = block;
  return mesh;
}
