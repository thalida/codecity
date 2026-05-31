// scene/effects/pathLineRenderer.ts — owns the neon selection path line
// (gem → selected node, rainbow chasing) and the faded hover-preview
// path line (gem → hovered node).
//
// Subscribes to picker.selection / picker.hover and rebuilds the
// geometry whenever either changes. update(dtMs) ticks the rainbow
// color cycle on the selection line each frame. refreshMaterials() is
// called by applyTheme() to push PATH_LINE / HOVER_PATH_LINE config
// changes into the materials.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { PATH_LINE, HOVER_PATH_LINE, RAINBOW, STREET_TIERS } from '@/state/settings/index';

/**
 * Converts a LINEWIDTH_PCT percentage (1–50) into an actual pixel linewidth
 * by multiplying the smallest street tier width by pct/100.
 *
 * LineMaterial with worldUnits:false interprets linewidth in screen pixels,
 * so this keeps lines proportional to the narrowest street at any zoom.
 */
export function computePathLinewidthPixels(pct: number): number {
  const tiers = STREET_TIERS.value;
  if (!tiers.length) return pct / 100; // degenerate fallback
  const minWidth = Math.min(...tiers.map((t) => t.width));
  return minWidth * (pct / 100);
}
import { RENDER_ORDERS } from '@/scene/renderOrders';
import { NodeKind } from '@/types';
import { computePathPoints } from '@/scene/utils/path';
import type { createWorld } from '@/scene/world';
import type { createPicker } from '@/scene/system/picker';

