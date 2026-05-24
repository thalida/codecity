// scene/effects/outlineRenderer.ts — owns:
//   • the shared hover outline mesh (sky-blue LineSegments2 box around hovered building)
//   • the shared selected outline mesh (rainbow-chasing LineSegments2 box)
//
// Path B (active-outlines-only): exactly 2 LineSegments2 meshes exist regardless
// of how many buildings are in the scene. Transforms are updated per-frame for
// only the 0-2 currently-active outlines (hovered + selected), so per-frame
// work is O(active) not O(buildings).
//
// Field ownership:
//   buildingFader   → block.detailMesh iFade.x attribute (building body fade)
//   outlineRenderer → hoverOutline + selectedOutline transform + visibility +
//                     rainbow color cycle on selectedOutline
//
// Subscribes to picker.hover and picker.selection (toggle visibility).
// refreshMaterials() is called by applyTheme() to push BUILDING_OUTLINE config
// changes into the two outline materials.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { BUILDING_OUTLINE, RAINBOW } from '@/config/index.js';
import { RENDER_ORDERS } from '@/constants';
import { NodeKind } from '@/types';
import { UNIT_BOX_EDGE_POSITIONS } from '@/scene/world.js';
import { getBuildingTilt } from '@/scene/components/buildings/buildingTilt.js';
import type { createWorld } from '@/scene/world.js';
import type { createPicker } from '@/scene/system/picker.js';
import type { FileTarget } from '@/types';

