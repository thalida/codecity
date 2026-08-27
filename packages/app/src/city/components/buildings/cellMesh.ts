// city/components/buildings/cellMesh.ts — the per-cell building InstancedMesh.
// One geometry and one material for the whole city; each cell takes a shallow
// clone so its per-instance attributes don't bleed into the others, while the
// vertex and index buffers stay shared.

import * as THREE from 'three';
import { BUILDINGS } from '@/state/settings/fields/buildings';
import { BuildingOrient } from '@codecity/city';
import type { CellTile } from './cellTile';
import type { Building } from '@codecity/city';
import type { BuildingMaterial } from './material';
import { getFileIconName } from '@/utils/fileIcons';
import { isDataBuilding, isEmptyFile, isUnmeasuredFile } from '@/utils/fileKind';
import { BuildingKind } from './buildingKind';
import { seedFromPath } from './seed';
import { getBuildingColorForRecency } from './color';

// The unit box every building scales from, built once.

const SHARED_BUILDING_GEOMETRY: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1);

// Scratch for composing each building's sheared instance matrix (writeBuildingToSlot
// is called once per building on a rebuild — reuse instead of allocating each call).
const _writePos = new THREE.Vector3();
const _writeScale = new THREE.Vector3();
const _writeMatrix = new THREE.Matrix4();
// Buildings are axis-aligned: one identity rotation serves every compose.
const _WRITE_QUAT = new THREE.Quaternion();
const _writeColor = new THREE.Color();

/** The orientation as the shader's iDoor.x wants it: 0 south, 1 north, 2 east,
 *  3 west (see isDoorFace in building.frag.glsl). */
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

/** Give a cell the real geometry, the shared material, and attribute buffers
 *  for its capacity. The material belongs to material.ts: never dispose it. */
export function attachBuildingMeshToCell(cell: CellTile, material: BuildingMaterial): void {
  const geom = SHARED_BUILDING_GEOMETRY.clone();

  // Names and strides match the attributes building.vert.glsl declares.
  geom.setAttribute(
    'iCols',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity * 2), 2)
  );
  // iFloors: float — one float per instance.
  geom.setAttribute(
    'iFloors',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1)
  );
  // iDoor: vec2 — (.x=orient 0=S/1=N/2=E/3=W, .y=door world-width).
  geom.setAttribute(
    'iDoor',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity * 2), 2)
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
  // iKind: float render-mode enum (see BuildingKind) — Normal, Data (windowless
  // binary), or Ruin written by Timeline.
  geom.setAttribute(
    'iKind',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity), 1)
  );
  // iRefColor: vec3 — un-aged colour for the roof border. 16th attribute (WebGL2 cap).
  geom.setAttribute(
    'iRefColor',
    new THREE.InstancedBufferAttribute(new Float32Array(cell.capacity * 3), 3)
  );

  const mat = material.get();

  // Replace the placeholder mesh in-place.
  cell.detailMesh.geometry.dispose();
  cell.detailMesh.geometry = geom;
  cell.detailMesh.material = mat;
  // Tells disposeObject3D to leave the material alone: it outlives this cell.
  cell.detailMesh.userData.sharedMaterial = true;

  // instanceColor: three floats per instance (linear RGB).
  cell.detailMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(cell.capacity * 3),
    3
  );
}

/** One building's attributes into its slot. cellId and slotId must be set, and
 *  the caller flags the buffers dirty once per batch rather than per write. */
export function writeBuildingToSlot(cell: CellTile, b: Building, material: BuildingMaterial): void {
  const slot = b.slotId!;
  const mesh = cell.detailMesh;

  // --- Config snapshot (read once per write, not per attribute) ---
  const facade = BUILDINGS.value;
  const windowColsMax = facade.WINDOW_COLS_MAX;
  const widthPerWindowCol = facade.WIDTH_PER_WINDOW_COL;
  const doorWidthFrac = facade.DOOR_WIDTH_FRAC;

  // Layout (x, y) is scene (x, z); y is h/2 so the base sits on the ground.
  _writePos.set(b.x, b.h / 2, b.y);
  _writeScale.set(b.w, b.h, b.d);
  _writeMatrix.compose(_writePos, _WRITE_QUAT, _writeScale);
  mesh.setMatrixAt(slot, _writeMatrix);

  // --- Color (linear RGB via Three.Color) ---
  _writeColor.set(b.color);
  if (mesh.instanceColor) {
    mesh.instanceColor.setXYZ(slot, _writeColor.r, _writeColor.g, _writeColor.b);
  }

  // --- Reference color: recency 1 = the fresh end of the b.color curve ---
  _writeColor.set(
    getBuildingColorForRecency(
      b.file as unknown as Parameters<typeof getBuildingColorForRecency>[0],
      1
    )
  );
  const iRefColorAttr = mesh.geometry.getAttribute('iRefColor') as THREE.InstancedBufferAttribute;
  iRefColorAttr.setXYZ(slot, _writeColor.r, _writeColor.g, _writeColor.b);

  // East/west walls span depth, north/south span width.
  const colsEW = Math.max(1, Math.min(windowColsMax, Math.floor(b.d / widthPerWindowCol)));
  const colsNS = Math.max(1, Math.min(windowColsMax, Math.floor(b.w / widthPerWindowCol)));
  const iColsAttr = mesh.geometry.getAttribute('iCols') as THREE.InstancedBufferAttribute;
  iColsAttr.setXY(slot, colsEW, colsNS);

  // --- Floor count ---
  const iFloorsAttr = mesh.geometry.getAttribute('iFloors') as THREE.InstancedBufferAttribute;
  iFloorsAttr.setX(slot, Math.max(1, b.floors ?? 1));

  // --- Door: orient (0=S, 1=N, 2=E, 3=W) + world-width ---
  const iDoorAttr = mesh.geometry.getAttribute('iDoor') as THREE.InstancedBufferAttribute;
  iDoorAttr.setXY(slot, orientToIndex(b.orient), b.w * doorWidthFrac);

  // Empty first, so a 0-byte binary is a slab rather than a data block, which
  // is the precedence getBuildingDimensions uses.
  const iKindAttr = mesh.geometry.getAttribute('iKind') as THREE.InstancedBufferAttribute;
  let kind: number = BuildingKind.Normal;
  // Before the others: with no size there is nothing to call it empty or data
  // by, and guessing either would be the zero this replaced.
  if (isUnmeasuredFile(b.file)) kind = BuildingKind.Unmeasured;
  else if (isEmptyFile(b.file)) kind = BuildingKind.Empty;
  else if (isDataBuilding(b.file)) kind = BuildingKind.Data;
  iKindAttr.setX(slot, kind);

  // --- Fade (opacity defaults to 1.0; silhouette + outlineOpacity default to 0) ---
  const iFadeAttr = mesh.geometry.getAttribute('iFade') as THREE.InstancedBufferAttribute;
  iFadeAttr.setXYZ(slot, 1.0, 0.0, 0.0);

  // (-1, -1) means no icon: the shader checks .x and skips the atlas sample.
  const seed = seedFromPath(b.file?.path ?? '');
  const iIconUVAttr = mesh.geometry.getAttribute('iIconUV') as THREE.InstancedBufferAttribute;
  let iconU = -1.0;
  let iconV = -1.0;
  const atlas = material.getIconAtlas();
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
