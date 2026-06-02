// scene/effects/treeOutlineRenderer.ts — owns:
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
// refreshMaterials() is called by applyTheme() to push TREE_OUTLINE
// config changes into the two outline materials.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { TREES } from '@/state/stores/settings/trees';
import { RAINBOW } from '@/state/stores/settings/effects';
import { RENDER_ORDERS } from '@/city/renderOrders';
import { NodeKind } from '@/types';
import { buildCanopyEdges } from '@/city/components/trees/treeRenderer';
import type { PickTarget } from '@/types/picker';
import type { ReadonlySignal } from '@preact/signals';
import { effect } from '@preact/signals';

interface TreesHandle {
  getInstanceTransform(sha: string, out: THREE.Matrix4): boolean;
  findTreeBySha(sha: string): { mesh: THREE.InstancedMesh; instanceId: number } | null;
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

  // Build one EdgesGeometry per detail tier. The active outline mesh
  // points at whichever tier matches the active tree's mesh on snap.
  // Wrapped in LineSegmentsGeometry (line2 addon's flat-array format).
  const _edgesByDetail: LineSegmentsGeometry[] = [0, 1, 2].map((d) => {
    const edges = buildCanopyEdges(d as 0 | 1 | 2);
    const positions = edges.getAttribute('position').array as Float32Array;
    const lsg = new LineSegmentsGeometry();
    lsg.setPositions(positions);
    edges.dispose();
    return lsg;
  });

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
  const hoverOutline = new LineSegments2(_edgesByDetail[0], hoverLineMat);
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
  const selectedOutline = new LineSegments2(_edgesByDetail[0], selectedLineMat);
  selectedOutline.visible = false;
  selectedOutline.renderOrder = RENDER_ORDERS.SELECTED_TREE_OUTLINE;
  selectedOutline.matrixAutoUpdate = false;
  scene.add(selectedOutline);

  const _tmpHsl = new THREE.Color();
  const _tmpMatrix = new THREE.Matrix4();

  /** Detail level (0/1/2) inferred from the canopy mesh name. The names
   *  are assigned in treeRenderer: `tree-canopy-d{0,1,2}`. */
  function _detailOfMesh(mesh: THREE.InstancedMesh): 0 | 1 | 2 {
    const n = mesh.name;
    if (n.endsWith('-d2')) return 2;
    if (n.endsWith('-d1')) return 1;
    return 0;
  }

  /** Swap the outline's geometry to the detail tier matching the active
   *  tree's canopy mesh, then write its instance matrix into the outline. */
  function _syncOutline(outline: LineSegments2, sha: string): boolean {
    const trees = getTrees();
    if (!trees) return false;
    const hit = trees.findTreeBySha(sha);
    if (!hit) return false;
    const wantDetail = _detailOfMesh(hit.mesh);
    if (outline.geometry !== _edgesByDetail[wantDetail]) {
      outline.geometry = _edgesByDetail[wantDetail];
    }
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

  // Rainbow color buffer for the selected outline. Sized at first update
  // to match the active geometry's segment count (which depends on the
  // active tree's detail tier). Reallocated when the active detail changes.
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

  function _writeRainbow(t: number): void {
    if (!_selColorBuf) return;
    const rb = RAINBOW.value;
    // One hue per segment, rotating around the silhouette over time.
    for (let i = 0; i < _selSegCount; i++) {
      const hue = (((t + i / _selSegCount) % 1) + 1) % 1;
      _tmpHsl.setHSL(hue, rb.SATURATION, rb.LIGHTNESS);
      const k = i * 6;
      _selColorBuf[k] = _tmpHsl.r;
      _selColorBuf[k + 1] = _tmpHsl.g;
      _selColorBuf[k + 2] = _tmpHsl.b;
      _selColorBuf[k + 3] = _tmpHsl.r;
      _selColorBuf[k + 4] = _tmpHsl.g;
      _selColorBuf[k + 5] = _tmpHsl.b;
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
      const t = performance.now() * RAINBOW.value.SPEED;
      _writeRainbow(t);
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
    for (const g of _edgesByDetail) g.dispose();
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
