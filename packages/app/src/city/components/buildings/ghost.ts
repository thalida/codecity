// city/components/buildings/ghost.ts — one translucent box that follows the
// hovered building, however many buildings there are. It owns that mesh and
// nothing else, so it can't contend with the fader or the outline. A rebuild
// clears the hover, which hides it, so it needs no rebuild handling.

import * as THREE from 'three';
import { effect } from '@preact/signals';
import { NodeKind } from '@/types';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { Building, FileTarget } from '@/types';
import type { createPicker } from '@/city/interaction/picker';

// Narrow world surface the ghost needs (mesh resolver only). Supplied by the
// buildings component.
interface GhostWorld {
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
}

// Opacity for the hover ghost overlay.  Intentionally light so the ghost
// reads as a "preview" hint without obscuring the building body beneath.
const GHOST_OPACITY = 0.35;

// Just off coplanar with the building beneath: exactly coplanar, the faces
// settle into a stable checkerboard once the camera damping stops.
const GHOST_SCALE_INSET = 1.005;

export function createGhostRenderer({
  scene,
  world,
  picker,
}: {
  scene: THREE.Scene;
  world: GhostWorld;
  picker: ReturnType<typeof createPicker>;
}) {
  // Shared ghost mesh — a unit cube with a translucent MeshBasicMaterial.
  // Reused across all hover events; only one is ever visible at a time.
  const _ghostMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
  });
  const _ghostGeo = new THREE.BoxGeometry(1, 1, 1);
  const ghostMesh = new THREE.Mesh(_ghostGeo, _ghostMat);
  ghostMesh.visible = false;
  ghostMesh.renderOrder = RENDER_ORDERS.HOVER_OUTLINE; // sit at same layer as hover outline
  scene.add(ghostMesh);

  // Scratch objects reused per frame to avoid GC pressure.
  const _tmpMatrix = new THREE.Matrix4();
  const _GHOST_QUAT = new THREE.Quaternion();
  const _tmpPos = new THREE.Vector3();
  const _tmpScale = new THREE.Vector3();
  const _tmpQuat = new THREE.Quaternion();

  // Decomposed from the live instance matrix, so the ghost tracks a building
  // mid-tween; layout dimensions are the fallback when there is no mesh yet.
  function _syncGhostToTarget(target: FileTarget): void {
    const b = target.data;
    const resolved = world.getMeshForBuilding(b);
    let px: number, py: number, pz: number;
    let sx: number, sy: number, sz: number;
    if (resolved) {
      resolved.mesh.getMatrixAt(resolved.slot, _tmpMatrix);
      _tmpMatrix.decompose(_tmpPos, _tmpQuat, _tmpScale);
      px = _tmpPos.x;
      py = _tmpPos.y;
      pz = _tmpPos.z;
      sx = _tmpScale.x;
      sy = _tmpScale.y;
      sz = _tmpScale.z;

      // Mirror the building's instance color so the ghost reads as the
      // same building rather than a generic overlay.
      const instanceColor = resolved.mesh.instanceColor;
      if (instanceColor) {
        const r = instanceColor.getX(resolved.slot);
        const g = instanceColor.getY(resolved.slot);
        const bv = instanceColor.getZ(resolved.slot);
        _ghostMat.color.setRGB(r, g, bv);
      }
    } else {
      // Fallback: use layout coordinates directly.
      px = b.x;
      py = b.h / 2;
      pz = b.y;
      sx = b.w;
      sy = b.h;
      sz = b.d;
      _ghostMat.color.set(b.color ?? '#ffffff');
    }

    // GHOST_SCALE_INSET keeps it flush inside the building it shadows.
    _tmpPos.set(px, py, pz);
    _tmpScale.set(sx * GHOST_SCALE_INSET, sy * GHOST_SCALE_INSET, sz * GHOST_SCALE_INSET);
    ghostMesh.matrix.compose(_tmpPos, _GHOST_QUAT, _tmpScale);
    ghostMesh.matrixAutoUpdate = false;
    ghostMesh.matrixWorldNeedsUpdate = true;
  }

  // Shown for a hovered building that isn't the selected one, the same rule
  // the hover outline uses.
  const _disposeHoverEffect = effect(() => {
    const h = picker.hover.value;
    const sel = picker.selection.value;
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (h && h.kind === NodeKind.File && h.file?.path !== selPath) {
      _syncGhostToTarget(h);
      ghostMesh.visible = true;
    } else {
      ghostMesh.visible = false;
    }
  });

  // Also hide the ghost when selection changes to the currently-hovered
  // building (so the ghost disappears on click without waiting for hover-end).
  const _disposeSelectionEffect = effect(() => {
    const hov = picker.hover.value;
    const sel = picker.selection.value;
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (!hov || hov.kind !== NodeKind.File || hov.file?.path === selPath) {
      ghostMesh.visible = false;
    }
  });

  // One transform, in case the building under it is still growing in.
  function update(_dtMs: number): void {
    if (!ghostMesh.visible) return;
    const hov = picker.hover.value;
    const sel = picker.selection.value;
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (hov && hov.kind === NodeKind.File && hov.file?.path !== selPath) {
      _syncGhostToTarget(hov);
    }
  }

  function dispose(): void {
    _disposeHoverEffect();
    _disposeSelectionEffect();
    if (ghostMesh.parent) ghostMesh.parent.remove(ghostMesh);
    _ghostGeo.dispose();
    _ghostMat.dispose();
  }

  return {
    update,
    dispose,
    ghostMesh,
  };
}
