// city/components/trees/outline.ts — owns:
//   • the shared tree hover outline mesh (white LineSegments2 silhouette
//     around the hovered tree's canopy)
//   • the shared tree selected outline mesh (rainbow-chasing silhouette)
//
// Mirrors scene/effects/outlineRenderer.ts but for tree canopies.
// Exactly two LineSegments2 meshes exist regardless of tree count;
// transforms are snapped per frame to the 0-2 currently-active outlines.
//
// Subscribes to picker.hover and picker.selection. Hover deduplicates
// against selection by sha so a tree that is both hovered and selected
// shows only the selected outline.
//
// refreshMaterials() is called by the trees component's theme effect to
// push TREE_OUTLINE config changes into the two outline materials.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { TREES } from '@/state/stores/settings/trees';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { rainbowRgbAt } from '@/city/utils/rainbowChase';
import { NodeKind } from '@/types';
import { buildCanopyEdges } from './treeRenderer';
import type { PickTarget } from '@/types/picker';
import type { ReadonlySignal } from '@preact/signals';
import { effect } from '@preact/signals';

interface TreesHandle {
  getInstanceTransform(sha: string, out: THREE.Matrix4): boolean;
}

/** Minimal picker surface consumed by this renderer (hover + selection signals). */
interface PickerSignals {
  hover: ReadonlySignal<PickTarget | null>;
  selection: ReadonlySignal<PickTarget | null>;
}

interface CreateArgs {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  picker: PickerSignals;
  /** Late-bound: trees are built after this renderer is created. Returns
   *  null when no manifest has been applied yet. */
  getTrees: () => TreesHandle | null;
}