export function createPathLineRenderer({
  canvas,
  scene,
  world,
  picker,
}: {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  world: ReturnType<typeof createWorld>;
  picker: ReturnType<typeof createPicker>;
}) {
  // ── Selection path line (rainbow vertex colors) ────────────────────
  const _pl = PATH_LINE.value;
  const pathLineMat = new LineMaterial({
    vertexColors: true,
    linewidth: computePathLinewidthPixels(_pl.LINEWIDTH_PCT),
    transparent: true,
    opacity: 0.0,
    depthTest: true,
    depthWrite: false,
    worldUnits: false,
  });
  pathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  let pathLineGeo = new LineSegmentsGeometry();
  pathLineGeo.setPositions([0, 0, 0, 0, 0, 0]);
  const pathLine = new LineSegments2(pathLineGeo, pathLineMat);
  pathLine.visible = false;
  pathLine.renderOrder = RENDER_ORDERS.PATH_LINE;
  scene.add(pathLine);

  let pathSegmentCount = 0;
  let _pathColorsBuf = new Float32Array(0);
  const _pathHsl = new THREE.Color();

  // ── Hover preview path line (single solid color, faded) ────────────
  // Width is shared with the selection line — reads PATH_LINE.LINEWIDTH_PCT.
  const hoverPathLineMat = new LineMaterial({
    color: HOVER_PATH_LINE.value.COLOR,
    linewidth: computePathLinewidthPixels(PATH_LINE.value.LINEWIDTH_PCT),
    transparent: true,
    opacity: 0.0,
    depthTest: true,
    depthWrite: false,
    worldUnits: false,
  });
  hoverPathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  let hoverPathLineGeo = new LineSegmentsGeometry();
  hoverPathLineGeo.setPositions([0, 0, 0, 0, 0, 0]);
  const hoverPathLine = new LineSegments2(hoverPathLineGeo, hoverPathLineMat);
  hoverPathLine.visible = false;
  hoverPathLine.renderOrder = RENDER_ORDERS.PATH_LINE;
  scene.add(hoverPathLine);

  function _isHoverSameAsSelection(): boolean {
    const hov = picker.hover.value;
    const sel = picker.selection.value;
    if (!hov || !sel) return false;
    if (hov.kind !== sel.kind) return false;
    if (hov.kind === NodeKind.File && sel.kind === NodeKind.File) return hov.mesh === sel.mesh;
    if (hov.kind === NodeKind.Directory && sel.kind === NodeKind.Directory)
      return hov.street === sel.street;
    if (hov.kind === NodeKind.Gem) return true;
    return false;
  }

  function _updatePathLine(): void {
    const sel = picker.selection.value;
    const gemPos = world.getGemWorldPos();
    if (!gemPos || !sel) {
      pathLine.visible = false;
      pathLineMat.opacity = 0;
      pathSegmentCount = 0;
      return;
    }
    const pts = computePathPoints(sel, { x: gemPos.x, z: gemPos.z }, world.getStreetsByDirMap());
    if (pts.length < 2) {
      pathLine.visible = false;
      pathLineMat.opacity = 0;
      pathSegmentCount = 0;
      return;
    }
    const elev = PATH_LINE.value.ELEVATION;
    const flat: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      flat.push(a.x, elev, a.z, b.x, elev, b.z);
    }
    // Recreate the geometry on every update — LineSegmentsGeometry's
    // setPositions can leave stale instance state when segment count
    // changes (segments silently dropped otherwise).
    if (pathLineGeo && pathLineGeo.dispose) pathLineGeo.dispose();
    pathLineGeo = new LineSegmentsGeometry();
    pathLineGeo.setPositions(flat);
    pathLine.geometry = pathLineGeo;

    pathSegmentCount = pts.length - 1;
    if (_pathColorsBuf.length !== pathSegmentCount * 6) {
      _pathColorsBuf = new Float32Array(pathSegmentCount * 6);
    }
    pathLineMat.opacity = PATH_LINE.value.OPACITY;
    pathLine.visible = true;
  }

  function _updateHoverPathLine(): void {
    const hov = picker.hover.value;
    const gemPos = world.getGemWorldPos();
    const cfg = HOVER_PATH_LINE.value;
    function hide() {
      hoverPathLine.visible = false;
      hoverPathLineMat.opacity = 0;
    }
    if (!gemPos || !hov) return hide();
    if (hov.kind === NodeKind.Gem) return hide();
    if (_isHoverSameAsSelection()) return hide();
    const pts = computePathPoints(hov, { x: gemPos.x, z: gemPos.z }, world.getStreetsByDirMap());
    if (pts.length < 2) return hide();
    const elev = cfg.ELEVATION;
    const flat: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      flat.push(a.x, elev, a.z, b.x, elev, b.z);
    }
    if (hoverPathLineGeo && hoverPathLineGeo.dispose) hoverPathLineGeo.dispose();
    hoverPathLineGeo = new LineSegmentsGeometry();
    hoverPathLineGeo.setPositions(flat);
    hoverPathLine.geometry = hoverPathLineGeo;
    hoverPathLineMat.opacity = cfg.OPACITY;
    hoverPathLine.visible = true;
  }

  // Reactive: rebuild geometry on selection / hover / world change.
  //
  // Two effects, each tracking only the signal it should re-run on.
  // _updateHoverPathLine reads picker.hover.value + HOVER_PATH_LINE.value
  // internally — if we called it directly inside the selection effect, the
  // selection effect would also track hover/HOVER_PATH_LINE and fire on
  // their changes (same anti-pattern as the coordinator over-tracking bug
  // fixed in 924371c). untracked() lets the selection effect refresh the
  // hover line on selection change (the hover line's "hide when hover ==
  // selection" rule needs re-evaluation) WITHOUT becoming a hover/config
  // subscriber.
  const _disposeSelectionEffect = effect(() => {
    void picker.selection.value;
    _updatePathLine();
    untracked(_updateHoverPathLine);
  });
  const _disposeHoverEffect = effect(() => {
    void picker.hover.value;
    _updateHoverPathLine();
  });
  world.onChange(() => {
    _updatePathLine();
    _updateHoverPathLine();
  });

  // ── Per-frame: rainbow chase on the selection line ─────────────────
  function update(_dtMs: number): void {
    if (pathSegmentCount <= 0 || !pathLine.visible) return;
    const rb = RAINBOW.value;
    const t = performance.now() * rb.SPEED;
    const n = pathSegmentCount;
    for (let s = 0; s < n; s++) {
      const h1 = (((t + s / n) % 1) + 1) % 1;
      const h2 = (((t + (s + 1) / n) % 1) + 1) % 1;
      _pathHsl.setHSL(h1, rb.SATURATION, rb.LIGHTNESS);
      _pathColorsBuf[s * 6] = _pathHsl.r;
      _pathColorsBuf[s * 6 + 1] = _pathHsl.g;
      _pathColorsBuf[s * 6 + 2] = _pathHsl.b;
      _pathHsl.setHSL(h2, rb.SATURATION, rb.LIGHTNESS);
      _pathColorsBuf[s * 6 + 3] = _pathHsl.r;
      _pathColorsBuf[s * 6 + 4] = _pathHsl.g;
      _pathColorsBuf[s * 6 + 5] = _pathHsl.b;
    }
    pathLineGeo.setColors(_pathColorsBuf);
  }

  function refreshMaterials(): void {
    const pl = PATH_LINE.value;
    pathLineMat.linewidth = computePathLinewidthPixels(pl.LINEWIDTH_PCT);
    if (pathLine.visible) pathLineMat.opacity = pl.OPACITY;
    const hpl = HOVER_PATH_LINE.value;
    hoverPathLineMat.color.set(hpl.COLOR);
    hoverPathLineMat.linewidth = computePathLinewidthPixels(PATH_LINE.value.LINEWIDTH_PCT);
    _updateHoverPathLine();
  }

  function onResize(): void {
    pathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
    hoverPathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  }

  function dispose() {
    _disposeSelectionEffect();
    _disposeHoverEffect();
    if (pathLine.parent) pathLine.parent.remove(pathLine);
    if (hoverPathLine.parent) hoverPathLine.parent.remove(hoverPathLine);
    if (pathLineGeo && pathLineGeo.dispose) pathLineGeo.dispose();
    if (hoverPathLineGeo && hoverPathLineGeo.dispose) hoverPathLineGeo.dispose();
    if (pathLineMat.dispose) pathLineMat.dispose();
    if (hoverPathLineMat.dispose) hoverPathLineMat.dispose();
  }

  return {
    update,
    refreshMaterials,
    onResize,
    dispose,
  };
}
