// city/components/buildings/outline.ts — the hover (sky-blue) + selected
// (rainbow-chasing) building outline boxes. Exactly 2 LineSegments2 meshes
// exist regardless of building count, retransformed per frame to the 0-2
// active targets, so per-frame work is O(active) not O(buildings).

import * as THREE from 'three';
import { effect } from '@preact/signals';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { SafeLineSegmentsGeometry } from '@/city/scene/utils/safeLineSegmentsGeometry';

import type { BuildingsConfig } from '@/city/session/settings/buildings';
import type { RainbowConfig } from '@/city/session/settings/effects';
import type { ReadonlySignal } from '@preact/signals';
import { RENDER_ORDERS } from '@/city/scene/constants/renderOrders';
import { rainbowRgbAt } from '@/city/scene/utils/rainbowChase';
import { FLOATS_PER_SEGMENT } from '@/city/scene/constants/bufferLayout';
import { createSafeLineMaterial } from '@/city/scene/utils/safeLineMaterial';
import { NodeKind } from '@/types';
import type { CellTile } from './cellTile';
import type { createPicker } from '@/city/scene/interaction/picker';
import type { FileTarget } from '@/types';

// Narrow world surface the outline renderer needs (cell lookup only). Supplied
// by the buildings component (cells are component-local).
interface OutlineWorld {
  getCells(): Map<number, CellTile>;
}

// Unit-cube edges as flat segment endpoints. Line2 renders them as triangle
// strips so linewidth works in pixels (plain WebGL lines lock to 1px).
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
  buildings,
  rainbow,
}: {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  world: OutlineWorld;
  picker: ReturnType<typeof createPicker>;
  /** This city's outline settings: width, colour and opacity. */
  buildings: ReadonlySignal<BuildingsConfig>;
  /** Its rainbow chase, which the selected outline runs. */
  rainbow: ReadonlySignal<RainbowConfig>;
}) {
  const _bo = buildings.value;

  // ── Hover outline (single shared mesh, retransformed per frame) ─────
  const _unitEdgesGeo = new SafeLineSegmentsGeometry();
  _unitEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
  const hoverLineMat = createSafeLineMaterial({
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
  const selectedLineMat = createSafeLineMaterial({
    vertexColors: true,
    linewidth: _bo.OUTLINE_WIDTH,
    transparent: true,
    opacity: _bo.OUTLINE_SELECTED_OPACITY,
    depthTest: true,
    worldUnits: false,
  });
  selectedLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  const _selectedEdgesGeo = new SafeLineSegmentsGeometry();
  _selectedEdgesGeo.setPositions(UNIT_BOX_EDGE_POSITIONS);
  const CUBE_EDGE_COUNT = 12;
  const _selectedColors = new Float32Array(CUBE_EDGE_COUNT * FLOATS_PER_SEGMENT);
  for (let ci = 0; ci < _selectedColors.length; ci++) _selectedColors[ci] = 1;
  _selectedEdgesGeo.setColors(_selectedColors);
  const selectedOutline = new LineSegments2(_selectedEdgesGeo, selectedLineMat);
  selectedOutline.visible = false;
  selectedOutline.renderOrder = RENDER_ORDERS.SELECTED_OUTLINE;
  selectedOutline.matrixAutoUpdate = false; // _syncOutlineToTarget writes mesh.matrix directly
  scene.add(selectedOutline);

  // Scratch objects reused per frame to avoid GC pressure.
  const _tmpMatrix = new THREE.Matrix4();
  const _TMP_QUAT = new THREE.Quaternion();
  const _tmpPos = new THREE.Vector3();
  const _tmpScale = new THREE.Vector3();
  const _tmpQuat = new THREE.Quaternion();

  // Snap the outline to the target's LIVE instance matrix (so it tracks the
  // tween, not layout coords), then compose the age-lean shear on top.
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
    // with the building.
    _tmpPos.set(px, py, pz);
    _tmpScale.set(sx, sy, sz);
    _tmpMatrix.compose(_tmpPos, _TMP_QUAT, _tmpScale);
    outline.matrix.copy(_tmpMatrix);
    outline.matrixAutoUpdate = false;
    outline.matrixWorldNeedsUpdate = true;
  }

  function _setSegHueGradient(
    segIdx: number,
    timeMs: number,
    fracStart: number,
    fracEnd: number
  ): void {
    const k = segIdx * FLOATS_PER_SEGMENT;
    // Start RGB — consume the scratch tuple before the next call overwrites it.
    const [r0, g0, b0] = rainbowRgbAt(timeMs, fracStart, rainbow.value);
    _selectedColors[k] = r0;
    _selectedColors[k + 1] = g0;
    _selectedColors[k + 2] = b0;
    const [r1, g1, b1] = rainbowRgbAt(timeMs, fracEnd, rainbow.value);
    _selectedColors[k + 3] = r1;
    _selectedColors[k + 4] = g1;
    _selectedColors[k + 5] = b1;
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

  // Dedup by file path, not mesh ref (same-block buildings share a mesh);
  // .peek() keeps this hover-only — no selection subscription.
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
  // O(active-outlines) — at most 2 (hovered + selected).
  function update(_dtMs: number): void {
    // Selected: pin the transform to the live instance and advance the
    // rainbow chase.
    const sel = picker.selection.value;
    if (sel && sel.kind === NodeKind.File) {
      _syncOutlineToTarget(selectedOutline, sel);
      // Bottom + top faces chase the same quartered gradient in lockstep;
      // verticals hold their corner's hue so the loop reads as continuous.
      const timeMs = performance.now();
      const HUE_STEPS = 4; // edges per face → quartered hue cycle
      const HUE_STEP = 1 / HUE_STEPS;
      for (let i = 0; i < HUE_STEPS; i++) {
        const a = i * HUE_STEP;
        const b = (i + 1) * HUE_STEP;
        _setSegHueGradient(i, timeMs, a, b); // bottom face
        _setSegHueGradient(i + HUE_STEPS, timeMs, a, b); // top face (same gradient)
        _setSegHueGradient(i + HUE_STEPS * 2, timeMs, a, a); // vertical: solid hue
      }
      _selectedEdgesGeo.setColors(_selectedColors);
    }

    // Hover: keep transform pinned in case the building is still animating.
    const hov = picker.hover.value;
    const selPath = sel?.kind === NodeKind.File ? sel.file?.path : null;
    if (hov && hov.kind === NodeKind.File && hov.file?.path !== selPath) {
      _syncOutlineToTarget(hoverOutline, hov);
    }
  }

  // BUILDINGS Save → push color/width/opacity into the two materials; the
  // construction-time first fire reproduces the seeded values (no-op).
  const _stopMaterials = effect(() => {
    const outline = buildings.value;
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
