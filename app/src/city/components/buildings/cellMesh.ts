// city/components/buildings/cellMesh.ts — Cell-aware building InstancedMesh
// factory.
//
// Geometry is constructed once at module load and shared across all
// cells; the material is created lazily on the first
// attachBuildingMeshToCell call with the caller's uniforms and then
// shared. Per-cell InstancedMeshes get a shallow geometry clone (so
// per-instance attributes don't bleed between cells) sharing the same
// vertex/index buffers via Three's BufferGeometry.clone() (only the
// InstancedBufferAttributes are duplicated, not the index/position
// buffers).

import * as THREE from 'three';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { BuildingOrient } from '@/types/index';
import type { CellTile } from './cellTile';
import type { Building } from '@/types/index';
import { getBuildingMaterial, getIconAtlas } from './material';
import { getFileIconName } from '@/utils/fileIcons';
import { seedFromPath, getBuildingTilt, composeShearMatrix } from './tilt';

// ---------------------------------------------------------------------------
// Shared geometry — unit box, constructed once at module load and
// reused across all cells. Per-cell attributes are attached to a clone
// of this geometry (see attachBuildingMeshToCell) so they don't bleed.
// ---------------------------------------------------------------------------

const SHARED_BUILDING_GEOMETRY: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1);

// Scratch for composing each building's sheared instance matrix (writeBuildingToSlot
// is called once per building on a rebuild — reuse instead of allocating each call).
const _writePos = new THREE.Vector3();
const _writeScale = new THREE.Vector3();
const _writeMatrix = new THREE.Matrix4();

// ---------------------------------------------------------------------------
// Helpers
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
 * Every cell shares the one ShaderMaterial from material.getBuildingMaterial().
 * Do NOT call material.dispose() on the returned mesh's material — it is owned
 * by material.ts, not by the cell. The mesh's `userData.sharedMaterial = true`
 * flag tells the shared disposeObject3D util (city/utils/disposeObject3D.ts) to
 * skip material disposal when tearing down the old cell root.
 *
 * Call this once per cell after `createEmptyCellTile`.
 */
export function attachBuildingMeshToCell(cell: CellTile): void {
  const geom = SHARED_BUILDING_GEOMETRY.clone();

  // Per-instance attribute buffers sized to cell.capacity — matching
  // the attribute names and strides declared in building.vert.glsl.
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
  // iRuin: float — 0 normally, 1 for a Timeline ghost-ruin (crumbled top in the
  // frag), 2 for a future slab (blank). Live mode never writes it (stays 0). 16th
  // vertex attribute — the WebGL2 minimum; any further attribute must pack into an
  // existing one.
  geom.setAttribute(
    'iRuin',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1)
  );

  const mat = getBuildingMaterial();

  // Replace the placeholder mesh in-place.
  cell.detailMesh.geometry.dispose();
  cell.detailMesh.geometry = geom;
  cell.detailMesh.material = mat;
  // Signal to the shared disposeObject3D util that this material is
  // module-owned (shared) and must not be disposed when the cell root is
  // torn down between applyManifest calls.
  cell.detailMesh.userData.sharedMaterial = true;

  // instanceColor: three floats per instance (linear RGB).
  cell.detailMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(cell.capacity * 3),
    3
  );

}

/**
 * Write a building's per-instance attributes into the cell's InstancedMesh
 * at the slot identified by `b.slotId`. Both `b.cellId` and `b.slotId` must
 * already be set by the caller (typically the cell-insert path in
 * cellAssembly.ts).
 *
 * Per-instance attribute semantics follow the building.vert.glsl attribute
 * contract (iCols, iFloors, iOrient, iDoorWidth, iFade, iIconUV, iModifiedAge).
 * Callers must set `mesh.instanceMatrix.needsUpdate = true` (and
 * `mesh.instanceColor.needsUpdate = true`, attribute `.needsUpdate = true`)
 * after a batch of writes.
 */
export function writeBuildingToSlot(cell: CellTile, b: Building): void {
  const slot = b.slotId!;
  const mesh = cell.detailMesh;

  // --- Config snapshot (read once per write, not per attribute) ---
  const facade = BUILDINGS.value;
  const windowColsMax = facade.WINDOW_COLS_MAX;
  const widthPerWindowCol = facade.WIDTH_PER_WINDOW_COL;
  const doorWidthFrac = facade.DOOR_WIDTH_FRAC;

  // --- Transform matrix (scale + translate + age-lean shear) ---
  // Layout (x, y) → scene (x, z); building.h is scene-Y. Position y = h/2 so the
  // base sits on z=0. The lean is baked in as a Y-driven XZ shear (see tilt.ts)
  // so the render, outline, and picker all read one sheared matrix.
  const { tiltX, tiltZ } = getBuildingTilt(b);
  _writePos.set(b.x, b.h / 2, b.y);
  _writeScale.set(b.w, b.h, b.d);
  composeShearMatrix(_writePos, _writeScale, tiltX, tiltZ, _writeMatrix);
  mesh.setMatrixAt(slot, _writeMatrix);

  // --- Color (linear RGB via Three.Color) ---
  const colorTmp = new THREE.Color();
  colorTmp.set(b.color);
  if (mesh.instanceColor) {
    mesh.instanceColor.setXYZ(slot, colorTmp.r, colorTmp.g, colorTmp.b);
  }

  // --- Window column counts ---
  // Window-column convention:
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
  // doorWorldWidth = building.w × DOOR_WIDTH_FRAC
  const iDoorWidthAttr = mesh.geometry.getAttribute('iDoorWidth') as THREE.InstancedBufferAttribute;
  iDoorWidthAttr.setX(slot, b.w * doorWidthFrac);

  // --- Fade (opacity defaults to 1.0; silhouette + outlineOpacity default to 0) ---
  const iFadeAttr = mesh.geometry.getAttribute('iFade') as THREE.InstancedBufferAttribute;
  iFadeAttr.setXYZ(slot, 1.0, 0.0, 0.0);

  // --- Icon UV (top-left of atlas slot) + per-instance seed + createdAge ---
  // (-1, -1) on .xy means "no icon" — shader checks .x < 0 and skips the
  // atlas sample. Seed on .z; createdAge on .w.
  // If the atlas (material.ts's single ref) is available and the file has a
  // known icon, write the resolved UV; otherwise fall back to (-1, -1).
  const seed = seedFromPath(b.file?.path ?? '');
  const iIconUVAttr = mesh.geometry.getAttribute('iIconUV') as THREE.InstancedBufferAttribute;
  let iconU = -1.0;
  let iconV = -1.0;
  const atlas = getIconAtlas();
  if (atlas && b.file) {
    const iconName = getFileIconName(b.file);
    const uv = atlas.uvFor(iconName);
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
