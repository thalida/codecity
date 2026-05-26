// scene/instanced/buildingsCell.ts — Cell-aware building InstancedMesh
// factory. Replaces the per-block factory in buildings.ts for the
// spatial-grid rendering path.
//
// Geometry + material are constructed once at module load and shared
// across all cells; per-cell InstancedMeshes get a shallow geometry
// clone (so per-instance attributes don't bleed between cells) sharing
// the same vertex/index buffers via Three's BufferGeometry.clone()
// (only the InstancedBufferAttributes are duplicated, not the
// index/position buffers).

import * as THREE from 'three';
import { BUILDING_DIMENSIONS, FACADE_GEOMETRY } from '@/config/index.js';
import { BuildingOrient } from '@/types/index.js';
import buildingVertSrc from './building.vert.glsl?raw';
import buildingFragSrc from './building.frag.glsl?raw';
import type { CellTile } from '../../layout/cellTile.js';
import type { Building } from '@/types/index.js';
import type { IconAtlas } from './iconAtlas.js';
import { getFileIconName } from '@/views/widgets/fileIcon.js';
import { seedFromPath, attachLeanAwareRaycast } from './buildingTilt.js';

// ---------------------------------------------------------------------------
// Shared geometry — unit box, constructed once at module load and
// reused across all cells. Per-cell attributes are attached to a clone
// of this geometry (see attachBuildingMeshToCell) so they don't bleed.
// ---------------------------------------------------------------------------

const SHARED_BUILDING_GEOMETRY: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1);

// ---------------------------------------------------------------------------
// Helpers — ported faithfully from buildings.ts (private there).
// ---------------------------------------------------------------------------

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
// Material cache — one ShaderMaterial shared across all cells that use the
// same uniforms object identity. Memoized on the REFERENCE of the uniforms
// bag (callers pass the same object every time — see world.ts). This
// eliminates the per-cell ShaderMaterial + WebGL program compilation cost
// that was causing the tab to hang on large repos (289 cells × 2 materials
// = 578 ShaderMaterial allocations on enable toggle).
// ---------------------------------------------------------------------------

let _sharedBuildingMaterial: THREE.ShaderMaterial | null = null;
let _sharedBuildingMaterialUniforms: Record<string, THREE.IUniform> | null = null;

function getOrCreateBuildingMaterial(
  uniforms: Record<string, THREE.IUniform>
): THREE.ShaderMaterial {
  if (_sharedBuildingMaterial && _sharedBuildingMaterialUniforms === uniforms) {
    return _sharedBuildingMaterial;
  }
  // Chunks are registered via THREE.ShaderChunk in registerShaderChunks.ts;
  // Three.js's native preprocessor resolves #include <name> at compile time.
  const fragSrc = buildingFragSrc;
  _sharedBuildingMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: buildingVertSrc,
    fragmentShader: fragSrc,
    // transparent: true so iFade.x can fade buildings.
    transparent: true,
  });
  _sharedBuildingMaterialUniforms = uniforms;
  return _sharedBuildingMaterial;
}

// ---------------------------------------------------------------------------
// Icon atlas — module-level cache, mirroring the pattern in buildings.ts.
// main.ts pushes the atlas in after buildIconAtlas() resolves, before the
// first applyManifest call. If not set, iIconUV.xy stays (-1, -1) and the
// shader skips the atlas sample (no crash, just no roof icon).
// ---------------------------------------------------------------------------

let _atlas: IconAtlas | null = null;

/**
 * Register the icon atlas for this module's cell building factory.
 * Must be called (alongside buildings.ts's setIconAtlas) from main.ts
 * after buildIconAtlas() resolves so roof icons appear in cell mode.
 */
