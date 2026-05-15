// scene/instanced/buildings.ts — per-block building instance buffer builder.
//
// Pure function; no Three.js scene mutation, no DOM, no async.
// Mesh creation (attaching these buffers to a THREE.InstancedMesh) lands in Task 8.

import * as THREE from 'three';
import {
  BLOOM,
  BUILDING_AGING,
  BUILDING_DIMENSIONS,
  BUILDING_OUTLINE,
  BUILDING_PALETTE,
  FACADE_GEOMETRY,
  LIGHTING,
  SCENE_COLORS,
} from '@/config/index.js';
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
// Per-instance facade attributes (window column count + door width) are
// sourced from the FACADE_GEOMETRY store. The shader-side keys
// (SLAB/WINDOW/DOOR/ROOF_*_FRAC) are pushed through uniforms — see
// refreshBuildingMaterial(); the JS-side keys read below feed into baked
// per-instance attributes, so changes to them trigger a full rebuild via
// hotReload.ts.
// ---------------------------------------------------------------------------

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
    iconUV: new Float32Array(n * 4),
  };

  const m = new THREE.Matrix4();
  const colorTmp = new THREE.Color();
  // PATH_WIDTH_FRAC is user-tunable via the BUILDING_DIMENSIONS nanostore.
  // Read once per buffer build so all buildings in the block use the same
  // config snapshot (consistent with how engine.ts reads it per-building).
  const pathWidthFrac = BUILDING_DIMENSIONS.get().PATH_WIDTH_FRAC;
  // Facade-geometry knobs that bake into per-instance attributes. Same
  // snapshot pattern as PATH_WIDTH_FRAC — one read per block so every
  // building in the block sees consistent values.
  const facade = FACADE_GEOMETRY.get();
  const windowColsMax = facade.WINDOW_COLS_MAX;
  const widthPerWindowCol = facade.WIDTH_PER_WINDOW_COL;
  const doorWidthFracOfPath = facade.DOOR_WIDTH_FRAC_OF_PATH;

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
      buf.iconUV[i * 4 + 0] = -1.0;
      buf.iconUV[i * 4 + 1] = -1.0;
      buf.iconUV[i * 4 + 2] = seed;
      buf.iconUV[i * 4 + 3] = b.createdAge ?? 0;
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
      Math.min(windowColsMax, Math.floor(b.d / widthPerWindowCol)),
    );
    const colsNS = Math.max(
      1,
      Math.min(windowColsMax, Math.floor(b.w / widthPerWindowCol)),
    );
    buf.cols[i * 2 + 0] = colsEW;
    buf.cols[i * 2 + 1] = colsNS;

    // --- Floor count ---
    buf.floors[i] = Math.max(1, b.floors ?? 1);

    // --- Orient encoding (shader: 0=S, 1=N, 2=E, 3=W) ---
    buf.orient[i] = orientToIndex(b.orient);

    // --- Door width ---
    // doorWorldWidth = building.w × PATH_WIDTH_FRAC × DOOR_WIDTH_FRAC_OF_PATH
    // Mirrors createBuildingMesh:
    //   const doorWorldWidth = w * BUILDING_DIMENSIONS.get().PATH_WIDTH_FRAC * DOOR_WIDTH_FRAC_OF_PATH;
    buf.doorWidth[i] = b.w * pathWidthFrac * doorWidthFracOfPath;

    // --- Opacity (default 1.0; fader updates in-place at runtime) ---
    buf.opacity[i] = 1.0;

    // --- Icon UV (top-left of slot in atlas) + per-instance seed + createdAge ---
    // (-1, -1) on .xy means "no icon" — the shader checks .x < 0 and
    // skips the atlas sample. The seed lands on .z; createdAge on .w
    // (0 = newest file, 1 = oldest, normalized against repo's
    // createdMin/Max). All four packed into one attribute to stay
    // under the GL_MAX_VERTEX_ATTRIBS=16 cap.
    buf.iconUV[i * 4 + 0] = -1.0;
    buf.iconUV[i * 4 + 1] = -1.0;
    buf.iconUV[i * 4 + 2] = seed;
    buf.iconUV[i * 4 + 3] = b.createdAge ?? 0;
    if (_atlas) {
      const file = b.file;
      if (file) {
        const iconName = getFileIconName(file);
        const uv = _atlas.uvFor(iconName);
        if (uv) {
          buf.iconUV[i * 4 + 0] = uv[0];
          buf.iconUV[i * 4 + 1] = uv[1];
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

// Half-fall-off height for ground haze, in world units. Computed as
// FOG_HEIGHT_FRAC × the tallest possible building (MAX_FLOORS × FLOOR_HEIGHT)
// so the haze sits in the same relative band of the skyline regardless
// of how the user has tuned building sizes.
function _computeFogHeight(): number {
  const dims = BUILDING_DIMENSIONS.get();
  const maxHeight = Math.max(1, dims.MAX_FLOORS * dims.FLOOR_HEIGHT);
  return SCENE_COLORS.get().FOG_HEIGHT_FRAC * maxHeight;
}

/**
 * Convert LIGHTING's spherical (azimuth, elevation) into a unit world-space
 * direction TOWARD the sun and write it onto `out`.
 *
 * Convention: azimuth=0 points along +Z (south), increasing clockwise (so
 * azimuth=90 points along +X / east); elevation=0 is on the horizon,
 * elevation=90 is directly overhead (+Y). This reproduces the prior
 * hard-coded `normalize(vec3(0.5, 1.0, 0.4))` at the default
 * (az=51°, el=58°) to within rounding.
 */
function _writeSunDir(out: THREE.Vector3): void {
  const lighting = LIGHTING.get();
  const az = (lighting.SUN_AZIMUTH_DEG * Math.PI) / 180;
  const el = (lighting.SUN_ELEVATION_DEG * Math.PI) / 180;
  const cosEl = Math.cos(el);
  out.set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl).normalize();
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
      // Palette lightness range (HSL %, 0–100 domain). The shader
      // recovers a 0..1 "freshness" signal by reading HSL lightness
      // out of the per-instance base color and normalising against
      // this range — newest file = 1.0, oldest = 0.0. Used to drive
      // window lit/dark count, glow brightness, glow hue, and gap
      // density. Refreshed on live-config edits.
      uLightnessMin: { value: BUILDING_PALETTE.get().LIGHTNESS_MIN },
      uLightnessMax: { value: BUILDING_PALETTE.get().LIGHTNESS_MAX },
      // Ground-haze uniforms — height-based volumetric fog applied
      // in the building shader. Independent of camera distance.
      uFogColor: { value: new THREE.Color(SCENE_COLORS.get().FOG_COLOR) },
      uFogIntensity: { value: SCENE_COLORS.get().FOG_INTENSITY },
      uFogHeight: { value: _computeFogHeight() },
      // Extra HDR emission applied to the freshest building's lit
      // windows on top of a baseline 1.0. 0 = no bloom contribution
      // from windows; higher = brighter glow on new buildings.
      uWindowEmissionBoost: { value: BLOOM.get().WINDOW_EMISSION },
      // Age-driven decay uniforms (createdAge-gated, independent of
      // color/freshness). See BUILDING_AGING config.
      uGrimeIntensity: {
        value: BUILDING_AGING.get().GRIME_ENABLED ? BUILDING_AGING.get().GRIME_INTENSITY : 0,
      },
      uGrimeCoverage: { value: BUILDING_AGING.get().GRIME_COVERAGE },
      uTiltMaxRad: {
        value: BUILDING_AGING.get().TILT_ENABLED
          ? (BUILDING_AGING.get().TILT_DEGREES * Math.PI) / 180
          : 0,
      },
      // Scene directional lighting (LIGHTING store). uSunDirWorld is
      // re-initialised below from the current LIGHTING values so the
      // first frame already has the configured sun direction; the
      // ambient and contrast scalars are seeded inline.
      uSunDirWorld: { value: new THREE.Vector3() },
      uAmbient: { value: LIGHTING.get().AMBIENT },
      uSunContrast: { value: LIGHTING.get().SUN_CONTRAST },
      // Procedural facade geometry (FACADE_GEOMETRY store). Seeded from
      // the current store snapshot so the first frame renders with the
      // configured values; refreshBuildingMaterial() pushes updates on
      // hot-reload. Only the shader-side keys appear here — the JS-side
      // keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC_OF_PATH)
      // bake into per-instance attributes in buildBuildingInstanceBuffer above.
      uSlabHeightFrac: { value: FACADE_GEOMETRY.get().SLAB_HEIGHT_FRAC },
      uWindowWidthFrac: { value: FACADE_GEOMETRY.get().WINDOW_WIDTH_FRAC },
      uWindowHeightFrac: { value: FACADE_GEOMETRY.get().WINDOW_HEIGHT_FRAC },
      uWindowMarginFrac: { value: FACADE_GEOMETRY.get().WINDOW_MARGIN_FRAC },
      uDoorHeightFrac: { value: FACADE_GEOMETRY.get().DOOR_HEIGHT_FRAC },
      uRoofBorderFrac: { value: FACADE_GEOMETRY.get().ROOF_BORDER_FRAC },
    },
  });
  _writeSunDir(_sharedMaterial.uniforms.uSunDirWorld.value as THREE.Vector3);
  return _sharedMaterial;
}