export function createTreeOutlineRenderer({ canvas, scene, picker, getTrees }: CreateArgs) {
  const _cfg = TREES.value;

  // Single canopy silhouette geometry shared by both outline meshes — every
  // tree uses one facet count, so there's no per-tier swap. Wrapped in
  // LineSegmentsGeometry (line2 addon's flat-array format).
  const _edges = buildCanopyEdges();
  const _edgesGeom = new LineSegmentsGeometry();
  _edgesGeom.setPositions(_edges.getAttribute('position').array as Float32Array);
  _edges.dispose();

  // ── Hover outline ─────────────────────────────────────────────────────
  const hoverLineMat = new LineMaterial({
    color: new THREE.Color(_cfg.OUTLINE_HOVER_COLOR),
    linewidth: _cfg.OUTLINE_WIDTH,
    transparent: true,
    opacity: _cfg.OUTLINE_HOVER_OPACITY,
    depthTest: true,
    worldUnits: false,
  });
  hoverLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  const hoverOutline = new LineSegments2(_edgesGeom, hoverLineMat);
  hoverOutline.visible = false;
  hoverOutline.renderOrder = RENDER_ORDERS.HOVER_TREE_OUTLINE;
  hoverOutline.matrixAutoUpdate = false;
  scene.add(hoverOutline);

  // ── Selected outline (rainbow vertex colors) ──────────────────────────
  const selectedLineMat = new LineMaterial({
    vertexColors: true,
    linewidth: _cfg.OUTLINE_WIDTH,
    transparent: true,
    opacity: _cfg.OUTLINE_SELECTED_OPACITY,
    depthTest: true,
    worldUnits: false,
  });
  selectedLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  const selectedOutline = new LineSegments2(_edgesGeom, selectedLineMat);
  selectedOutline.visible = false;
  selectedOutline.renderOrder = RENDER_ORDERS.SELECTED_TREE_OUTLINE;
  selectedOutline.matrixAutoUpdate = false;
  scene.add(selectedOutline);

  const _tmpMatrix = new THREE.Matrix4();

  /** Snap the outline onto the tree with the given sha. The silhouette
   *  geometry is shared (one facet count for all trees), so this only writes
   *  the instance transform — no per-tier geometry swap. */
  function _syncOutline(outline: LineSegments2, sha: string): boolean {
    const trees = getTrees();
    if (!trees) return false;
    if (!trees.getInstanceTransform(sha, _tmpMatrix)) return false;
    outline.matrix.copy(_tmpMatrix);
    outline.matrixWorldNeedsUpdate = true;
    return true;
  }

  /** True iff hover and selection are the same tree (so hover should hide). */
  function _hoverIsSelected(): boolean {
    const sel = picker.selection.value;
    const hov = picker.hover.value;
    if (!sel || sel.kind !== NodeKind.Commit) return false;
    if (!hov || hov.kind !== NodeKind.Commit) return false;
    return sel.commit.sha === hov.commit.sha;
  }

  const _disposeSelectionEffect = effect(() => {
    const sel = picker.selection.value;
    if (sel && sel.kind === NodeKind.Commit) {
      const ok = _syncOutline(selectedOutline, sel.commit.sha);
      selectedOutline.visible = ok;
    } else {
      selectedOutline.visible = false;
    }
  });

  const _disposeHoverEffect = effect(() => {
    const h = picker.hover.value;
    if (h && h.kind === NodeKind.Commit && !_hoverIsSelected()) {
      const ok = _syncOutline(hoverOutline, h.commit.sha);
      hoverOutline.visible = ok;
    } else {
      hoverOutline.visible = false;
    }
  });

  // Rainbow color buffer for the selected outline. Sized once at first update
  // to the shared canopy silhouette's segment count.
  let _selColorBuf: Float32Array | null = null;
  let _selSegCount = 0;

  function _ensureColorBuffer(geom: LineSegmentsGeometry): void {
    // Each segment has start RGB + end RGB = 6 floats.
    const startAttr = geom.attributes.instanceStart;
    if (!startAttr) return;
    const segCount = startAttr.count;
    if (segCount === _selSegCount && _selColorBuf) return;
    _selSegCount = segCount;
    _selColorBuf = new Float32Array(segCount * 6);
    for (let i = 0; i < _selColorBuf.length; i++) _selColorBuf[i] = 1;
    geom.setColors(_selColorBuf);
  }

  function _writeRainbow(timeMs: number): void {
    if (!_selColorBuf) return;
    // One hue per segment, rotating around the silhouette over time.
    for (let i = 0; i < _selSegCount; i++) {
      const [r, g, b] = rainbowRgbAt(timeMs, i / _selSegCount);
      const k = i * 6;
      _selColorBuf[k] = r;
      _selColorBuf[k + 1] = g;
      _selColorBuf[k + 2] = b;
      _selColorBuf[k + 3] = r;
      _selColorBuf[k + 4] = g;
      _selColorBuf[k + 5] = b;
    }
    const geom = selectedOutline.geometry as LineSegmentsGeometry;
    const colorAttr = geom.attributes.instanceColorStart as THREE.InterleavedBufferAttribute;
    colorAttr.data.array.set(_selColorBuf);
    colorAttr.data.needsUpdate = true;
  }

  function update(_dtMs: number): void {
    // Selected: re-snap transform (in case the tree's instance matrix
    // changed via a refresh / animation) and advance rainbow chase.
    const sel = picker.selection.value;
    if (sel && sel.kind === NodeKind.Commit) {
      _syncOutline(selectedOutline, sel.commit.sha);
      _ensureColorBuffer(selectedOutline.geometry as LineSegmentsGeometry);
      _writeRainbow(performance.now());
    }

    // Hover: re-snap in case the tree moved.
    const hov = picker.hover.value;
    if (hov && hov.kind === NodeKind.Commit && !_hoverIsSelected()) {
      _syncOutline(hoverOutline, hov.commit.sha);
    }
  }

  function refreshMaterials(): void {
    const c = TREES.value;
    hoverLineMat.color.set(c.OUTLINE_HOVER_COLOR);
    hoverLineMat.linewidth = c.OUTLINE_WIDTH;
    hoverLineMat.opacity = c.OUTLINE_HOVER_OPACITY;
    selectedLineMat.linewidth = c.OUTLINE_WIDTH;
    selectedLineMat.opacity = c.OUTLINE_SELECTED_OPACITY;
  }

  function onResize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    hoverLineMat.resolution.set(w, h);
    selectedLineMat.resolution.set(w, h);
  }

  function dispose(): void {
    _disposeSelectionEffect();
    _disposeHoverEffect();
    if (hoverOutline.parent) hoverOutline.parent.remove(hoverOutline);
    if (selectedOutline.parent) selectedOutline.parent.remove(selectedOutline);
    _edgesGeom.dispose();
    hoverLineMat.dispose();
    selectedLineMat.dispose();
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
