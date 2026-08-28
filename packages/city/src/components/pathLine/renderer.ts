// city/components/pathLine/renderer.ts — the gem→selection path line
// (rainbow chasing) and the gem→hover preview line. Rebuilds geometry on
// every picker change; update() ticks the rainbow each frame.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { SafeLineSegmentsGeometry } from '@/city/utils/safeLineSegmentsGeometry';

import { createSafeLineMaterial } from '@/city/utils/safeLineMaterial';
import { PATH_LINE_ELEVATION, HOVER_PATH_LINE_ELEVATION } from '@/city/constants/streets';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { computePathPoints } from '@/city/layout/streetPath';
import { rainbowRgbAt } from '@/city/utils/rainbowChase';
import type { CitySettingsStore } from '@/city/settings/store';
import type { PickTarget } from '@/city/types/picker';
import type { CityState } from '@/city/state';
import type { StreetTier } from '@/city/settings/fields/streets';
import { NodeKind } from '@/city/types/manifest';

/** LINEWIDTH_PCT → screen pixels off the narrowest street tier, so the line
 *  stays proportional to the streets at any zoom (worldUnits: false). */
export function computePathLinewidthPixels(pct: number, tiers: StreetTier[]): number {
  if (!tiers.length) return pct / 100; // degenerate fallback
  const minWidth = Math.min(...tiers.map((t) => t.width));
  return minWidth * (pct / 100);
}

/** Minimal picker surface consumed by this renderer (hover + selection
 *  signals). Mirrors trees/outline.ts. */
interface PickerSignals {
  readonly hover: PickTarget | null;
  readonly selection: PickTarget | null;
  on(what: 'hover' | 'selection', listener: () => void): () => void;
}

