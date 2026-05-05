// scene/effects/outlineRenderer.ts — owns:
//   • the shared hover outline mesh (sky-blue Line2 box around hovered building)
//   • the shared selected outline mesh (rainbow-chasing Line2 box)
//   • per-frame application of mesh.userData.{outlineOp, ghostOp} (set
//     by buildingFader) onto the per-building outline + ghost meshes
//     created by cityScene
//
// Field ownership (see plan/peaceful-sniffing-quill.md):
//   buildingFader   → mesh.material.opacity (building body)
//   outlineRenderer → outlineMat.opacity, ghostMat.opacity, hover/selected
//                     outline mesh transforms + rainbow color cycle
//
// Subscribes to picker.hover and picker.selection (toggle visibility) and
// updates per-frame from animate() loop. refreshMaterials() is called by
// applyTheme() to push BUILDING_OUTLINE config changes into all
// outline-related materials at once.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { BUILDING_OUTLINE, RAINBOW } from '@/config/index.js';
import { RENDER_ORDERS } from '@/constants';
import { NodeKind } from '@/types';
import type { Building } from '@/types';
import { UNIT_BOX_EDGE_POSITIONS } from '@/scene/cityScene.js';
import type { createCityScene } from '@/scene/cityScene.js';
import type { createPicker } from '@/scene/picker.js';

const OPAQUE_THRESHOLD = 0.999;

export function createOutlineRenderer({
  canvas,
  scene,
  cityScene,
  picker,
}: {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  cityScene: ReturnType<typeof createCityScene>;
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
  scene.add(selectedOutline);

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

  function _syncOutlineToBuilding(
    outline: LineSegments2,
    mesh: THREE.Mesh,
    b: Building,
    scaleFactor?: number
  ): void {
    const s = scaleFactor || 1;
    outline.scale.set(b.w * s, b.h * mesh.scale.y * s, b.d * s);
    outline.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
  }

  // ── Reactive: show/hide outlines on selection / hover changes ───────
  picker.selection.subscribe((sel) => {
    if (sel && sel.kind === NodeKind.File) {
      _syncOutlineToBuilding(selectedOutline, sel.mesh, sel.data);
      selectedOutline.visible = true;
    } else {
      selectedOutline.visible = false;
    }
  });

  picker.hover.subscribe((h) => {
    const sel = picker.selection.get();
    const selFileMesh = sel?.kind === NodeKind.File ? sel.mesh : null;
    if (h && h.kind === NodeKind.File && selFileMesh !== h.mesh) {
      _syncOutlineToBuilding(hoverOutline, h.mesh, h.data);
      hoverOutline.visible = true;
    } else {
      hoverOutline.visible = false;
    }
  });

  // ── Per-frame ───────────────────────────────────────────────────────
  function update(_dtMs: number): void {
    const buildings = cityScene.getBuildings();
    const outlines = cityScene.getBuildingOutlines();
    const ghosts = cityScene.getBuildingGhosts();

    // Apply outline + ghost opacity targets that buildingFader stashed
    // on mesh.userData this frame; sync transforms in case the mesh's
    // scale.y was nudged by the animator.
    for (let bi = 0; bi < buildings.length; bi++) {
      const m = buildings[bi];
      const b = m.userData.building;

      const outline = outlines[bi];
      if (outline) {
        outline.scale.set(b.w, b.h * (m.scale.y || 1), b.d);
        outline.position.copy(m.position);
        const outlineOp = m.userData.outlineOp || 0;
        outline.material.opacity = outlineOp;
        outline.visible = outlineOp > 0;
      }

      const ghost = ghosts[bi];
      if (ghost) {
        ghost.scale.set(b.w, b.h * (m.scale.y || 1), b.d);
        ghost.position.copy(m.position);
        const ghostOp = m.userData.ghostOp || 0;
        const ghostTransparent = ghostOp < OPAQUE_THRESHOLD;
        if (ghost.material.transparent !== ghostTransparent) {
          ghost.material.transparent = ghostTransparent;
          ghost.material.depthWrite = !ghostTransparent;
          ghost.material.needsUpdate = true;
        }
        ghost.material.opacity = ghostOp;
        ghost.visible = ghostOp > 0;
      }
    }

    // Selected: keep transform pinned to the selection's mesh AND advance
    // the rainbow color chase. Bottom + top form continuous 4-edge loops;
    // verticals take a single hue from their bottom corner so the loop
    // chase stays seamless.
    const sel = picker.selection.get();
    if (sel && sel.kind === NodeKind.File) {
      _syncOutlineToBuilding(selectedOutline, sel.mesh, sel.data);
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
    const hov = picker.hover.get();
    const selFileMesh = sel?.kind === NodeKind.File ? sel.mesh : null;
    if (hov && hov.kind === NodeKind.File && selFileMesh !== hov.mesh) {
      _syncOutlineToBuilding(hoverOutline, hov.mesh, hov.data);
    }
  }

  // applyTheme() coordinator hook: push fresh BUILDING_OUTLINE values
  // into every outline material we own (hover/selected + per-building).
  function refreshMaterials(): void {
    const outline = BUILDING_OUTLINE.get();
    hoverLineMat.color.set(outline.HOVER_COLOR);
    hoverLineMat.linewidth = outline.WIDTH;
    hoverLineMat.opacity = outline.HOVER_OPACITY;
    selectedLineMat.linewidth = outline.WIDTH;
    selectedLineMat.opacity = outline.SELECTED_OPACITY;
    const perBldgMats = cityScene.getBuildingOutlineMats();
    for (const mat of perBldgMats) {
      mat.linewidth = outline.WIDTH;
    }
  }

  // Window-resize hook. LineMaterial needs the current canvas size for
  // its pixel-based linewidth shader.
  function onResize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    hoverLineMat.resolution.set(w, h);
    selectedLineMat.resolution.set(w, h);
    const perBldgMats = cityScene.getBuildingOutlineMats();
    for (const mat of perBldgMats) {
      mat.resolution.set(w, h);
    }
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
