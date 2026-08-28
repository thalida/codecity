// city/components/trees/outline.ts — the hover (white) + selected
// (rainbow-chasing) canopy silhouettes, mirroring buildings/outline.ts.
// Exactly two meshes exist regardless of tree count, snapped per frame to
// the 0-2 active trees; hover dedups against selection by sha.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { SafeLineSegmentsGeometry } from '@/city/utils/safeLineSegmentsGeometry';

import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { rainbowRgbAt } from '@/city/utils/rainbowChase';
import type { CitySettingsStore } from '@/city/settings/store';
import { FLOATS_PER_SEGMENT } from '@/city/utils/bufferLayout';
import { createSafeLineMaterial } from '@/city/utils/safeLineMaterial';
import { buildCanopyEdges } from './treeRenderer';
import type { PickTarget } from '@/city/types/picker';
import { NodeKind } from '@/city/types/manifest';

interface TreesHandle {
  getInstanceTransform(sha: string, out: THREE.Matrix4): boolean;
}

/** Minimal picker surface consumed by this renderer (hover + selection signals). */
interface PickerSignals {
  readonly hover: PickTarget | null;
  readonly selection: PickTarget | null;
  on(what: 'hover' | 'selection', listener: () => void): () => void;
}

interface CreateArgs {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  picker: PickerSignals;
  /** Late-bound: trees are built after this renderer is created. Returns
   *  null when no manifest has been applied yet. */
  getTrees: () => TreesHandle | null;
  settings: CitySettingsStore;
}

export function createTreeOutlineRenderer({
  canvas,
  scene,
  picker,
  getTrees,
  settings,
}: CreateArgs) {
  const _cfg = settings.TREES;

  // One shared silhouette: every tree uses the same facet count, so there's
  // no per-tier geometry swap.
  const _edges = buildCanopyEdges();
  const _edgesGeom = new SafeLineSegmentsGeometry();
  _edgesGeom.setPositions(_edges.getAttribute('position').array as Float32Array);
  _edges.dispose();

  // ── Hover outline ─────────────────────────────────────────────────────
  const hoverLineMat = createSafeLineMaterial({
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
  const selectedLineMat = createSafeLineMaterial({
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

  /** Snap the outline onto the tree with the given sha — transform only,
   *  since the silhouette geometry is shared. */
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
    const sel = picker.selection;
    const hov = picker.hover;
    if (!sel || sel.kind !== NodeKind.Commit) return false;
    if (!hov || hov.kind !== NodeKind.Commit) return false;
    return sel.commit.sha === hov.commit.sha;
  }

  const _disposeSelectionEffect = picker.on('selection', () => {
    const sel = picker.selection;
    if (sel && sel.kind === NodeKind.Commit) {
      const ok = _syncOutline(selectedOutline, sel.commit.sha);
      selectedOutline.visible = ok;
    } else {
      selectedOutline.visible = false;
    }
  });

  const _disposeHoverEffect = picker.on('hover', () => {
    const h = picker.hover;
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

  function _ensureColorBuffer(geom: SafeLineSegmentsGeometry): void {
    // Each segment has start RGB + end RGB = 6 floats.
    const startAttr = geom.attributes.instanceStart;
    if (!startAttr) return;
    const segCount = startAttr.count;
    if (segCount === _selSegCount && _selColorBuf) return;
    _selSegCount = segCount;
    _selColorBuf = new Float32Array(segCount * FLOATS_PER_SEGMENT);
    for (let i = 0; i < _selColorBuf.length; i++) _selColorBuf[i] = 1;
    geom.setColors(_selColorBuf);
  }

  function _writeRainbow(timeMs: number): void {
    if (!_selColorBuf) return;
    // One hue per segment, rotating around the silhouette over time.
    for (let i = 0; i < _selSegCount; i++) {
      const [r, g, b] = rainbowRgbAt(timeMs, i / _selSegCount, settings.RAINBOW);
      const k = i * FLOATS_PER_SEGMENT;
      _selColorBuf[k] = r;
      _selColorBuf[k + 1] = g;
      _selColorBuf[k + 2] = b;
      _selColorBuf[k + 3] = r;
      _selColorBuf[k + 4] = g;
      _selColorBuf[k + 5] = b;
    }
    (selectedOutline.geometry as SafeLineSegmentsGeometry).setColors(_selColorBuf);
  }

  function update(_dtMs: number): void {
    // Selected: re-snap transform (in case the tree's instance matrix
    // changed via a refresh / animation) and advance rainbow chase.
    const sel = picker.selection;
    if (sel && sel.kind === NodeKind.Commit) {
      _syncOutline(selectedOutline, sel.commit.sha);
      _ensureColorBuffer(selectedOutline.geometry as SafeLineSegmentsGeometry);
      _writeRainbow(performance.now());
    }

    // Hover: re-snap in case the tree moved.
    const hov = picker.hover;
    if (hov && hov.kind === NodeKind.Commit && !_hoverIsSelected()) {
      _syncOutline(hoverOutline, hov.commit.sha);
    }
  }

  function refreshMaterials(): void {
    const c = settings.TREES;
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
