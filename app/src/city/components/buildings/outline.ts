// city/components/buildings/outline.ts — owns:
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
// An own BUILDINGS settings effect pushes config changes into the two
// outline materials (replaces the old refreshMaterials()/applyTheme() path).

import * as THREE from 'three';
import { effect } from '@preact/signals';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { BUILDINGS } from '@/state/stores/settings/buildings';
import { RAINBOW } from '@/state/stores/settings/effects';
import { RENDER_ORDERS } from '@/city/renderOrders';
import { NodeKind } from '@/types';
import { getBuildingTilt } from './tilt';
import type { CellTile } from './cellTile';
import type { createPicker } from '@/city/runtime/picker';
import type { FileTarget } from '@/types';

// Narrow world surface the outline renderer needs (cell lookup only). Supplied
// by the buildings component (cells are component-local).
interface OutlineWorld {
  getCells(): Map<number, CellTile>;
}

// 12 edges of a unit cube as flat [x,y,z, x,y,z, ...] segment endpoints.
// Both outline meshes are Line2s built from this geometry (rendered as
// triangle strips so linewidth is settable in pixels — regular WebGL lines
// are locked to 1px), then retransformed per frame to the active building.
const UNIT_BOX_EDGE_POSITIONS = [
  // Bottom face (y = -0.5) — 4 edges around the base.
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
  0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5,
  // Top face (y = 0.5) — 4 edges around the roof.
  -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  // Vertical edges — 4 edges connecting corresponding base + roof corners.
  -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
];