/**
 * applyTheme() coordinator hook: push fresh BUILDING_OUTLINE.WIDTH into
 * the shared building material's uOutlineWidth uniform so the Hidden-tier
 * wireframe thickness honors live config edits.
 */
export function refreshBuildingMaterial(): void {
  if (!_sharedMaterial) return;
  const sceneCfg = SCENE_COLORS.get();
  const bloomCfg = BLOOM.get();
  _sharedMaterial.uniforms.uOutlineWidth.value = BUILDING_OUTLINE.get().WIDTH;
  _sharedMaterial.uniforms.uLightnessMin.value = BUILDING_PALETTE.get().LIGHTNESS_MIN;
  _sharedMaterial.uniforms.uLightnessMax.value = BUILDING_PALETTE.get().LIGHTNESS_MAX;
  (_sharedMaterial.uniforms.uFogColor.value as THREE.Color).set(sceneCfg.FOG_COLOR);
  // FOG_ENABLED gates intensity at the uniform level; the shader logic
  // is unchanged (fogAmount → 0 when intensity is 0, mix() is a no-op).
  _sharedMaterial.uniforms.uFogIntensity.value = sceneCfg.FOG_ENABLED ? sceneCfg.FOG_INTENSITY : 0;
  _sharedMaterial.uniforms.uFogHeight.value = _computeFogHeight();
  // BLOOM.ENABLED off → no HDR push for windows, so they stay LDR and
  // produce nothing the bloom pass (also bypassed via postFx.refresh)
  // could pick up.
  _sharedMaterial.uniforms.uWindowEmissionBoost.value = bloomCfg.ENABLED ? bloomCfg.WINDOW_EMISSION : 0;
  const aging = BUILDING_AGING.get();
  _sharedMaterial.uniforms.uGrimeIntensity.value = aging.GRIME_ENABLED ? aging.GRIME_INTENSITY : 0;
  _sharedMaterial.uniforms.uGrimeCoverage.value = aging.GRIME_COVERAGE;
  _sharedMaterial.uniforms.uTiltMaxRad.value = aging.TILT_ENABLED
    ? (aging.TILT_DEGREES * Math.PI) / 180
    : 0;
  // Scene directional lighting (LIGHTING store).
  const lighting = LIGHTING.get();
  _writeSunDir(_sharedMaterial.uniforms.uSunDirWorld.value as THREE.Vector3);
  _sharedMaterial.uniforms.uAmbient.value = lighting.AMBIENT;
  _sharedMaterial.uniforms.uSunContrast.value = lighting.SUN_CONTRAST;
  // Procedural facade geometry (FACADE_GEOMETRY store) — shader-side keys.
  // The JS-side keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC_OF_PATH) require a full
  // rebuild because they bake into per-instance attributes; hotReload.ts
  // routes the whole store through scheduleRebuild so the uniforms here
  // are kept fresh on the next rebuild without separate plumbing.
  const facade = FACADE_GEOMETRY.get();
  _sharedMaterial.uniforms.uSlabHeightFrac.value = facade.SLAB_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uWindowWidthFrac.value = facade.WINDOW_WIDTH_FRAC;
  _sharedMaterial.uniforms.uWindowHeightFrac.value = facade.WINDOW_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uWindowMarginFrac.value = facade.WINDOW_MARGIN_FRAC;
  _sharedMaterial.uniforms.uDoorHeightFrac.value = facade.DOOR_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uRoofBorderFrac.value = facade.ROOF_BORDER_FRAC;
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
  mesh.geometry.setAttribute('iIconUV', new THREE.InstancedBufferAttribute(buf.iconUV, 4));

  // Compute bounding sphere from instance positions, then expand the
  // radius to cover the worst-case lateral displacement the tilt
  // shader can produce. Without this, a tilted building can render
  // OUTSIDE its un-tilted bbox; Three's frustum culling then drops
  // the whole InstancedMesh as soon as the un-tilted box just clears
  // the frustum, even though tilted geometry is still on screen —
  // which manifests as flickering / black flashes when the camera
  // rotates or zooms past a tilted block.
  mesh.computeBoundingSphere();
  if (mesh.geometry.boundingSphere) {
    const dims = BUILDING_DIMENSIONS.get();
    const aging = BUILDING_AGING.get();
    const maxH = dims.MAX_FLOORS * dims.FLOOR_HEIGHT;
    const maxTiltRad = aging.TILT_ENABLED ? (aging.TILT_DEGREES * Math.PI) / 180 : 0;
    // Worst case: tilt magnitude × tallest building height (lateral
    // shift at the top of the building). Pad generously.
    mesh.geometry.boundingSphere.radius += maxH * maxTiltRad;
  }

  // Tag for picker (Task 10) and block back-reference.
  mesh.userData.kind = 'buildings';
  mesh.userData.block = block;
  return mesh;
}
