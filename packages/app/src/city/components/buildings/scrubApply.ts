// Resolved scrub states into GPU writes. The buildings component owns its
// meshes and buffers, so this is the only place that reaches them.

import * as THREE from 'three';

import type { Building } from '@/types';
import type { InstancedFacadePanels } from './facadePanels';
import type { BuildingIndex } from './buildingIndex';
import { BuildingLane, type BuildingScrubState } from './scrubState';
import type { BuildingMaterial } from './material';

export interface BuildingScrubApplyCtx {
  getBuildingIndex(): BuildingIndex | null;
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
  getFacadePanels(): InstancedFacadePanels | null;
  material: BuildingMaterial;
}

function attr(mesh: THREE.InstancedMesh, name: string): THREE.BufferAttribute | undefined {
  return mesh.geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
}

export function createBuildingScrubApply(ctx: BuildingScrubApplyCtx) {
  const _m = new THREE.Matrix4();
  const _SCRUB_QUAT = new THREE.Quaternion();
  const _pos = new THREE.Vector3();
  const _scale = new THREE.Vector3();
  const _color = new THREE.Color();
  const _toward = new THREE.Color();

  // Flags each shared buffer for re-upload once a frame, and clears, or a
  // rebuild's disposed cells linger in it.
  const _meshes = new Set<THREE.InstancedMesh>();
  const _colors = new Set<THREE.InstancedMesh>();
  const _attrs = new Set<THREE.BufferAttribute>();

  // Absent never counts: scaled to nothing, so it rasterizes no fragments and
  // its bodyOp can't need blending. See setBuildingsTranslucent.
  let _anyTranslucent = false;

  function writeOne(b: Building, s: BuildingScrubState): void {
    const resolved = ctx.getMeshForBuilding(b);
    if (!resolved) return;
    const { mesh, slot } = resolved;

    if (s.lane === BuildingLane.Absent) {
      // Not a flat (w, 0, d) quad, which would still write depth and outline as
      // a cutout on the road.
      _m.makeScale(0, 0, 0);
    } else {
      _pos.set(b.x, s.height / 2, b.y);
      _scale.set(b.w, s.height, b.d);
      _m.compose(_pos, _SCRUB_QUAT, _scale);
    }
    mesh.setMatrixAt(slot, _m);
    _meshes.add(mesh);

    const iKind = attr(mesh, 'iKind');
    if (iKind) {
      iKind.setX(slot, s.kind);
      _attrs.add(iKind);
    }

    const iFade = attr(mesh, 'iFade');
    if (iFade) {
      iFade.setXYZ(slot, s.bodyOp, s.silhouette, s.outlineOp);
      _attrs.add(iFade);
      if (s.lane !== BuildingLane.Absent && s.bodyOp < 1) _anyTranslucent = true;
    }

    // Already faded to 0, so its shape and colour buffers stay as they are.
    if (s.lane === BuildingLane.Absent) return;

    const iFloors = attr(mesh, 'iFloors');
    if (iFloors) {
      iFloors.setX(slot, s.floors);
      _attrs.add(iFloors);
    }

    _color.set(s.colorBase);
    if (s.colorToward) {
      _color.lerp(_toward.setRGB(s.colorToward.r, s.colorToward.g, s.colorToward.b), s.colorMix);
    }
    mesh.setColorAt(slot, _color);
    _colors.add(mesh);

    if (s.lane !== BuildingLane.Present) return;

    const iModifiedAge = attr(mesh, 'iModifiedAge');
    if (iModifiedAge) {
      iModifiedAge.setX(slot, s.modifiedAge);
      _attrs.add(iModifiedAge);
    }

    const iIconUV = attr(mesh, 'iIconUV');
    if (iIconUV) {
      iIconUV.setW(slot, s.createdAge);
      _attrs.add(iIconUV);
    }
  }

  return function applyScrub(states: ReadonlyMap<string, BuildingScrubState>): void {
    _meshes.clear();
    _colors.clear();
    _attrs.clear();
    _anyTranslucent = false;

    const index = ctx.getBuildingIndex();
    if (index) {
      for (const [path, s] of states) {
        const b = index.byPath.get(path);
        if (b) writeOne(b, s);
      }
    }

    for (const mesh of _meshes) mesh.instanceMatrix.needsUpdate = true;
    for (const mesh of _colors) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const a of _attrs) a.needsUpdate = true;

    ctx.material.setTranslucent(_anyTranslucent);

    // 0, not null: Live's fader reads null as leave-untouched, which would
    // strand an undriven panel at its shown default.
    ctx.getFacadePanels()?.applyBuildingFades((p) => {
      const s = states.get(p);
      return s && s.lane === BuildingLane.Present ? s.bodyOp : 0;
    });
  };
}
