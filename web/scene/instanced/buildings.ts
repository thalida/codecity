// scene/instanced/buildings.ts — per-block building instance buffer builder.
//
// Pure function; no Three.js scene mutation, no DOM, no async.
// Mesh creation (attaching these buffers to a THREE.InstancedMesh) lands in Task 8.

import * as THREE from 'three';
import { BUILDING_DIMENSIONS } from '@/config/index.js';
import { BuildingOrient } from '@/types/index.js';
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
  };

  const m = new THREE.Matrix4();
  const colorTmp = new THREE.Color();
  // PATH_WIDTH_FRAC is user-tunable via the BUILDING_DIMENSIONS nanostore.
  // Read once per buffer build so all buildings in the block use the same
  // config snapshot (consistent with how engine.ts reads it per-building).
  const pathWidthFrac = BUILDING_DIMENSIONS.get().PATH_WIDTH_FRAC;

  for (let i = 0; i < n; i++) {
    const b = block.buildings[i];

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
  }

  return buf;
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
  });
  return _sharedMaterial;
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

  // Compute bounding sphere from instance positions for Three's frustum
  // culling (fires per-block since each InstancedMesh has its own sphere).
  mesh.computeBoundingSphere();

  // Build a BVH on the cloned geometry so picker raycasts go from O(N
  // instances) to O(log N). three-mesh-bvh installed via main.ts boot.
  // Method is augmented onto BufferGeometry.prototype but not in Three's
  // type declarations, so cast for the call site.
  const geomWithBvh = mesh.geometry as unknown as { computeBoundsTree?: () => void };
  if (typeof geomWithBvh.computeBoundsTree === 'function') {
    geomWithBvh.computeBoundsTree();
  }

  // Tag for picker (Task 10) and block back-reference.
  mesh.userData.kind = 'buildings';
  mesh.userData.block = block;
  return mesh;
}
