// scene/effects/ghostRenderer.ts — owns the single shared ghost mesh:
// a translucent solid-color box that tracks the hovered-but-not-selected
// building per frame.
//
// Path B (active-ghost-only): exactly 1 THREE.Mesh exists regardless
// of how many buildings are in the scene. On hover state changes it is
// repositioned and recolored to match the hovered building; on
// hover-end it is hidden. Per-frame work is O(1) — just a matrix sync
// for the currently active ghost (if any).
//
// Field ownership:
//   buildingFader   → block.detailMesh iOpacity attribute (building body fade)
//   outlineRenderer → hoverOutline + selectedOutline transform + visibility
//   ghostRenderer   → ghostMesh transform + color + visibility
//
// Subscribes to picker.hover and picker.selection (to correctly dedup
// hover-while-selected so the ghost doesn't show on an already-selected
// building). Does NOT subscribe to cityScene.onChange — the hover atom
// is cleared by the picker on every rebuild, which triggers a hide
// automatically.

import * as THREE from 'three';
import { NodeKind } from '@/types';
import { RENDER_ORDERS } from '@/constants';
import type { createCityScene } from '@/scene/cityScene.js';
import type { createPicker } from '@/scene/picker.js';
import type { FileTarget } from '@/types';

// Opacity for the hover ghost overlay.  Intentionally light so the ghost
// reads as a "preview" hint without obscuring the building body beneath.
const GHOST_OPACITY = 0.35;

// Tiny outward scale on the ghost so its faces don't sit perfectly
// coplanar with the underlying building's BoxGeometry — coplanar faces
// z-fight, producing a stable checkerboard pattern across the whole
// face once OrbitControls' damping settles. 1.005 keeps the ghost
// visually flush with the building at any reasonable zoom while still
// beating the depth-test tie.
const GHOST_SCALE_INSET = 1.005;

export function createGhostRenderer({
  scene,
  cityScene: _cityScene,
  picker,
}: {
  scene: THREE.Scene;
  cityScene: ReturnType<typeof createCityScene>;
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
  const _tmpPos = new THREE.Vector3();
  const _tmpScale = new THREE.Vector3();
  const _tmpQuat = new THREE.Quaternion();

  // _syncGhostToTarget: read the current animated transform of a FileTarget's
  // building and apply it to the ghost mesh.  Also reads instanceColor for
  // the correct building tint.
  //
  // For InstancedMesh targets (block + instanceId present), we decompose the
  // live instance matrix so the ghost tracks the animator's tween position.
  // For legacy / no-mesh targets, we fall back to layout dimensions from
  // target.data (b.w, b.h, b.d, b.x, b.y).
  function _syncGhostToTarget(target: FileTarget): void {
    const b = target.data;
    if (target.block?.detailMesh && target.instanceId != null) {
      target.block.detailMesh.getMatrixAt(target.instanceId, _tmpMatrix);
      _tmpMatrix.decompose(_tmpPos, _tmpQuat, _tmpScale);
      ghostMesh.scale.set(
        _tmpScale.x * GHOST_SCALE_INSET,
        _tmpScale.y * GHOST_SCALE_INSET,
        _tmpScale.z * GHOST_SCALE_INSET,
      );
      ghostMesh.position.copy(_tmpPos);

      // Mirror the building's instance color so the ghost reads as the
      // same building rather than a generic overlay.
      const instanceColor = target.block.detailMesh.instanceColor;
      if (instanceColor) {
        const r = instanceColor.getX(target.instanceId);
        const g = instanceColor.getY(target.instanceId);
        const bv = instanceColor.getZ(target.instanceId);
        _ghostMat.color.setRGB(r, g, bv);
      }
    } else {
      // Fallback: use layout coordinates directly.
      ghostMesh.scale.set(
        b.w * GHOST_SCALE_INSET,
        b.h * GHOST_SCALE_INSET,
        b.d * GHOST_SCALE_INSET,
      );
      ghostMesh.position.set(b.x, b.h / 2, b.y);
      _ghostMat.color.set(b.color ?? '#ffffff');
    }
  }

  // ── Reactive: show/hide ghost on hover changes ───────────────────────
  //
  // Ghost is shown only when there is a file hover AND the hovered
  // building is NOT the currently selected building (same dedup rule
  // as the hover outline in outlineRenderer).
  picker.hover.subscribe((h) => {
    const sel = picker.selection.get();
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
  picker.selection.subscribe(() => {
    const hov = picker.hover.get();
    const sel = picker.selection.get();
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (!hov || hov.kind !== NodeKind.File || hov.file?.path === selPath) {
      ghostMesh.visible = false;
    }
  });

  // ── Per-frame ────────────────────────────────────────────────────────
  // O(1) — sync the active ghost transform in case the building is
  // still animating (entering tween growing scale.y).
  function update(_dtMs: number): void {
    if (!ghostMesh.visible) return;
    const hov = picker.hover.get();
    const sel = picker.selection.get();
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (hov && hov.kind === NodeKind.File && hov.file?.path !== selPath) {
      _syncGhostToTarget(hov);
    }
  }

  function dispose(): void {
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