export function createPathLineRenderer({
  canvas,
  scene,
  picker,
  cityState,
  settings,
}: {
  canvas: HTMLCanvasElement;
  /** Parent for the two line meshes; draw order comes from
   *  RENDER_ORDERS.PATH_LINE, not graph position. */
  scene: THREE.Object3D;
  picker: PickerSignals;
  cityState: CityState;
  settings: CitySettingsStore;
}) {
  // ── Selection path line (rainbow vertex colors) ────────────────────
  const _pl = settings.STREETS;
  const pathLineMat = createSafeLineMaterial({
    vertexColors: true,
    linewidth: computePathLinewidthPixels(_pl.PATH_LINEWIDTH_PCT, settings.STREET_TIERS.TIERS),
    transparent: true,
    opacity: 0.0,
    depthTest: true,
    depthWrite: false,
    worldUnits: false,
  });
  pathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  let pathLineGeo = new SafeLineSegmentsGeometry();
  pathLineGeo.setPositions([0, 0, 0, 0, 0, 0]);
  const pathLine = new LineSegments2(pathLineGeo, pathLineMat);
  pathLine.visible = false;
  pathLine.renderOrder = RENDER_ORDERS.PATH_LINE;
  scene.add(pathLine);

  let pathSegmentCount = 0;
  let _pathColorsBuf = new Float32Array(0);

  // ── Hover preview path line (single solid color, faded) ────────────
  // Width is shared with the selection line — reads PATH_LINE.LINEWIDTH_PCT.
  const hoverPathLineMat = createSafeLineMaterial({
    color: settings.STREETS.HOVER_PATH_COLOR,
    linewidth: computePathLinewidthPixels(
      settings.STREETS.PATH_LINEWIDTH_PCT,
      settings.STREET_TIERS.TIERS
    ),
    transparent: true,
    opacity: 0.0,
    depthTest: true,
    depthWrite: false,
    worldUnits: false,
  });
  hoverPathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  let hoverPathLineGeo = new SafeLineSegmentsGeometry();
  hoverPathLineGeo.setPositions([0, 0, 0, 0, 0, 0]);
  const hoverPathLine = new LineSegments2(hoverPathLineGeo, hoverPathLineMat);
  hoverPathLine.visible = false;
  hoverPathLine.renderOrder = RENDER_ORDERS.PATH_LINE;
  scene.add(hoverPathLine);

  function _isHoverSameAsSelection(): boolean {
    const hov = picker.hover;
    const sel = picker.selection;
    if (!hov || !sel) return false;
    if (hov.kind !== sel.kind) return false;
    if (hov.kind === NodeKind.File && sel.kind === NodeKind.File) return hov.mesh === sel.mesh;
    if (hov.kind === NodeKind.Directory && sel.kind === NodeKind.Directory)
      return hov.street === sel.street;
    if (hov.kind === NodeKind.Gem) return true;
    return false;
  }

  function _updatePathLine(): void {
    const sel = picker.selection;
    const gemPos = cityState.gemWorldPos;
    if (!gemPos || !sel) {
      pathLine.visible = false;
      pathLineMat.opacity = 0;
      pathSegmentCount = 0;
      return;
    }
    const pts = computePathPoints(sel, { x: gemPos.x, z: gemPos.z }, cityState.streetsByDirMap);
    if (pts.length < 2) {
      pathLine.visible = false;
      pathLineMat.opacity = 0;
      pathSegmentCount = 0;
      return;
    }
    const elev = PATH_LINE_ELEVATION;
    const flat: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      flat.push(a.x, elev, a.z, b.x, elev, b.z);
    }
    // Recreate rather than reuse: setPositions can leave stale instance
    // state when the segment count changes (segments silently dropped).
    if (pathLineGeo && pathLineGeo.dispose) pathLineGeo.dispose();
    pathLineGeo = new SafeLineSegmentsGeometry();
    pathLineGeo.setPositions(flat);
    pathLine.geometry = pathLineGeo;

    pathSegmentCount = pts.length - 1;
    if (_pathColorsBuf.length !== pathSegmentCount * 6) {
      _pathColorsBuf = new Float32Array(pathSegmentCount * 6);
    }
    pathLineMat.opacity = settings.STREETS.PATH_OPACITY;
    pathLine.visible = true;
  }

  function _updateHoverPathLine(): void {
    const hov = picker.hover;
    const gemPos = cityState.gemWorldPos;
    const cfg = settings.STREETS;
    function hide() {
      hoverPathLine.visible = false;
      hoverPathLineMat.opacity = 0;
    }
    if (!gemPos || !hov) return hide();
    if (hov.kind === NodeKind.Gem) return hide();
    if (_isHoverSameAsSelection()) return hide();
    const pts = computePathPoints(hov, { x: gemPos.x, z: gemPos.z }, cityState.streetsByDirMap);
    if (pts.length < 2) return hide();
    const elev = HOVER_PATH_LINE_ELEVATION;
    const flat: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      flat.push(a.x, elev, a.z, b.x, elev, b.z);
    }
    if (hoverPathLineGeo && hoverPathLineGeo.dispose) hoverPathLineGeo.dispose();
    hoverPathLineGeo = new SafeLineSegmentsGeometry();
    hoverPathLineGeo.setPositions(flat);
    hoverPathLine.geometry = hoverPathLineGeo;
    hoverPathLineMat.opacity = cfg.HOVER_PATH_OPACITY;
    hoverPathLine.visible = true;
  }

  // A selection change refreshes the hover line too: its "hide when hover ==
  // selection" rule depends on both.
  const _disposeSelectionEffect = picker.on('selection', () => {
    _updatePathLine();
    _updateHoverPathLine();
  });
  const _disposeHoverEffect = picker.on('hover', _updateHoverPathLine);
  // Recompute both lines when the gem moves or the city rebuilds;
  // untracked() keeps the subscription to exactly those two signals.
  const _disposeRebuildEffect = cityState.on('published', () => {
    _updatePathLine();
    _updateHoverPathLine();
  });

  // ── Per-frame: rainbow chase on the selection line ─────────────────
  function update(_dtMs: number): void {
    if (pathSegmentCount <= 0 || !pathLine.visible) return;
    const timeMs = performance.now();
    const n = pathSegmentCount;
    for (let s = 0; s < n; s++) {
      // Consume the start RGB before the second call overwrites the scratch.
      const [r0, g0, b0] = rainbowRgbAt(timeMs, s / n, settings.RAINBOW);
      _pathColorsBuf[s * 6] = r0;
      _pathColorsBuf[s * 6 + 1] = g0;
      _pathColorsBuf[s * 6 + 2] = b0;
      const [r1, g1, b1] = rainbowRgbAt(timeMs, (s + 1) / n, settings.RAINBOW);
      _pathColorsBuf[s * 6 + 3] = r1;
      _pathColorsBuf[s * 6 + 4] = g1;
      _pathColorsBuf[s * 6 + 5] = b1;
    }
    pathLineGeo.setColors(_pathColorsBuf);
  }

  function refreshMaterials(): void {
    const pl = settings.STREETS;
    pathLineMat.linewidth = computePathLinewidthPixels(
      pl.PATH_LINEWIDTH_PCT,
      settings.STREET_TIERS.TIERS
    );
    if (pathLine.visible) pathLineMat.opacity = pl.PATH_OPACITY;
    hoverPathLineMat.color.set(pl.HOVER_PATH_COLOR);
    hoverPathLineMat.linewidth = computePathLinewidthPixels(
      pl.PATH_LINEWIDTH_PCT,
      settings.STREET_TIERS.TIERS
    );
    _updateHoverPathLine();
  }

  function onResize(): void {
    pathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
    hoverPathLineMat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  }

  function dispose() {
    _disposeSelectionEffect();
    _disposeHoverEffect();
    _disposeRebuildEffect();
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