export function createOutlineRenderer({
  canvas,
  scene,
  cityScene: _cityScene,
  picker,
}: {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  cityScene: ReturnType<typeof createWorld>;
  picker: ReturnType<typeof createPicker>;
}) {
  const _bo = BUILDING_OUTLINE.get();

  // ── Hover outline (single shared mesh, retransformed per frame) ─────
  const _unitEdgesGeo = new LineSegmentsGeometry();
  _unitEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
  const hoverLineMat = new LineMaterial({
    color: new THREE.Color(_bo.HOVER_COLOR),
    linewidth: _bo.WIDTH,
    transparent: true,
    opacity: _bo.HOVER_OPACITY,
    depthTest: true,
    worldUnits: false,
  });
  hoverLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  const hoverOutline = new LineSegments2(_unitEdgesGeo, hoverLineMat);
  hoverOutline.visible = false;
  hoverOutline.renderOrder = RENDER_ORDERS.HOVER_OUTLINE;
  hoverOutline.matrixAutoUpdate = false; // _syncOutlineToTarget writes mesh.matrix directly
  scene.add(hoverOutline);

  // ── Selected outline (per-vertex rainbow chasing) ───────────────────
  const selectedLineMat = new LineMaterial({
    vertexColors: true,
    linewidth: _bo.WIDTH,
    transparent: true,
    opacity: _bo.SELECTED_OPACITY,
    depthTest: true,
    worldUnits: false,
  });
  selectedLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  const _selectedEdgesGeo = new LineSegmentsGeometry();
  _selectedEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
  const _selectedColors = new Float32Array(12 * 6); // 12 segments × (startRGB + endRGB)
  for (let ci = 0; ci < _selectedColors.length; ci++) _selectedColors[ci] = 1;
  _selectedEdgesGeo.setColors(_selectedColors);
  // attributes.instanceColorStart is exposed as the BufferAttribute|InterleavedBufferAttribute
  // union; LineSegmentsGeometry uses the interleaved variant, whose .data is the
  // underlying InterleavedBuffer (carries .array + .needsUpdate).
  const _selColorBuf = (
    _selectedEdgesGeo.attributes.instanceColorStart as THREE.InterleavedBufferAttribute
  ).data;
  const _tmpHsl = new THREE.Color();
  const selectedOutline = new LineSegments2(_selectedEdgesGeo, selectedLineMat);
  selectedOutline.visible = false;
  selectedOutline.renderOrder = RENDER_ORDERS.SELECTED_OUTLINE;
  selectedOutline.matrixAutoUpdate = false; // _syncOutlineToTarget writes mesh.matrix directly
  scene.add(selectedOutline);

  // Scratch objects reused per frame to avoid GC pressure.
  const _tmpMatrix = new THREE.Matrix4();
  const _tmpPos = new THREE.Vector3();
  const _tmpScale = new THREE.Vector3();
  const _tmpQuat = new THREE.Quaternion();

  // _syncOutlineToTarget: read the current animated transform of a FileTarget's
  // building, bake in the shader-side Y-shear "lean", and apply the result to
  // the outline mesh.
  //
  // Priority:
  //   1. Cell mode: building.cellId + building.slotId → cell.detailMesh.getMatrixAt(slotId)
  //   2. Fallback: layout dimensions from target.data (b.w, b.h, b.d, b.x, b.y)
  //
  // Reading from the live InstancedMesh matrix ensures the outline tracks the
  // animator's tween position rather than snapping to layout coords. The
  // shear is then composed on top so the outline's top corners visibly drift
  // with the building's lean (see scene/instanced/buildingTilt.ts).
  function _syncOutlineToTarget(outline: LineSegments2, target: FileTarget): void {
    const b = target.data;

    let sx = b.w, sy = b.h, sz = b.d;
    let px = b.x, py = b.h / 2, pz = b.y;

    // Cell mode: resolve via Building.cellId + Building.slotId.
    if (b.cellId != null && b.slotId != null) {
      const cells = _cityScene.getCells();
      if (cells.size > 0) {
        const cell = cells.get(b.cellId);
        if (cell?.detailMesh) {
          cell.detailMesh.getMatrixAt(b.slotId, _tmpMatrix);
          _tmpMatrix.decompose(_tmpPos, _tmpQuat, _tmpScale);
          sx = _tmpScale.x; sy = _tmpScale.y; sz = _tmpScale.z;
          px = _tmpPos.x;   py = _tmpPos.y;   pz = _tmpPos.z;
        }
      }
    }

    // Bake the shader's Y-shear into the outline matrix so the box leans
    // with the building. World-pos of a local vertex (lx, ly, lz):
    //   X = lx·sx + px + (ly·sy + py)·tiltX
    //   Y = ly·sy + py
    //   Z = lz·sz + pz + (ly·sy + py)·tiltZ
    // Matrix4 is column-major; .set() takes row-major args.
    const { tiltX, tiltZ } = getBuildingTilt(b);
    _tmpMatrix.set(
      sx,   sy * tiltX, 0,    px + py * tiltX,
      0,    sy,         0,    py,
      0,    sy * tiltZ, sz,   pz + py * tiltZ,
      0,    0,          0,    1,
    );
    outline.matrix.copy(_tmpMatrix);
    outline.matrixAutoUpdate = false;
    outline.matrixWorldNeedsUpdate = true;
  }

  function _setSegHueGradient(segIdx: number, hueStart: number, hueEnd: number): void {
    const rb = RAINBOW.get();
    const k = segIdx * 6;
    _tmpHsl.setHSL(((hueStart % 1) + 1) % 1, rb.SATURATION, rb.LIGHTNESS);
    _selectedColors[k] = _tmpHsl.r;
    _selectedColors[k + 1] = _tmpHsl.g;
    _selectedColors[k + 2] = _tmpHsl.b;
    _tmpHsl.setHSL(((hueEnd % 1) + 1) % 1, rb.SATURATION, rb.LIGHTNESS);
    _selectedColors[k + 3] = _tmpHsl.r;
    _selectedColors[k + 4] = _tmpHsl.g;
    _selectedColors[k + 5] = _tmpHsl.b;
  }

  // ── Reactive: show/hide outlines on selection / hover changes ───────
  //
  // On a selection change we snap the outline into place immediately so
  // there is no one-frame lag before update() runs.
  picker.selection.subscribe((sel) => {
    if (sel && sel.kind === NodeKind.File) {
      _syncOutlineToTarget(selectedOutline, sel);
      selectedOutline.visible = true;
    } else {
      selectedOutline.visible = false;
    }
  });

  // For the hover-vs-selection dedup we compare by file path rather than
  // mesh reference — in the InstancedMesh world all buildings in the same
  // block share the same mesh object, so reference comparison would wrongly
  // hide the hover outline for any two buildings in the same block.
  picker.hover.subscribe((h) => {
    const sel = picker.selection.get();
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (h && h.kind === NodeKind.File && h.file?.path !== selPath) {
      _syncOutlineToTarget(hoverOutline, h);
      hoverOutline.visible = true;
    } else {
      hoverOutline.visible = false;
    }
  });

  // ── Per-frame ────────────────────────────────────────────────────────
  // O(active-outlines) — at most 2 (hovered + selected). The dead
  // O(buildings) loop that existed here was removed in Task 12.
  function update(_dtMs: number): void {
    // Selected: keep transform pinned to the live (possibly animating)
    // instance AND advance the rainbow color chase. Bottom + top form
    // continuous 4-edge loops; verticals take a single hue from their
    // bottom corner so the loop chase stays seamless.
    const sel = picker.selection.get();
    if (sel && sel.kind === NodeKind.File) {
      _syncOutlineToTarget(selectedOutline, sel);
      const t = performance.now() * RAINBOW.get().SPEED;
      _setSegHueGradient(0, t + 0.0, t + 0.25); // bottom: back  edge
      _setSegHueGradient(1, t + 0.25, t + 0.5); // bottom: right edge
      _setSegHueGradient(2, t + 0.5, t + 0.75); // bottom: front edge
      _setSegHueGradient(3, t + 0.75, t + 1.0); // bottom: left  edge
      _setSegHueGradient(4, t + 0.0, t + 0.25); // top:    back  edge
      _setSegHueGradient(5, t + 0.25, t + 0.5); // top:    right edge
      _setSegHueGradient(6, t + 0.5, t + 0.75); // top:    front edge
      _setSegHueGradient(7, t + 0.75, t + 1.0); // top:    left  edge
      _setSegHueGradient(8, t + 0.0, t + 0.0); // vertical: back-left
      _setSegHueGradient(9, t + 0.25, t + 0.25); // vertical: back-right
      _setSegHueGradient(10, t + 0.5, t + 0.5); // vertical: front-right
      _setSegHueGradient(11, t + 0.75, t + 0.75); // vertical: front-left
      _selColorBuf.array.set(_selectedColors);
      _selColorBuf.needsUpdate = true;
    }

    // Hover: keep transform pinned in case the building is still animating.
    const hov = picker.hover.get();
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (hov && hov.kind === NodeKind.File && hov.file?.path !== selPath) {
      _syncOutlineToTarget(hoverOutline, hov);
    }
  }

  // applyTheme() coordinator hook: push fresh BUILDING_OUTLINE values
  // into the two outline materials we own.
  function refreshMaterials(): void {
    const outline = BUILDING_OUTLINE.get();
    hoverLineMat.color.set(outline.HOVER_COLOR);
    hoverLineMat.linewidth = outline.WIDTH;
    hoverLineMat.opacity = outline.HOVER_OPACITY;
    selectedLineMat.linewidth = outline.WIDTH;
    selectedLineMat.opacity = outline.SELECTED_OPACITY;
  }

  // Window-resize hook. LineMaterial needs the current canvas size for
  // its pixel-based linewidth shader.
  function onResize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    hoverLineMat.resolution.set(w, h);
    selectedLineMat.resolution.set(w, h);
  }

  function dispose() {
    if (hoverOutline.parent) hoverOutline.parent.remove(hoverOutline);
    if (selectedOutline.parent) selectedOutline.parent.remove(selectedOutline);
    if (_unitEdgesGeo.dispose) _unitEdgesGeo.dispose();
    if (_selectedEdgesGeo.dispose) _selectedEdgesGeo.dispose();
    if (hoverLineMat.dispose) hoverLineMat.dispose();
    if (selectedLineMat.dispose) selectedLineMat.dispose();
  }

  return {
    update,
    refreshMaterials,
    onResize,
    dispose,
    hoverOutline,
    selectedOutline,
  };
}