export function createOutlineRenderer({
  canvas,
  scene,
  world: _world,
  picker,
}: {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  world: OutlineWorld;
  picker: ReturnType<typeof createPicker>;
}) {
  const _bo = BUILDINGS.value;

  // ── Hover outline (single shared mesh, retransformed per frame) ─────
  const _unitEdgesGeo = new LineSegmentsGeometry();
  _unitEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
  const hoverLineMat = new LineMaterial({
    color: new THREE.Color(_bo.OUTLINE_HOVER_COLOR),
    linewidth: _bo.OUTLINE_WIDTH,
    transparent: true,
    opacity: _bo.OUTLINE_HOVER_OPACITY,
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
    linewidth: _bo.OUTLINE_WIDTH,
    transparent: true,
    opacity: _bo.OUTLINE_SELECTED_OPACITY,
    depthTest: true,
    worldUnits: false,
  });
  selectedLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  const _selectedEdgesGeo = new LineSegmentsGeometry();
  _selectedEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
  // A unit cube has CUBE_EDGE_COUNT edges; LineSegmentsGeometry stores
  // start+end RGB (6 floats) per edge. UNIT_BOX_EDGE_POSITIONS (above)
  // encodes the same 12 edges as flat (x,y,z) pairs.
  const CUBE_EDGE_COUNT = 12;
  const COLOR_FLOATS_PER_EDGE = 6; // start RGB + end RGB
  const _selectedColors = new Float32Array(CUBE_EDGE_COUNT * COLOR_FLOATS_PER_EDGE);
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
  // with the building's lean (see ./tilt.ts).
  function _syncOutlineToTarget(outline: LineSegments2, target: FileTarget): void {
    const b = target.data;

    let sx = b.w,
      sy = b.h,
      sz = b.d;
    let px = b.x,
      py = b.h / 2,
      pz = b.y;

    // Cell mode: resolve via Building.cellId + Building.slotId.
    if (b.cellId != null && b.slotId != null) {
      const cells = _world.getCells();
      if (cells.size > 0) {
        const cell = cells.get(b.cellId);
        if (cell?.detailMesh) {
          cell.detailMesh.getMatrixAt(b.slotId, _tmpMatrix);
          _tmpMatrix.decompose(_tmpPos, _tmpQuat, _tmpScale);
          sx = _tmpScale.x;
          sy = _tmpScale.y;
          sz = _tmpScale.z;
          px = _tmpPos.x;
          py = _tmpPos.y;
          pz = _tmpPos.z;
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
      sx,
      sy * tiltX,
      0,
      px + py * tiltX,
      0,
      sy,
      0,
      py,
      0,
      sy * tiltZ,
      sz,
      pz + py * tiltZ,
      0,
      0,
      0,
      1
    );
    outline.matrix.copy(_tmpMatrix);
    outline.matrixAutoUpdate = false;
    outline.matrixWorldNeedsUpdate = true;
  }

  function _setSegHueGradient(segIdx: number, hueStart: number, hueEnd: number): void {
    const rb = RAINBOW.value;
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

  // Show/hide outlines on selection / hover changes. Snap into place
  // synchronously so there's no one-frame lag before update() runs.
  effect(() => {
    const sel = picker.selection.value;
    if (sel && sel.kind === NodeKind.File) {
      _syncOutlineToTarget(selectedOutline, sel);
      selectedOutline.visible = true;
    } else {
      selectedOutline.visible = false;
    }
  });

  // Hover-vs-selection dedup compares by file path (not mesh reference) —
  // InstancedMesh buildings in the same block share the same mesh, so a
  // reference comparison would hide the hover outline for any second
  // building in the block. .peek() the selection so this effect re-runs
  // ONLY on hover change, not selection change.
  effect(() => {
    const h = picker.hover.value;
    const sel = picker.selection.peek();
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
    const sel = picker.selection.value;
    if (sel && sel.kind === NodeKind.File) {
      _syncOutlineToTarget(selectedOutline, sel);
      // Rainbow chase around the cube. The 12 cube edges split into 3
      // groups:
      //   - bottom face (segments 0-3): rainbow gradient flowing
      //     counter-clockwise around the base
      //   - top face   (segments 4-7): same gradient, in lockstep
      //   - 4 verticals (segments 8-11): each holds one solid hue from
      //     the quartered cycle, hinting at where the bottom/top edges
      //     start and end so the rainbow reads as continuous around the
      //     entire silhouette
      const t = performance.now() * RAINBOW.value.SPEED;
      const HUE_STEPS = 4; // edges per face → quartered hue cycle
      const HUE_STEP = 1 / HUE_STEPS;
      for (let i = 0; i < HUE_STEPS; i++) {
        const a = t + i * HUE_STEP;
        const b = t + (i + 1) * HUE_STEP;
        _setSegHueGradient(i, a, b); // bottom face
        _setSegHueGradient(i + HUE_STEPS, a, b); // top face (same gradient)
        _setSegHueGradient(i + HUE_STEPS * 2, a, a); // vertical: solid hue
      }
      _selColorBuf.array.set(_selectedColors);
      _selColorBuf.needsUpdate = true;
    }

    // Hover: keep transform pinned in case the building is still animating.
    const hov = picker.hover.value;
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (hov && hov.kind === NodeKind.File && hov.file?.path !== selPath) {
      _syncOutlineToTarget(hoverOutline, hov);
    }
  }

  // BUILDINGS theme effect — push fresh outline color/width/opacity into the
  // two outline materials we own whenever BUILDINGS changes (Save). Replaces
  // the outlineRenderer.refreshMaterials() call renderLoop.applyTheme() used to
  // make. The body is verbatim the old refreshMaterials(); reading BUILDINGS
  // .value here subscribes the effect. The constructor seeded these same
  // values, so the first fire (at construction, during arming) is a no-op.
  const _stopMaterials = effect(() => {
    const outline = BUILDINGS.value;
    hoverLineMat.color.set(outline.OUTLINE_HOVER_COLOR);
    hoverLineMat.linewidth = outline.OUTLINE_WIDTH;
    hoverLineMat.opacity = outline.OUTLINE_HOVER_OPACITY;
    selectedLineMat.linewidth = outline.OUTLINE_WIDTH;
    selectedLineMat.opacity = outline.OUTLINE_SELECTED_OPACITY;
  });

  // Window-resize hook. LineMaterial needs the current canvas size for
  // its pixel-based linewidth shader.
  function onResize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    hoverLineMat.resolution.set(w, h);
    selectedLineMat.resolution.set(w, h);
  }

  function dispose() {
    _stopMaterials();
    if (hoverOutline.parent) hoverOutline.parent.remove(hoverOutline);
    if (selectedOutline.parent) selectedOutline.parent.remove(selectedOutline);
    if (_unitEdgesGeo.dispose) _unitEdgesGeo.dispose();
    if (_selectedEdgesGeo.dispose) _selectedEdgesGeo.dispose();
    if (hoverLineMat.dispose) hoverLineMat.dispose();
    if (selectedLineMat.dispose) selectedLineMat.dispose();
  }

  return {
    update,
    onResize,
    dispose,
    hoverOutline,
    selectedOutline,
  };
}