export function setCellIconAtlas(atlas: IconAtlas | null): void {
  _atlas = atlas;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replace the placeholder geometry + material in `cell.detailMesh` with
 * the real building shader geometry + material, and allocate per-instance
 * attribute buffers sized to `cell.capacity`.
 *
 * The shared unit-box geometry is cloned (shallow clone — vertex/index
 * buffers are not duplicated) so per-cell InstancedBufferAttributes don't
 * bleed across cells.
 *
 * The ShaderMaterial is shared across all cells that pass the same uniforms
 * object reference (identity-memoized). Do NOT call material.dispose() on
 * the returned mesh's material — it is owned by this module, not by the cell.
 * The mesh's `userData.sharedMaterial = true` flag signals the world
 * disposer to skip material disposal when tearing down the old cell root.
 *
 * Call this once per cell after `createEmptyCellTile`.
 */
export function attachBuildingMeshToCell(
  cell: CellTile,
  uniforms: Record<string, THREE.IUniform>
): void {
  const geom = SHARED_BUILDING_GEOMETRY.clone();

  // Per-instance attribute buffers sized to cell.capacity — matching
  // the attribute names and strides from buildings.ts / building.vert.glsl.
  // iCols: vec2 (cols_ew, cols_ns) — two floats per instance.
  geom.setAttribute(
    'iCols',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity * 2), 2)
  );
  // iFloors: float — one float per instance.
  geom.setAttribute(
    'iFloors',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1)
  );
  // iOrient: float — one float per instance (0=S, 1=N, 2=E, 3=W).
  geom.setAttribute(
    'iOrient',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1)
  );
  // iDoorWidth: float — one float per instance.
  geom.setAttribute(
    'iDoorWidth',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1)
  );
  // iFade: vec3 — three floats per instance (.x=opacity, .y=silhouette, .z=outlineOpacity).
  geom.setAttribute(
    'iFade',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity * 3), 3)
  );
  // iIconUV: vec4 — four floats per instance (.xy=atlas UV, .z=seed, .w=createdAge).
  geom.setAttribute(
    'iIconUV',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity * 4), 4)
  );
  // iModifiedAge: float — one float per instance.
  geom.setAttribute(
    'iModifiedAge',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1)
  );

  const mat = getOrCreateBuildingMaterial(uniforms);

  // Replace the placeholder mesh in-place.
  cell.detailMesh.geometry.dispose();
  cell.detailMesh.geometry = geom;
  cell.detailMesh.material = mat;
  // Signal to world's _disposeObject traversal that this material is
  // module-owned (shared) and must not be disposed when the cell root is
  // torn down between applyManifest calls.
  cell.detailMesh.userData.sharedMaterial = true;

  // instanceColor: three floats per instance (linear RGB).
  cell.detailMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(cell.capacity * 3),
    3
  );

  // Replace the default InstancedMesh raycast with one that honors the
  // vertex shader's Y-shear so click targets hit the leaned silhouette.
  // See scene/instanced/buildingTilt.ts.
  attachLeanAwareRaycast(cell.detailMesh);
}

/**
 * Write a building's per-instance attributes into the cell's InstancedMesh
 * at the slot identified by `b.slotId`. Both `b.cellId` and `b.slotId` must
 * already be set by the caller (typically the cell-insert path in
 * cellAssembly.ts).
 *
 * Per-instance attribute writes mirror buildBuildingInstanceBuffer() in
 * buildings.ts (the non-cell instanced path) — semantics are identical.
 * Callers must set `mesh.instanceMatrix.needsUpdate = true` (and
 * `mesh.instanceColor.needsUpdate = true`, attribute `.needsUpdate = true`)
 * after a batch of writes.
 */
export function writeBuildingToSlot(cell: CellTile, b: Building): void {
  const slot = b.slotId!;
  const mesh = cell.detailMesh;

  // --- Config snapshot (mirrors buildBuildingInstanceBuffer) ---
  const pathWidthFrac = BUILDING_DIMENSIONS.get().PATH_WIDTH_FRAC;
  const facade = FACADE_GEOMETRY.get();
  const windowColsMax = facade.WINDOW_COLS_MAX;
  const widthPerWindowCol = facade.WIDTH_PER_WINDOW_COL;
  const doorWidthFracOfPath = facade.DOOR_WIDTH_FRAC_OF_PATH;

  // --- Transform matrix ---
  // Layout (x, y) → scene (x, z); building.h is scene-Y.
  // Position y = h/2 so the base sits on z=0 (same convention as
  // createBuildingMesh and buildBuildingInstanceBuffer).
  const m = new THREE.Matrix4();
  m.makeScale(b.w, b.h, b.d);
  m.setPosition(b.x, b.h / 2, b.y);
  mesh.setMatrixAt(slot, m);

  // --- Color (linear RGB via Three.Color) ---
  const colorTmp = new THREE.Color();
  colorTmp.set(b.color);
  if (mesh.instanceColor) {
    mesh.instanceColor.setXYZ(slot, colorTmp.r, colorTmp.g, colorTmp.b);
  }

  // --- Window column counts ---
  // Mirror createBuildingMesh in engine.ts:
  //   ±X faces (east/west walls) span depth d → cols_ew from d
  //   ±Z faces (north/south walls) span width w → cols_ns from w
  const colsEW = Math.max(1, Math.min(windowColsMax, Math.floor(b.d / widthPerWindowCol)));
  const colsNS = Math.max(1, Math.min(windowColsMax, Math.floor(b.w / widthPerWindowCol)));
  const iColsAttr = mesh.geometry.getAttribute('iCols') as THREE.InstancedBufferAttribute;
  iColsAttr.setXY(slot, colsEW, colsNS);

  // --- Floor count ---
  const iFloorsAttr = mesh.geometry.getAttribute('iFloors') as THREE.InstancedBufferAttribute;
  iFloorsAttr.setX(slot, Math.max(1, b.floors ?? 1));

  // --- Orient encoding (shader: 0=S, 1=N, 2=E, 3=W) ---
  const iOrientAttr = mesh.geometry.getAttribute('iOrient') as THREE.InstancedBufferAttribute;
  iOrientAttr.setX(slot, orientToIndex(b.orient));

  // --- Door width ---
  // doorWorldWidth = building.w × PATH_WIDTH_FRAC × DOOR_WIDTH_FRAC_OF_PATH
  // Mirrors createBuildingMesh and buildBuildingInstanceBuffer.
  const iDoorWidthAttr = mesh.geometry.getAttribute('iDoorWidth') as THREE.InstancedBufferAttribute;
  iDoorWidthAttr.setX(slot, b.w * pathWidthFrac * doorWidthFracOfPath);

  // --- Fade (opacity defaults to 1.0; silhouette + outlineOpacity default to 0) ---
  const iFadeAttr = mesh.geometry.getAttribute('iFade') as THREE.InstancedBufferAttribute;
  iFadeAttr.setXYZ(slot, 1.0, 0.0, 0.0);

  // --- Icon UV (top-left of atlas slot) + per-instance seed + createdAge ---
  // (-1, -1) on .xy means "no icon" — shader checks .x < 0 and skips the
  // atlas sample. Seed on .z; createdAge on .w.
  // Mirror the lookup pattern from buildings.ts: if the module-level atlas
  // is available and the file has a known icon, write the resolved UV;
  // otherwise fall back to the (-1, -1) sentinel.
  const seed = seedFromPath(b.file?.path ?? '');
  const iIconUVAttr = mesh.geometry.getAttribute('iIconUV') as THREE.InstancedBufferAttribute;
  let iconU = -1.0;
  let iconV = -1.0;
  if (_atlas && b.file) {
    const iconName = getFileIconName(b.file);
    const uv = _atlas.uvFor(iconName);
    if (uv) {
      iconU = uv[0];
      iconV = uv[1];
    }
  }
  iIconUVAttr.setXYZW(slot, iconU, iconV, seed, b.createdAge ?? 0);

  // --- Modified age ---
  const iModifiedAgeAttr = mesh.geometry.getAttribute(
    'iModifiedAge'
  ) as THREE.InstancedBufferAttribute;
  iModifiedAgeAttr.setX(slot, b.modifiedAge ?? 0);
}
